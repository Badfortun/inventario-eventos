// Estado compartido, permisos (para mostrar u ocultar botones: el servidor
// vuelve a verificar TODO) y ejecución de operaciones.
import { rpc, ErrorRed } from './api.js';
import { toast } from './ui.js';

export const estado = { perfil: null, lugaresFijos: {} };

const r = rol => !!estado.perfil?.activo && (estado.perfil.roles || []).includes(rol);
export const esAdmin = () => r('admin');
export const puedeSalidas = () => r('admin') || r('salidas');
export const puedeRecogidas = () => r('admin') || r('recogidas');
export const puedeMover = () => r('admin') || r('salidas') || r('recogidas');
export const puedeVerBitacora = () => r('admin') || r('salidas') || r('recogidas');

/** ¿El usuario puede mover material de un tipo de lugar a otro? Devuelve
 *  'si' | 'autorizar' (queda por autorizar) | 'no'. Igual que en el servidor. */
export function permisoRuta(origenTipo, destinoTipo) {
  const ruta = `${origenTipo}>${destinoTipo}`;
  if (destinoTipo === 'perdida' || origenTipo === destinoTipo && origenTipo !== 'evento') return 'no';
  if (esAdmin()) return origenTipo === 'baja' ? 'no' : 'si';
  if (ruta === 'almacen>evento') return r('salidas') ? 'si' : 'no';
  if (['evento>almacen', 'evento>reparacion', 'almacen>reparacion', 'reparacion>almacen'].includes(ruta)) return r('recogidas') ? 'si' : 'no';
  if (ruta === 'evento>evento') return (r('salidas') || r('recogidas')) ? 'autorizar' : 'no';
  return 'no';
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map(v => v.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export function nombreDispositivo() {
  try {
    let d = localStorage.getItem('inv2.dispositivo');
    if (!d) {
      const ua = navigator.userAgent;
      const m = ua.match(/Android[^;)]*;\s*([^;)]+)/) || ua.match(/\((iPhone|iPad)/);
      d = (m ? m[1].trim() : (/Windows/.test(ua) ? 'PC Windows' : 'Navegador')) + ' · ' + uuid().slice(0, 4);
      localStorage.setItem('inv2.dispositivo', d);
    }
    return d;
  } catch { return 'Navegador'; }
}

/** Ejecuta una operación en el servidor. La clave de operación evita que un
 *  doble toque o un reintento registre lo mismo dos veces. */
export async function ejecutar(fn, args, idem = uuid()) {
  try {
    return await rpc(fn, { p_idem: idem, p_args: { ...args, dispositivo: nombreDispositivo() } });
  } catch (e) {
    if (e instanceof ErrorRed) return { ok: false, codigo: 'sin_conexion', error: 'Sin conexión a internet. No se guardó nada; inténtalo de nuevo.' };
    return { ok: false, codigo: 'error', error: e.message };
  }
}

/** Muestra el resultado y dice si fue exitoso */
export function informar(res, mensajeOk) {
  if (res?.ok) {
    if (res.repetida) toast('Esto ya se había registrado (no se duplicó)', 'info');
    else if (mensajeOk) toast(mensajeOk, 'ok');
    return true;
  }
  toast(res?.error || 'No se pudo guardar', 'error', 6000);
  return false;
}
