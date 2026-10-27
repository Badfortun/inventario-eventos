// Cola persistente de operaciones (funciona sin conexión).
// Cada operación lleva un UUID que el servidor usa como clave de
// idempotencia: si se envía dos veces, solo se registra una.
// Una operación NO se borra de la cola hasta que el servidor la acepta.
import { rpc, ErrorRed } from './api.js';

const DB = 'inventario-eventos';
let dbp = null;

function abrir() {
  if (!dbp) {
    dbp = new Promise((ok, mal) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('cola')) db.createObjectStore('cola', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'clave' });
        if (!db.objectStoreNames.contains('borradores')) db.createObjectStore('borradores', { keyPath: 'clave' });
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => mal(r.error);
    });
  }
  return dbp;
}

async function tx(store, modo, fn) {
  const db = await abrir();
  return new Promise((ok, mal) => {
    const t = db.transaction(store, modo);
    const s = t.objectStore(store);
    let res;
    Promise.resolve(fn(s)).then(v => { res = v; });
    t.oncomplete = () => ok(res);
    t.onerror = () => mal(t.error);
    t.onabort = () => mal(t.error);
  });
}
const req = r => new Promise((ok, mal) => { r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error); });

export const idbGet = (store, clave) => tx(store, 'readonly', s => req(s.get(clave)));
export const idbPut = (store, valor) => tx(store, 'readwrite', s => req(s.put(valor)));
export const idbDel = (store, clave) => tx(store, 'readwrite', s => req(s.delete(clave)));
export const idbAll = store => tx(store, 'readonly', s => req(s.getAll()));

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map(v => v.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export function nombreDispositivo() {
  try {
    let d = localStorage.getItem('inv.dispositivo');
    if (!d) {
      const ua = navigator.userAgent;
      const m = ua.match(/Android[^;)]*;\s*([^;)]+)/) || ua.match(/\((iPhone|iPad)/);
      d = (m ? m[1].trim() : (/Windows/.test(ua) ? 'PC Windows' : 'Navegador')) + ' · ' + uuid().slice(0, 4);
      localStorage.setItem('inv.dispositivo', d);
    }
    return d;
  } catch { return 'Navegador'; }
}

// ---------------------------------------------------------------------
const oyentes = new Set();
export const alCambiarCola = fn => { oyentes.add(fn); return () => oyentes.delete(fn); };
const avisar = () => estadoCola().then(e => oyentes.forEach(fn => fn(e)));

export let ultimaSync = (() => { try { return Number(localStorage.getItem('inv.ultimaSync')) || null; } catch { return null; } })();
function marcarSync() {
  ultimaSync = Date.now();
  try { localStorage.setItem('inv.ultimaSync', String(ultimaSync)); } catch {}
}

export async function estadoCola() {
  const ops = await idbAll('cola');
  return {
    pendientes: ops.filter(o => o.estado === 'pendiente').length,
    errores: ops.filter(o => o.estado === 'error').length,
    ops: ops.sort((a, b) => b.creado - a.creado),
    enLinea: navigator.onLine,
    ultimaSync,
  };
}

async function enviar(op) {
  try {
    const res = await rpc(op.fn, { p_idem: op.id, p_args: op.args });
    op.resultado = res;
    op.estado = res?.ok ? 'sincronizado' : 'error';
    op.error = res?.ok ? null : (res?.error || 'Error desconocido');
    op.enviado = Date.now();
    await idbPut('cola', op);
    marcarSync();
    return op;
  } catch (e) {
    if (e instanceof ErrorRed) {
      op.intentos = (op.intentos || 0) + 1;
      await idbPut('cola', op);
      throw e;
    }
    op.estado = 'error';
    op.error = e.message;
    await idbPut('cola', op);
    return op;
  }
}

/** Registra una operación en la cola y la intenta enviar de inmediato.
 *  Devuelve la operación con estado 'sincronizado' | 'pendiente' | 'error'. */
export async function encolar(fn, args, descripcion) {
  const op = {
    id: uuid(), fn, descripcion: descripcion || fn,
    args: { ...args, dispositivo: nombreDispositivo(), hora_local: new Date().toISOString() },
    estado: 'pendiente', creado: Date.now(), intentos: 0,
  };
  await idbPut('cola', op);
  avisar();
  // Respetar el orden: si hay pendientes anteriores, se envía todo en orden
  try {
    await sincronizar();
  } catch {}
  const final = await idbGet('cola', op.id);
  // Si el servidor la rechazó en el momento, el usuario lo ve en pantalla
  // y la corrige; no se queda en la cola como error.
  if (final?.estado === 'error') await idbDel('cola', op.id);
  avisar();
  return final;
}

let sincronizando = null;
/** Envía en orden todas las operaciones pendientes. */
export function sincronizar() {
  if (sincronizando) return sincronizando;
  sincronizando = (async () => {
    const ops = (await idbAll('cola')).filter(o => o.estado === 'pendiente').sort((a, b) => a.creado - b.creado);
    for (const op of ops) {
      await enviar(op); // si no hay red, lanza y se detiene (se reintenta después)
    }
    await limpiar();
  })().finally(() => { sincronizando = null; avisar(); });
  return sincronizando;
}

async function limpiar() {
  const ops = (await idbAll('cola')).filter(o => o.estado === 'sincronizado').sort((a, b) => b.creado - a.creado);
  for (const op of ops.slice(30)) await idbDel('cola', op.id);
}

export async function reintentar(id) {
  const op = await idbGet('cola', id);
  if (!op) return;
  op.estado = 'pendiente';
  op.error = null;
  await idbPut('cola', op);
  try { await sincronizar(); } catch {}
  return idbGet('cola', id);
}

export async function descartar(id) {
  await idbDel('cola', id);
  avisar();
}

/** Llamada directa (no se guarda en la cola). Para operaciones con PIN
 *  que requieren conexión en el momento. */
export async function directo(fn, args) {
  return rpc(fn, { p_idem: uuid(), p_args: { ...args, dispositivo: nombreDispositivo(), hora_local: new Date().toISOString() } });
}

export function iniciarSincronizacion() {
  const intentar = () => sincronizar().catch(() => {});
  window.addEventListener('online', () => { avisar(); intentar(); });
  window.addEventListener('offline', avisar);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) intentar(); });
  setInterval(intentar, 20000);
  intentar();
}

// ---------------------------------------------------------------------
// Caché de lecturas para consultar sin conexión
// ---------------------------------------------------------------------
export async function conCache(clave, fn) {
  try {
    const datos = await fn();
    idbPut('cache', { clave, datos, t: Date.now() }).catch(() => {});
    return { datos, desdeCache: false };
  } catch (e) {
    if (!(e instanceof ErrorRed)) throw e;
    const c = await idbGet('cache', clave);
    if (!c) throw e;
    return { datos: c.datos, desdeCache: true, t: c.t };
  }
}

// Borradores (conteos en progreso que sobreviven a cerrar la app)
export const leerBorrador = async clave => (await idbGet('borradores', clave))?.datos || null;
export const guardarBorrador = (clave, datos) => idbPut('borradores', { clave, datos, t: Date.now() });
export const borrarBorrador = clave => idbDel('borradores', clave);
