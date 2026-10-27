import { h, icono } from '../ui.js';
import { esAdmin, puedeRecogidas, puedeVerBitacora, puedeMover } from '../estado.js';

export async function render(p) {
  const item = (href, ic, t, d) => h('li', null, h('a', { class: 'lista-item', href },
    h('div', { class: 'fila' }, icono(ic), h('div', null, h('strong', null, t), h('div', { class: 'tenue pequeno' }, d)))));
  p.append(h('h1', null, 'Más'), h('ul', { class: 'lista' },
    item('#/donde', 'mapa', '¿Dónde está el material?', 'Reparto por evento y por artículo'),
    puedeMover() ? item('#/autorizaciones', 'escudo', 'Autorizaciones', esAdmin() ? 'Traslados entre eventos por aprobar' : 'Tus solicitudes de traslado') : null,
    puedeRecogidas() ? item('#/escaneo', 'codigo', 'Pendiente de escanear', 'Material del almacén sin escanear') : null,
    item('#/movimientos', 'lista', 'Movimientos', 'Historial con filtros por lugar y persona'),
    item('#/reportes', 'descarga', 'Reportes', 'Excel y PDF'),
    puedeVerBitacora() ? item('#/bitacora', 'reloj', 'Bitácora', esAdmin() ? 'Quién hizo qué y cuándo' : 'Tus acciones') : null,
    esAdmin() ? item('#/usuarios', 'usuario', 'Usuarios y permisos', 'Aprobar cuentas y asignar roles') : null,
    item('#/cuenta', 'candado', 'Mi cuenta', 'Dispositivo y cerrar sesión')));
}
