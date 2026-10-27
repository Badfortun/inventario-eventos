// Componentes compartidos entre pantallas
import { leer } from '../api.js';
import { conCache } from '../cola.js';
import { h, modal, tituloVariante, textoNormal, formatoNum, contador, toast } from '../ui.js';

/** Selector de artículo con búsqueda. Devuelve {variante, cantidad} o null. */
export async function elegirArticulo({ titulo = 'Agregar artículo', excluir = [], conCantidad = true, etiquetaCantidad = 'Cantidad', eventoId = null } = {}) {
  const { datos } = await conCache('inventario', () => leer('v_inventario', { activo: 'eq.true', order: 'nombre.asc,color_nombre.asc,medida.asc' }));
  const disponibles = datos.filter(v => v.activo && !excluir.includes(v.id));
  let elegido = null;
  let cantidad = 1;
  const buscar = h('input', { class: 'input', type: 'search', placeholder: 'Buscar artículo, color, medida, SKU…', 'aria-label': 'Buscar artículo' });
  const lista = h('ul', { class: 'lista lista-elegir', role: 'listbox' });
  const zonaCant = h('div', { class: 'pila', hidden: true });
  const pintar = () => {
    const w = textoNormal(buscar.value).split(/\s+/).filter(Boolean);
    const vis = disponibles.filter(v => w.every(x => textoNormal([v.nombre, v.sku, v.color_nombre, v.categoria, v.medida, v.unidad_medida].join(' ')).includes(x))).slice(0, 60);
    lista.replaceChildren(...vis.map(v => h('li', null, h('button', {
      type: 'button', role: 'option', 'aria-selected': String(elegido?.id === v.id),
      class: `lista-item ${elegido?.id === v.id ? 'elegido' : ''}`,
      onclick: () => {
        elegido = v; pintar();
        if (conCantidad) {
          zonaCant.hidden = false;
          zonaCant.replaceChildren(h('div', { class: 'tenue' }, `Disponible: ${formatoNum(v.disponible)} · En almacén: ${formatoNum(v.existencia)}`),
            h('span', { class: 'etq' }, etiquetaCantidad), contador({ valor: cantidad, min: 0, alCambiar: x => (cantidad = x) }));
        }
      } }, tituloVariante(v), h('span', { class: 'tenue pequeno' }, `${formatoNum(v.disponible)} disp.`)))));
    if (!vis.length) lista.replaceChildren(h('li', { class: 'tenue' }, 'Sin resultados'));
  };
  buscar.addEventListener('input', pintar);
  pintar();
  void eventoId;
  return modal({
    titulo, ancho: '560px',
    contenido: h('div', { class: 'pila' }, buscar, lista, zonaCant),
    acciones: [{ texto: 'Cancelar', valor: null }, { texto: 'Agregar', clase: 'btn-pri', alHacer: () => {
      if (!elegido) { toast('Elige un artículo', 'error'); return false; }
      if (conCantidad && !(cantidad >= 0)) { toast('Cantidad no válida', 'error'); return false; }
      return { variante: elegido, cantidad };
    } }],
  });
}

/** Encabezado grande con el nombre del evento (para no equivocarse de evento). */
export function bandaEvento(ev, modo) {
  return h('div', { class: `banda banda-${modo}` },
    h('div', { class: 'banda-modo' }, modo === 'salida' ? 'REGISTRANDO SALIDA PARA' : 'REGISTRANDO RECOGIDA DE'),
    h('div', { class: 'banda-nombre' }, ev.nombre),
    h('div', { class: 'banda-fecha' }, new Date(ev.fecha + 'T12:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }),
      ev.ubicacion ? ` · ${ev.ubicacion}` : ''));
}
