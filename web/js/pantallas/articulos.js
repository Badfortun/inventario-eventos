import { leer } from '../api.js';
import { h, icono, vacio, campo, modal, toast, tituloArticulo, textoNormal, formatoNum } from '../ui.js';
import { esAdmin, ejecutar, informar } from '../estado.js';
import { recargar } from '../app.js';

const UNIDADES = ['pieza', 'par', 'juego', 'caja', 'rollo', 'kit', 'paquete', 'metro'];
const MEDIDAS = ['', 'metros', 'pies', 'pulgadas', 'cm', 'mm'];

export async function render(p) {
  const datos = await leer('v_articulos', { order: 'nombre.asc,color_nombre.asc,medida.asc' });
  const cats = [...new Set(datos.map(a => a.categoria).filter(Boolean))].sort();
  let texto = sessionStorage.getItem('inv2.buscar') || '', cat = '', inactivos = false;
  const buscar = h('input', { class: 'input', type: 'search', value: texto, placeholder: 'Buscar por código, nombre, color, medida…', 'aria-label': 'Buscar' });
  const selCat = h('select', { class: 'input', 'aria-label': 'Categoría' }, h('option', { value: '' }, 'Todas las categorías'), cats.map(c => h('option', { value: c }, c)));
  const lista = h('ul', { class: 'lista' });
  const total = h('p', { class: 'tenue pequeno' });
  buscar.oninput = () => { texto = buscar.value; sessionStorage.setItem('inv2.buscar', texto); pintar(); };
  selCat.onchange = () => { cat = selCat.value; pintar(); };

  function pintar() {
    const w = textoNormal(texto).split(/\s+/).filter(Boolean);
    const vis = datos.filter(a => (inactivos || a.activo) && (!cat || a.categoria === cat) &&
      w.every(x => textoNormal([a.codigo, a.nombre, a.color_nombre, a.categoria, a.medida, a.unidad_medida, a.tamano].join(' ')).includes(x)));
    total.textContent = `${vis.length} de ${datos.length} artículos`;
    lista.replaceChildren(...(vis.length ? vis.map(a => h('li', null, h('a', { class: `lista-item ${a.activo ? '' : 'inactivo'}`, href: `#/articulo/${a.id}` },
      h('div', { class: 'crece' }, tituloArticulo(a),
        h('div', { class: 'reparto' },
          h('span', null, `Almacén ${formatoNum(a.en_almacen)}`),
          a.en_eventos ? h('span', { class: 'texto-azul' }, `Eventos ${formatoNum(a.en_eventos)} (${a.num_eventos})`) : null,
          a.en_reparacion ? h('span', { class: 'texto-ambar' }, `Reparación ${a.en_reparacion}`) : null,
          a.sin_escanear ? h('span', { class: 'texto-ambar' }, `${a.sin_escanear} sin escanear`) : null)),
      h('div', { class: 'existencias' }, h('div', { class: 'exist-num' }, formatoNum(a.total)), h('div', { class: 'exist-etq' }, 'total'))))) :
      [h('li', null, vacio(datos.length ? 'Ningún artículo coincide.' : 'Todavía no hay artículos.'))]));
  }

  p.append(
    h('div', { class: 'fila-entre' }, h('h1', null, 'Artículos'),
      esAdmin() ? h('button', { class: 'btn btn-pri', onclick: () => editarArticulo() }, icono('mas1', 18), 'Nuevo') : null),
    h('div', { class: 'filtros' }, buscar, selCat,
      esAdmin() ? h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: e => { inactivos = e.target.checked; pintar(); } }), 'Ver desactivados') : null),
    h('a', { class: 'btn btn-ter btn-chico', href: '#/donde' }, icono('mapa', 18), '¿Dónde está el material? (por evento)'),
    total, lista);
  pintar();
}

export function editarArticulo(a = null) {
  const f = {};
  const inp = (k, attrs = {}) => (f[k] = h('input', { class: 'input', value: a?.[k] ?? '', ...attrs }));
  const sel = (k, ops, val) => (f[k] = h('select', { class: 'input' }, ops.map(o => h('option', { value: o, selected: o === val }, o || '—'))));
  const picker = h('input', { type: 'color', class: 'input-color', value: a?.color_hex || '#888888', 'aria-label': 'Elegir color' });
  inp('color_hex', { placeholder: '#000000', maxlength: 7 });
  picker.oninput = () => { f.color_hex.value = picker.value.toUpperCase(); };
  f.notas = h('textarea', { class: 'input', rows: 2 }, a?.notas || '');
  const inicial = a ? null : h('input', { class: 'input', type: 'number', min: 0, inputmode: 'numeric', value: 0 });
  const escInicial = a ? null : h('select', { class: 'input' }, h('option', { value: 'escaneado' }, 'Sí, ya se escanearon'), h('option', { value: 'sin_escaneo' }, 'No, quedan pendientes de escanear'));
  const activo = a ? h('input', { type: 'checkbox', checked: a.activo }) : null;
  const cont = h('div', { class: 'form-grid' },
    campo('Código *', inp('codigo', { placeholder: 'EXT-10-N', autocapitalize: 'characters' }), 'Único para cada artículo'),
    campo('Nombre *', inp('nombre', { placeholder: 'Extensión' })),
    campo('Categoría', inp('categoria', { placeholder: 'Eléctrico' })),
    campo('Unidad', sel('unidad', UNIDADES, a?.unidad || 'pieza')),
    campo('Color', inp('color_nombre', { placeholder: 'Negra' })),
    campo('Muestra de color', h('div', { class: 'fila' }, picker, f.color_hex)),
    campo('Longitud / medida', inp('medida', { type: 'number', step: '0.01', min: 0, inputmode: 'decimal', placeholder: '10' })),
    campo('Unidad de medida', sel('unidad_medida', MEDIDAS, a?.unidad_medida || '')),
    campo('Tamaño', inp('tamano', { placeholder: 'Grande, 3x3 m…' })),
    campo('Marca / modelo', inp('marca_modelo')),
    h('div', { class: 'span2' }, campo('Notas', f.notas)),
    inicial ? campo('Cantidad inicial en almacén', inicial) : null,
    escInicial ? campo('¿Ya están escaneadas?', escInicial) : null,
    activo ? h('label', { class: 'check span2' }, activo, 'Artículo activo (desmárcalo para desactivarlo; su historial se conserva)') : null);
  return modal({ titulo: a ? 'Editar artículo' : 'Nuevo artículo', contenido: cont, ancho: '640px',
    acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', clase: 'btn-pri', alHacer: async () => {
      if (!f.codigo.value.trim() || !f.nombre.value.trim()) { toast('Código y nombre son obligatorios', 'error'); return false; }
      const args = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim()]));
      if (a) { args.id = a.id; args.activo = activo.checked; } else { args.cantidad_inicial = Number(inicial.value) || 0; args.escaneo_inicial = escInicial.value; }
      const r = await ejecutar('guardar_articulo', args);
      if (!informar(r, a ? 'Artículo actualizado' : 'Artículo dado de alta')) return false;
      recargar();
    } }] });
}
