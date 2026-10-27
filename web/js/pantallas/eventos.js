import { leer } from '../api.js';
import { conCache, encolar } from '../cola.js';
import { h, chipEstado, fecha, vacio, hace, icono, modal, campo, toast } from '../ui.js';
import { esAdmin, informar } from '../estado.js';

export async function render(p) {
  let pestaña = sessionStorage.getItem('inv.eventosTab') || 'abiertos';
  const { datos, desdeCache, t } = await conCache('eventos', () => leer('v_eventos', { order: 'fecha.desc', limit: 300 }));
  const lista = h('ul', { class: 'lista' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const pintar = () => {
    tabs.replaceChildren(...[['abiertos', 'Abiertos'], ['cerrados', 'Cerrados']].map(([k, txt]) =>
      h('button', { role: 'tab', 'aria-selected': String(k === pestaña), class: `tab ${k === pestaña ? 'activo' : ''}`,
        onclick: () => { pestaña = k; sessionStorage.setItem('inv.eventosTab', k); pintar(); } },
        txt, h('span', { class: 'tab-n' }, datos.filter(e => (k === 'cerrados') === (e.estado === 'cerrado')).length))));
    const vis = datos.filter(e => (pestaña === 'cerrados') === (e.estado === 'cerrado'));
    if (pestaña === 'abiertos') vis.sort((a, b) => a.fecha.localeCompare(b.fecha));
    lista.replaceChildren(...(vis.length ? vis.map(e => h('li', null,
      h('a', { class: 'lista-item', href: `#/evento/${e.id}` },
        h('div', null,
          h('strong', null, e.nombre),
          h('div', { class: 'tenue pequeno' }, fecha(e.fecha), e.ubicacion ? ` · ${e.ubicacion}` : '', ` · ${e.articulos} artículo(s)`),
          e.incidencias_abiertas ? h('div', { class: 'pequeno texto-ambar' }, `${e.incidencias_abiertas} diferencia(s) por revisar`) : null,
          e.cierre_forzado ? h('div', { class: 'pequeno texto-rojo' }, 'Cerrado con diferencias (autorizado)') : null),
        chipEstado(e.estado)))) : [h('li', null, vacio(pestaña === 'abiertos' ? 'No hay eventos abiertos.' : 'No hay eventos cerrados.'))]));
  };
  p.append(
    h('div', { class: 'fila-entre' }, h('h1', null, 'Eventos'),
      esAdmin() ? h('button', { class: 'btn btn-pri', onclick: () => editarEvento() }, icono('mas1', 18), 'Nuevo evento') : null),
    desdeCache ? h('div', { class: 'aviso aviso-aviso' }, `Sin conexión: datos guardados ${hace(t)}.`) : null,
    tabs, lista);
  pintar();
}

export async function editarEvento(e = null) {
  const nombre = h('input', { class: 'input', value: e?.nombre || '', placeholder: 'Boda García' });
  const fechaI = h('input', { class: 'input', type: 'date', value: e?.fecha || new Date().toISOString().slice(0, 10) });
  const ubic = h('input', { class: 'input', value: e?.ubicacion || '', placeholder: 'Salón Jardín' });
  const notas = h('textarea', { class: 'input', rows: 3 }, e?.notas || '');
  return modal({
    titulo: e ? 'Editar evento' : 'Nuevo evento',
    contenido: h('div', { class: 'pila' }, campo('Nombre *', nombre), campo('Fecha *', fechaI), campo('Ubicación', ubic), campo('Notas', notas)),
    acciones: [{ texto: 'Cancelar' }, { texto: e ? 'Guardar' : 'Crear evento', clase: 'btn-pri', alHacer: async () => {
      if (!nombre.value.trim() || !fechaI.value) { toast('Nombre y fecha son obligatorios', 'error'); return false; }
      const op = await encolar('guardar_evento', { id: e?.id, nombre: nombre.value, fecha: fechaI.value, ubicacion: ubic.value, notas: notas.value },
        `${e ? 'Editar' : 'Crear'} evento ${nombre.value}`);
      if (!informar(op, e ? 'Evento actualizado' : 'Evento creado')) return false;
      const id = op.resultado?.id || e?.id;
      if (id) location.hash = `#/evento/${id}`;
      else location.hash = '#/eventos';
      if (e) (await import('../app.js')).recargar();
    } }],
  });
}
