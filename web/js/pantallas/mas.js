import { h, icono } from '../ui.js';
import { esAdmin, puedeVerBitacora } from '../estado.js';

export async function render(p) {
  const item = (href, ic, titulo, desc) => h('li', null, h('a', { class: 'lista-item', href },
    h('div', { class: 'fila' }, icono(ic), h('div', null, h('strong', null, titulo), h('div', { class: 'tenue pequeno' }, desc)))));
  p.append(h('h1', null, 'Más'), h('ul', { class: 'lista' },
    item('#/reportes', 'descarga', 'Reportes', 'Exportar eventos a PDF o Excel'),
    puedeVerBitacora() ? item('#/bitacora', 'reloj', 'Bitácora', esAdmin() ? 'Quién hizo qué y cuándo' : 'Tus acciones registradas') : null,
    esAdmin() ? item('#/usuarios', 'usuario', 'Usuarios y permisos', 'Aprobar cuentas y asignar roles') : null,
    item('#/cola', 'nube', 'Sincronización', 'Operaciones pendientes de enviar'),
    item('#/cuenta', 'candado', 'Mi cuenta', 'PIN, dispositivo, cerrar sesión')));
}
