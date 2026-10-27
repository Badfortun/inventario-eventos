import { leer } from '../api.js';
import { h, icono, vacio, campo, modal, toast, fecha, chipEstadoEvento } from '../ui.js';
import { esAdmin, ejecutar, informar } from '../estado.js';
import { recargar } from '../app.js';

export async function render(p) {
  const lugares = await leer('v_lugares', { order: 'fecha.desc.nullsfirst', limit: 400 });
  let tab = sessionStorage.getItem('inv2.evTab') || 'abiertos';
  const fijos = lugares.filter(l => ['almacen', 'reparacion'].includes(l.tipo));
  const eventos = lugares.filter(l => l.tipo === 'evento');
  const perdidas = lugares.find(l => l.tipo === 'perdida');
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const lista = h('ul', { class: 'lista' });

  function pintar() {
    const ab = eventos.filter(e => e.estado === 'abierto').sort((a, b) => a.fecha.localeCompare(b.fecha));
    const ce = eventos.filter(e => e.estado === 'cerrado');
    tabs.replaceChildren(...[['abiertos', 'Abiertos', ab.length], ['cerrados', 'Cerrados', ce.length]].map(([k, t, n]) =>
      h('button', { role: 'tab', class: `tab ${k === tab ? 'activo' : ''}`, 'aria-selected': String(k === tab),
        onclick: () => { tab = k; sessionStorage.setItem('inv2.evTab', k); pintar(); } }, t, h('span', { class: 'tab-n' }, n))));
    const vis = tab === 'abiertos' ? ab : ce;
    lista.replaceChildren(...(vis.length ? vis.map(e => h('li', null, h('a', { class: 'lista-item', href: `#/lugar/${e.id}` },
      h('div', null, h('strong', null, e.nombre),
        h('div', { class: 'tenue pequeno' }, fecha(e.fecha), e.ubicacion ? ` · ${e.ubicacion}` : ''),
        h('div', { class: 'pequeno' }, e.estado === 'abierto' ? `${e.piezas} pieza(s) ahí ahora` : (e.perdidas ? h('span', { class: 'texto-rojo' }, `${e.perdidas} pieza(s) perdidas`) : 'Sin pérdidas'),
          e.por_autorizar ? h('span', { class: 'texto-ambar' }, ` · ${e.por_autorizar} por autorizar`) : null)),
      chipEstadoEvento(e.estado)))) : [h('li', null, vacio(tab === 'abiertos' ? 'No hay eventos abiertos.' : 'No hay eventos cerrados.'))]));
  }

  p.append(
    h('div', { class: 'fila-entre' }, h('h1', null, 'Lugares y eventos'),
      esAdmin() ? h('button', { class: 'btn btn-pri', onclick: () => editarEvento() }, icono('mas1', 18), 'Nuevo evento') : null),
    h('div', { class: 'lugares-fijos' }, fijos.map(l => h('a', { class: `tarjeta tarjeta-enlace lugar-fijo lugar-${l.tipo}`, href: `#/lugar/${l.id}` },
      icono(l.tipo === 'almacen' ? 'inventario' : 'herramienta', 26), h('div', null, h('strong', null, l.nombre), h('div', { class: 'pequeno' }, `${l.piezas} pieza(s)`,
        l.sin_escanear ? h('span', { class: 'texto-ambar' }, ` · ${l.sin_escanear} sin escanear`) : null))))),
    perdidas?.piezas ? h('a', { class: 'pequeno enlace-gris', href: `#/lugar/${perdidas.id}` }, `Ver pérdidas confirmadas (${perdidas.piezas} pieza(s)) →`) : null,
    h('h2', { class: 'seccion' }, 'Eventos'), tabs, lista);
  pintar();
}

export function editarEvento(e = null) {
  const nombre = h('input', { class: 'input', value: e?.nombre || '', placeholder: 'Boda García' });
  const ini = h('input', { class: 'input', type: 'date', value: e?.fecha || new Date().toISOString().slice(0, 10) });
  const fin = h('input', { class: 'input', type: 'date', value: e?.fecha_fin || '' });
  const ubic = h('input', { class: 'input', value: e?.ubicacion || '' });
  const notas = h('textarea', { class: 'input', rows: 2 }, e?.notas || '');
  return modal({ titulo: e ? 'Editar evento' : 'Nuevo evento',
    contenido: h('div', { class: 'pila' }, campo('Nombre *', nombre), h('div', { class: 'form-grid' }, campo('Fecha de inicio *', ini), campo('Fecha de fin', fin)),
      campo('Ubicación', ubic), campo('Notas', notas)),
    acciones: [{ texto: 'Cancelar' }, { texto: e ? 'Guardar' : 'Crear evento', clase: 'btn-pri', alHacer: async () => {
      if (!nombre.value.trim() || !ini.value) { toast('Nombre y fecha son obligatorios', 'error'); return false; }
      const r = await ejecutar('guardar_evento', { id: e?.id, nombre: nombre.value, fecha: ini.value, fecha_fin: fin.value, ubicacion: ubic.value, notas: notas.value });
      if (!informar(r, e ? 'Evento actualizado' : 'Evento creado')) return false;
      if (!e) location.hash = `#/lugar/${r.id}`; else recargar();
    } }] });
}
