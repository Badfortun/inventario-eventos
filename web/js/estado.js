// Estado compartido: perfil del usuario y permisos (para mostrar u ocultar
// botones; el servidor vuelve a verificar TODO).
import { toast } from './ui.js';

export const estado = { perfil: null };

const r = rol => !!estado.perfil?.activo && (estado.perfil.roles || []).includes(rol);
export const esAdmin = () => r('admin');
export const puedeSalidas = () => r('admin') || r('salidas');
export const puedeRecogidas = () => r('admin') || r('recogidas');
export const puedeVerBitacora = () => r('admin') || r('salidas') || r('recogidas');

/** Muestra el resultado de una operación de la cola y dice si fue exitosa. */
export function informar(op, mensajeOk) {
  if (!op) return false;
  if (op.estado === 'sincronizado') {
    if (op.resultado?.repetida) toast('Esta operación ya se había registrado (no se duplicó)', 'info');
    else if (mensajeOk) toast(mensajeOk, 'ok');
    return true;
  }
  if (op.estado === 'pendiente') {
    toast('Sin conexión: guardado en este celular. Se enviará al recuperar señal (aún NO está confirmado).', 'aviso', 6000);
    return true;
  }
  toast(op.error || 'No se pudo registrar', 'error', 6000);
  return false;
}
