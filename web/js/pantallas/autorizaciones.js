// Traslados entre eventos por autorizar
import { leer } from '../api.js';
import { h, vacio, pedirMotivo, confirmar, modal } from '../ui.js';
import { estado, esAdmin, ejecutar, informar } from '../estado.js';
import { recargar } from '../app.js';
import { tarjetaMovimiento } from './componentes.js';

export async function render(p) {
  const [pend, recientes] = await Promise.all([
    leer('v_movimientos', { estado: 'eq.por_autorizar', order: 'created_at.asc' }),
    leer('v_movimientos', { autorizado_por: 'not.is.null', order: 'autorizado_at.desc', limit: 20 }),
  ]);
  const visibles = esAdmin() ? pend : pend.filter(m => m.registrado_por === estado.perfil.id);
  p.append(
    h('h1', null, 'Autorizaciones'),
    h('p', { class: 'tenue' }, esAdmin() ? 'Traslados entre eventos que esperan tu aprobación. Las cantidades cambian solo al autorizar.'
      : 'Tus solicitudes de traslado entre eventos. Las autoriza el administrador.'),
    visibles.length ? visibles.map(m => h('div', { class: 'pila autorizacion' }, tarjetaMovimiento(m),
      h('div', { class: 'fila acciones' },
        esAdmin() ? h('button', { class: 'btn btn-pri', onclick: async () => {
          if (!(await confirmar('Autorizar traslado', `${m.piezas} pieza(s) de ${m.origen_nombre} a ${m.destino_nombre}.`, 'Autorizar'))) return;
          const r = await ejecutar('autorizar_movimiento', { movimiento_id: m.id, aprobar: true });
          if (!r.ok && r.articulos) return modal({ titulo: r.error, contenido: h('ul', { class: 'lista-simple' }, r.articulos.map(a => h('li', null, `${a.nombre}: se pidieron ${a.solicitado}, hay ${a.disponible}`))) });
          if (informar(r, 'Traslado autorizado')) recargar();
        } }, 'Autorizar') : null,
        h('button', { class: 'btn btn-sec', onclick: async () => {
          const propio = m.registrado_por === estado.perfil.id && !esAdmin();
          const motivo = await pedirMotivo({ titulo: propio ? 'Cancelar solicitud' : 'Rechazar traslado', textoBoton: propio ? 'Cancelar solicitud' : 'Rechazar', clase: 'btn-peligro' });
          if (motivo && informar(await ejecutar('autorizar_movimiento', { movimiento_id: m.id, aprobar: false, motivo }), propio ? 'Solicitud cancelada' : 'Traslado rechazado')) recargar();
        } }, esAdmin() ? 'Rechazar' : 'Cancelar solicitud')))) : vacio('No hay traslados por autorizar.'),
    recientes.length ? [h('h2', { class: 'seccion' }, 'Resueltos recientemente'), h('div', { class: 'pila' }, recientes.map(m => tarjetaMovimiento(m)))] : null);
}
