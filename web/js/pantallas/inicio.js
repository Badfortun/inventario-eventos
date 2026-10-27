import { leer } from '../api.js';
import { conCache } from '../cola.js';
import { h, chipEstado, fecha, vacio, hace, icono } from '../ui.js';
import { estado, esAdmin, puedeSalidas, puedeRecogidas } from '../estado.js';
import { ROLES } from '../ui.js';

export async function render(p) {
  const { datos: eventos, desdeCache, t } = await conCache('inicio.eventos',
    () => leer('v_eventos', { estado: 'in.(borrador,activo,recogida)', order: 'fecha.asc' }));

  const roles = estado.perfil.roles.map(r => ROLES[r]).join(' · ');
  p.append(
    h('div', { class: 'saludo' },
      h('h1', null, `Hola, ${estado.perfil.nombre.split(' ')[0]}`),
      h('p', { class: 'tenue' }, roles)),
    desdeCache ? h('div', { class: 'aviso aviso-aviso' }, `Sin conexión: mostrando datos guardados ${hace(t)}.`) : null);

  const activos = eventos.filter(e => e.estado !== 'borrador');
  const borradores = eventos.filter(e => e.estado === 'borrador');

  p.append(h('h2', { class: 'seccion' }, 'Eventos en curso'));
  if (!activos.length) {
    p.append(vacio('No hay eventos activos ni en recogida.',
      esAdmin() ? h('a', { class: 'btn btn-pri', href: '#/eventos' }, 'Crear un evento') : null));
  }
  for (const e of activos) {
    const acciones = [];
    if (e.estado === 'activo' && puedeSalidas()) acciones.push(h('a', { class: 'btn btn-pri', href: `#/evento/${e.id}/salida` }, icono('salida', 18), 'Salida'));
    if (['activo', 'recogida'].includes(e.estado) && puedeRecogidas()) acciones.push(h('a', { class: `btn ${e.estado === 'recogida' ? 'btn-pri' : 'btn-sec'}`, href: `#/evento/${e.id}/recogida` }, icono('recogida', 18), 'Recogida'));
    p.append(h('article', { class: 'tarjeta tarjeta-evento' },
      h('a', { class: 'tarjeta-enlace', href: `#/evento/${e.id}` },
        h('div', { class: 'fila-entre' }, h('h3', null, e.nombre), chipEstado(e.estado)),
        h('div', { class: 'tenue' }, fecha(e.fecha), e.ubicacion ? ` · ${e.ubicacion}` : ''),
        h('div', { class: 'metricas' },
          metrica('Planeado', e.total_planeado),
          metrica('Entregado', e.total_entregado),
          metrica('Contado', e.total_regresado),
          metrica('Por recoger', e.total_por_recoger, e.total_por_recoger > 0 && e.estado === 'recogida' ? 'ambar' : null)),
        e.incidencias_abiertas ? h('div', { class: 'aviso aviso-aviso compacto' }, `${e.incidencias_abiertas} diferencia(s) por revisar`) : null),
      acciones.length ? h('div', { class: 'tarjeta-acciones' }, acciones) : null));
  }

  if (esAdmin() && borradores.length) {
    p.append(h('h2', { class: 'seccion' }, 'Borradores'),
      h('ul', { class: 'lista' }, borradores.map(e => h('li', null,
        h('a', { class: 'lista-item', href: `#/evento/${e.id}` },
          h('div', null, h('strong', null, e.nombre), h('div', { class: 'tenue' }, fecha(e.fecha), ` · ${e.articulos} artículo(s)`)),
          chipEstado(e.estado))))));
  }
}

function metrica(etiqueta, valor, clase) {
  return h('div', { class: `metrica ${clase ? 'metrica-' + clase : ''}` }, h('strong', null, valor ?? 0), h('span', null, etiqueta));
}
export { metrica };
