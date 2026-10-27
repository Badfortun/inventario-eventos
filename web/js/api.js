// Conexión con Supabase usando sus APIs REST (sin librerías externas).
import { CONFIG } from '../config.js';

export class ErrorRed extends Error {}
export class ErrorApi extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

const LS_SESION = 'inv.sesion';
let sesion = (() => { try { return JSON.parse(localStorage.getItem(LS_SESION)); } catch { return null; } })();
let refrescando = null;

export const sesionActual = () => sesion;

function guardarSesion(s) {
  sesion = s;
  try { s ? localStorage.setItem(LS_SESION, JSON.stringify(s)) : localStorage.removeItem(LS_SESION); } catch {}
}

export function emailDe(usuario) {
  const u = String(usuario || '').trim().toLowerCase();
  return u.includes('@') ? u : `${u}@${CONFIG.DOMINIO_USUARIOS}`;
}

function traducirError(j, status) {
  const m = (j && (j.error_description || j.msg || j.message || j.error)) || '';
  if (/invalid login credentials|invalid_grant/i.test(m)) return 'Usuario o contraseña incorrectos';
  if (/already registered|already exists/i.test(m)) return 'Ese nombre de usuario ya está registrado';
  if (/password should be at least/i.test(m)) return 'La contraseña es demasiado corta (mínimo 8 caracteres)';
  if (/email.*invalid|invalid.*email/i.test(m)) return 'Supabase rechazó el correo interno; cambia DOMINIO_USUARIOS en config.js';
  if (/signups not allowed/i.test(m)) return 'El registro de usuarios está desactivado en Supabase';
  if (/JWT expired/i.test(m)) return 'La sesión expiró, vuelve a entrar';
  return m || `Error del servidor (${status})`;
}

async function pedir(url, opciones) {
  let r;
  try {
    r = await fetch(url, opciones);
  } catch (e) {
    throw new ErrorRed('Sin conexión con el servidor');
  }
  const texto = await r.text();
  let j = null;
  try { j = texto ? JSON.parse(texto) : null; } catch { j = texto; }
  if (!r.ok) throw new ErrorApi(traducirError(j, r.status), r.status);
  return j;
}

function normalizar(j) {
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
    user_id: j.user?.id,
  };
}

const cabecerasBase = () => ({ apikey: CONFIG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' });

export async function entrar(usuario, contrasena) {
  const j = await pedir(`${CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: cabecerasBase(),
    body: JSON.stringify({ email: emailDe(usuario), password: contrasena }),
  });
  guardarSesion(normalizar(j));
  return sesion;
}

export async function registrarse(usuario, nombre, contrasena) {
  const j = await pedir(`${CONFIG.SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST', headers: cabecerasBase(),
    body: JSON.stringify({ email: emailDe(usuario), password: contrasena,
                           data: { usuario: String(usuario).trim().toLowerCase(), nombre: nombre.trim() } }),
  });
  if (!j?.access_token) {
    throw new ErrorApi('La cuenta se creó, pero Supabase pide confirmar el correo. ' +
      'El administrador debe desactivar "Confirm email" en Authentication → Providers → Email.');
  }
  guardarSesion(normalizar(j));
  return sesion;
}

async function refrescar() {
  if (!sesion?.refresh_token) throw new ErrorApi('Sesión cerrada', 401);
  if (!refrescando) {
    refrescando = pedir(`${CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: cabecerasBase(), body: JSON.stringify({ refresh_token: sesion.refresh_token }),
    }).then(j => guardarSesion(normalizar(j)))
      .catch(e => { if (e instanceof ErrorApi) guardarSesion(null); throw e; })
      .finally(() => { refrescando = null; });
  }
  return refrescando;
}

async function token() {
  if (!sesion) throw new ErrorApi('Sesión cerrada', 401);
  if (sesion.expires_at - 60 < Date.now() / 1000) await refrescar();
  return sesion.access_token;
}

async function conToken(fn) {
  try {
    return await fn(await token());
  } catch (e) {
    if (e instanceof ErrorApi && e.status === 401 && sesion?.refresh_token) {
      await refrescar();
      return fn(sesion.access_token);
    }
    throw e;
  }
}

export async function salir() {
  try {
    if (sesion) await pedir(`${CONFIG.SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST', headers: { ...cabecerasBase(), Authorization: `Bearer ${sesion.access_token}` } });
  } catch {}
  guardarSesion(null);
}

// Lectura de una tabla o vista. params: {select, order, limit, ...filtros PostgREST}
export function leer(tabla, params = {}) {
  const qs = new URLSearchParams({ select: '*', ...params });
  return conToken(t => pedir(`${CONFIG.SUPABASE_URL}/rest/v1/${tabla}?${qs}`, {
    headers: { ...cabecerasBase(), Authorization: `Bearer ${t}` },
  }));
}

// Llamada a una función del servidor
export function rpc(fn, cuerpo) {
  return conToken(t => pedir(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...cabecerasBase(), Authorization: `Bearer ${t}` },
    body: JSON.stringify(cuerpo),
  }));
}

export const configurado = () => !/TU-PROYECTO|PEGA-AQUI/.test(CONFIG.SUPABASE_URL + CONFIG.SUPABASE_ANON_KEY);
