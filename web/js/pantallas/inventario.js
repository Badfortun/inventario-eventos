import { leer } from '../api.js';
import { conCache, encolar } from '../cola.js';
import { h, tituloVariante, vacio, hace, campo, modal, toast, icono, textoNormal, formatoNum } from '../ui.js';
import { esAdmin, informar } from '../estado.js';
import { recargar } from '../app.js';

const UNIDADES = ['pieza', 'par', 'juego', 'caja', 'rollo', 'metro', 'kit', 'paquete'];
const UNIDADES_MEDIDA = ['pies', 'metros', 'pulgadas', 'cm', 'mm'];

export async function render(p) {
  const { datos, desdeCache, t } = await conCache('inventario', () => leer('v_inventario', { order: 'nombre.asc,color_nombre.asc,medida.asc' }));
  const categorias = [...new Set(datos.map(v => v.categoria).filter(Boolean))].sort();

  let filtroTexto = sessionStorage.getItem('inv.buscar') || '';
  let filtroCat = sessionStorage.getItem('inv.cat') || '';
  let verInactivos = false;

  const buscar = h('input', { class: 'input', type: 'search', placeholder: 'Buscar por nombre, SKU, color, medida…', value: filtroTexto, 'aria-label': 'Buscar' });
  const cat = h('select', { class: 'input', 'aria-label': 'Categoría' },
    h('option', { value: '' }, 'Todas las categorías'), categorias.map(c => h('option', { value: c, selected: c === filtroCat }, c)));
  const inact = h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: e => { verInactivos = e.target.checked; pintar(); } }), 'Ver desactivados');
  const lista = h('ul', { class: 'lista' });
  const total = h('p', { class: 'tenue pequeno' });

  buscar.addEventListener('input', () => { filtroTexto = buscar.value; sessionStorage.setItem('inv.buscar', filtroTexto); pintar(); });
  cat.addEventListener('change', () => { filtroCat = cat.value; sessionStorage.setItem('inv.cat', filtroCat); pintar(); });

  function pintar() {
    const palabras = textoNormal(filtroTexto).split(/\s+/).filter(Boolean);
    const vis = datos.filter(v => (verInactivos || v.activo) && (!filtroCat || v.categoria === filtroCat) &&
      palabras.every(w => textoNormal([v.nombre, v.sku, v.color_nombre, v.categoria, v.medida, v.unidad_medida, v.ubicacion].join(' ')).includes(w)));
    total.textContent = `${vis.length} de ${datos.length} artículos`;
    lista.replaceChildren(...(vis.length ? vis.map(v => h('li', null,
      h('a', { class: `lista-item ${v.activo ? '' : 'inactivo'}`, href: `#/articulo/${v.id}` },
        tituloVariante(v),
        h('div', { class: 'existencias' },
          h('div', { class: `exist-num ${v.disponible <= 0 ? 'cero' : ''}` }, formatoNum(v.disponible)),
          h('div', { class: 'exist-etq' }, 'disponible'),
          h('div', { class: 'exist-sub' }, `${formatoNum(v.existencia)} en almacén`))))) :
      [h('li', null, vacio('No hay artículos que coincidan.'))]));
  }

  p.append(
    h('div', { class: 'fila-entre' }, h('h1', null, 'Inventario'),
      esAdmin() ? h('button', { class: 'btn btn-pri', onclick: () => editarArticulo() }, icono('mas1', 18), 'Nuevo') : null),
    desdeCache ? h('div', { class: 'aviso aviso-aviso' }, `Sin conexión: datos guardados ${hace(t)}.`) : null,
    h('div', { class: 'filtros' }, buscar, cat, esAdmin() ? inact : null),
    total, lista);
  pintar();
}

export async function editarArticulo(v = null, alGuardar) {
  const f = {};
  const inp = (k, attrs = {}) => (f[k] = h('input', { class: 'input', value: v?.[k] ?? '', ...attrs }));
  const sel = (k, opciones, valor) => (f[k] = h('select', { class: 'input' },
    opciones.map(o => h('option', { value: o, selected: o === valor }, o || '—'))));
  const colorPicker = h('input', { type: 'color', class: 'input-color', value: v?.color_hex || '#888888', 'aria-label': 'Elegir color' });
  inp('color_hex', { placeholder: '#8B4513', maxlength: 7 });
  colorPicker.addEventListener('input', () => { f.color_hex.value = colorPicker.value.toUpperCase(); });
  f.color_hex.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(f.color_hex.value)) colorPicker.value = f.color_hex.value; });
  f.notas = h('textarea', { class: 'input', rows: 2 }, v?.notas || '');
  f.descripcion = h('textarea', { class: 'input', rows: 2 }, v?.descripcion || '');
  const inicial = v ? null : h('input', { class: 'input', type: 'number', min: 0, inputmode: 'numeric', value: 0 });
  const activo = v ? h('input', { type: 'checkbox', checked: v.activo }) : null;

  const cont = h('div', { class: 'form-grid' },
    campo('Nombre del artículo *', inp('nombre', { required: true, placeholder: 'Cable de corriente' })),
    campo('Unidad de inventario *', sel('unidad_inventario', UNIDADES, v?.unidad_inventario || 'pieza'), 'Cómo se cuenta: pieza, par, juego…'),
    campo('Color (nombre)', inp('color_nombre', { placeholder: 'Café' })),
    campo('Color (muestra)', h('div', { class: 'fila' }, colorPicker, f.color_hex)),
    campo('Medida / longitud', inp('medida', { type: 'number', step: '0.01', min: 0, inputmode: 'decimal', placeholder: '25' })),
    campo('Unidad de medida', sel('unidad_medida', ['', ...UNIDADES_MEDIDA], v?.unidad_medida || '')),
    campo('SKU / código', inp('sku', { placeholder: 'CAB-CAF-25' })),
    campo('Categoría', inp('categoria', { placeholder: 'Cables' })),
    campo('Marca / modelo', inp('marca_modelo')),
    campo('Número de serie', inp('numero_serie')),
    campo('Ubicación en almacén', inp('ubicacion', { placeholder: 'Estante A3' })),
    campo('Foto (enlace)', inp('foto_url', { type: 'url', placeholder: 'https://…' })),
    h('div', { class: 'span2' }, campo('Descripción', f.descripcion)),
    h('div', { class: 'span2' }, campo('Notas', f.notas)),
    inicial ? campo('Existencia inicial', inicial, 'Cantidad contada hoy en almacén') : null,
    activo ? h('label', { class: 'check span2' }, activo, 'Artículo activo (desmarca para desactivarlo; su historial se conserva)') : null);

  return modal({
    titulo: v ? 'Editar artículo' : 'Nuevo artículo', contenido: cont, ancho: '640px',
    acciones: [{ texto: 'Cancelar', valor: null }, { texto: 'Guardar', clase: 'btn-pri', alHacer: async () => {
      if (!f.nombre.value.trim()) { toast('El nombre es obligatorio', 'error'); return false; }
      const args = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim()]));
      if (v) { args.id = v.id; args.activo = activo.checked; }
      else args.existencia_inicial = Number(inicial.value) || 0;
      const op = await encolar('guardar_variante', args, v ? `Editar ${args.nombre}` : `Alta ${args.nombre}`);
      if (!informar(op, v ? 'Artículo actualizado' : 'Artículo dado de alta')) return false;
      alGuardar ? alGuardar(op) : recargar();
      return true;
    } }],
  });
}
