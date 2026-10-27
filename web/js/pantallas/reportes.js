import { leer } from '../api.js';
import { estadoCola } from '../cola.js';
import { h, icono, toast, fecha, fechaHora, ESTADOS_EVENTO, CONCILIACION, TIPO_INCIDENCIA, ESTADO_INCIDENCIA, descripcionVariante, formatoNum, confirmar, chipEstado } from '../ui.js';
import { estado } from '../estado.js';
import { crearXlsx, descargar } from '../xlsx.js';

const FILTROS = {
  todos: 'Todos los materiales',
  faltantes: 'Solo faltantes',
  sobrantes: 'Solo sobrantes',
  salida: 'Listado original de salida',
};

export async function render(p) {
  const eventos = await leer('v_eventos', { order: 'fecha.desc', limit: 300 });
  const pre = sessionStorage.getItem('inv.reporteEvento');
  sessionStorage.removeItem('inv.reporteEvento');
  const elegidos = new Set(pre ? [pre] : []);
  let filtro = 'todos';

  const listaEv = h('ul', { class: 'lista lista-check' }, eventos.map(e => {
    const cb = h('input', { type: 'checkbox', checked: elegidos.has(e.id), onchange: ev => { ev.target.checked ? elegidos.add(e.id) : elegidos.delete(e.id); } });
    return h('li', null, h('label', { class: 'lista-item' }, cb,
      h('div', { class: 'crece' }, h('strong', null, e.nombre), h('div', { class: 'tenue pequeno' }, fecha(e.fecha))), chipEstado(e.estado)));
  }));
  const selFiltro = h('div', { class: 'opciones' }, Object.entries(FILTROS).map(([k, t]) =>
    h('label', { class: 'opcion' }, h('input', { type: 'radio', name: 'filtro', value: k, checked: k === filtro, onchange: () => (filtro = k) }), t)));

  p.append(
    h('h1', null, 'Reportes'),
    h('p', { class: 'tenue' }, 'Elige uno o varios eventos. Los reportes usan solo datos confirmados por el servidor.'),
    h('h2', { class: 'seccion' }, '1. Eventos'),
    h('div', { class: 'fila' },
      h('button', { class: 'btn btn-ter btn-chico', onclick: () => { listaEv.querySelectorAll('input').forEach((c, i) => { c.checked = true; elegidos.add(eventos[i].id); }); } }, 'Todos'),
      h('button', { class: 'btn btn-ter btn-chico', onclick: () => { listaEv.querySelectorAll('input').forEach(c => { c.checked = false; }); elegidos.clear(); } }, 'Ninguno')),
    listaEv,
    h('h2', { class: 'seccion' }, '2. Contenido'), selFiltro,
    h('h2', { class: 'seccion' }, '3. Exportar'),
    h('div', { class: 'fila acciones' },
      h('button', { class: 'btn btn-pri', onclick: () => generar('pdf') }, icono('descarga', 18), 'PDF (imprimir)'),
      h('button', { class: 'btn btn-pri', onclick: () => generar('xlsx') }, icono('descarga', 18), 'Excel (.xlsx)')),
    h('p', { class: 'tenue pequeno' }, 'PDF: se abre la vista de impresión; elige "Guardar como PDF".'));

  async function generar(tipo) {
    if (!elegidos.size) return toast('Elige al menos un evento', 'error');
    const cola = await estadoCola();
    if (cola.pendientes) {
      const seguir = await confirmar('Hay datos sin enviar',
        `Este celular tiene ${cola.pendientes} operación(es) sin sincronizar. El reporte NO las incluye. ¿Generarlo de todos modos?`, 'Generar');
      if (!seguir) return;
    }
    let datos;
    try { datos = await cargarDatos([...elegidos]); }
    catch (e) { return toast('Se necesita conexión para generar reportes con datos confirmados', 'error'); }
    const ahora = new Date();
    const sello = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}_${String(ahora.getHours()).padStart(2, '0')}${String(ahora.getMinutes()).padStart(2, '0')}`;
    const base = datos.eventos.length === 1 ? `Evento_${limpiar(datos.eventos[0].nombre)}` : `Eventos_${datos.eventos.length}`;
    const sufijo = filtro === 'todos' ? '' : `_${filtro}`;
    const nombre = `${base}${sufijo}_${sello}`;
    if (tipo === 'xlsx') {
      descargar(excel(datos, filtro, ahora), `${nombre}.xlsx`);
      toast('Excel generado', 'ok');
    } else imprimir(datos, filtro, ahora, nombre);
  }
}

const limpiar = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/_+/g, '_').slice(0, 40);

async function cargarDatos(ids) {
  const lista = `in.(${ids.join(',')})`;
  const [eventos, items, difs] = await Promise.all([
    leer('v_eventos', { id: lista, order: 'fecha.asc' }),
    leer('v_evento_items', { evento_id: lista, order: 'evento_nombre.asc,nombre.asc,color_nombre.asc,medida.asc' }),
    leer('v_incidencias', { evento_id: lista, order: 'created_at.asc' }),
  ]);
  return { eventos, items, difs };
}

function filtrarItems(items, filtro) {
  if (filtro === 'faltantes') return items.filter(i => i.faltante > 0);
  if (filtro === 'sobrantes') return items.filter(i => i.sobrante > 0);
  if (filtro === 'salida') return items.filter(i => i.cantidad_planeada > 0 || i.entregada > 0);
  return items;
}
function filtrarDifs(difs, filtro) {
  if (filtro === 'faltantes') return difs.filter(d => d.tipo === 'faltante');
  if (filtro === 'sobrantes') return difs.filter(d => d.tipo === 'sobrante');
  if (filtro === 'salida') return [];
  return difs;
}

function totales(items) {
  const s = k => items.reduce((a, i) => a + (i[k] || 0), 0);
  return { planeado: s('cantidad_planeada'), entregado: s('entregada'), contado: s('regresada'), faltante: s('faltante'),
    sobrante: s('sobrante'), danado: s('danada'), baja: s('baja') };
}

function excel({ eventos, items, difs }, filtro, ahora) {
  const generado = `Generado: ${fechaHora(ahora)} por ${estado.perfil.nombre}`;
  const resumen = {
    nombre: 'Resumen',
    titulo: ['Resumen de eventos', generado, `Contenido: ${FILTROS[filtro]}`],
    columnas: [
      { titulo: 'Evento', ancho: 28 }, { titulo: 'Fecha', ancho: 12 }, { titulo: 'Ubicación', ancho: 20 }, { titulo: 'Estado', ancho: 16 },
      { titulo: 'Responsable', ancho: 20 }, { titulo: 'Planeado', tipo: 'n', ancho: 10 }, { titulo: 'Entregado', tipo: 'n', ancho: 10 },
      { titulo: 'Contado de regreso', tipo: 'n', ancho: 12 }, { titulo: 'Faltante', tipo: 'n', ancho: 10 }, { titulo: 'Sobrante', tipo: 'n', ancho: 10 },
      { titulo: 'Dañado', tipo: 'n', ancho: 10 }, { titulo: 'Baja aprobada', tipo: 'n', ancho: 10 }, { titulo: 'Diferencias sin resolver', tipo: 'n', ancho: 14 },
      { titulo: 'Cierre', ancho: 30 }],
    filas: eventos.map(e => {
      const t = totales(items.filter(i => i.evento_id === e.id));
      return [e.nombre, e.fecha, e.ubicacion, ESTADOS_EVENTO[e.estado]?.texto, e.creado_por_nombre, t.planeado, t.entregado, t.contado,
        t.faltante, t.sobrante, t.danado, t.baja, e.incidencias_abiertas,
        e.estado === 'cerrado' ? `${e.cierre_forzado ? 'Forzado' : 'Normal'} · ${e.cerrado_por_nombre || ''} · ${fechaHora(e.cerrado_at)}` : ''];
    }),
  };
  const salida = filtro === 'salida';
  const detalle = {
    nombre: salida ? 'Listado de salida' : 'Detalle',
    columnas: [
      { titulo: 'Evento', ancho: 24 }, { titulo: 'Artículo', ancho: 24 }, { titulo: 'SKU', ancho: 14 }, { titulo: 'Color', ancho: 12 },
      { titulo: 'Color hex', ancho: 10 }, { titulo: 'Medida', tipo: 'n', ancho: 9 }, { titulo: 'Unidad de medida', ancho: 10 },
      { titulo: 'Unidad de inventario', ancho: 11 }, { titulo: 'Planeado', tipo: 'n', ancho: 10 }, { titulo: 'Entregado', tipo: 'n', ancho: 10 },
      ...(salida ? [] : [{ titulo: 'Contado de regreso', tipo: 'n', ancho: 12 }, { titulo: 'Dañadas', tipo: 'n', ancho: 9 },
        { titulo: 'Faltante', tipo: 'n', ancho: 9 }, { titulo: 'Sobrante', tipo: 'n', ancho: 9 }, { titulo: 'Baja aprobada', tipo: 'n', ancho: 10 },
        { titulo: 'Diferencia (contado − entregado)', tipo: 'n', ancho: 14 }, { titulo: 'Estado', ancho: 12 }])],
    filas: filtrarItems(items, filtro).map(i => [i.evento_nombre, i.nombre, i.sku, i.color_nombre, i.color_hex,
      i.medida != null ? Number(i.medida) : null, i.unidad_medida, i.unidad_inventario, i.cantidad_planeada, i.entregada,
      ...(salida ? [] : [i.regresada, i.danada, i.faltante, i.sobrante, i.baja, i.diferencia, CONCILIACION[i.estado_conciliacion]?.texto])]),
  };
  const hojas = [resumen, detalle];
  if (!salida) hojas.push({
    nombre: 'Diferencias',
    columnas: [
      { titulo: 'Evento', ancho: 24 }, { titulo: 'Artículo', ancho: 22 }, { titulo: 'Color / medida', ancho: 16 }, { titulo: 'Tipo', ancho: 10 },
      { titulo: 'Cantidad esperada', tipo: 'n', ancho: 10 }, { titulo: 'Cantidad contada', tipo: 'n', ancho: 10 }, { titulo: 'Diferencia', tipo: 'n', ancho: 10 },
      { titulo: 'Unidades afectadas', tipo: 'n', ancho: 10 }, { titulo: 'Motivo', ancho: 20 }, { titulo: 'Estado', ancho: 14 }, { titulo: 'Notas', ancho: 30 },
      { titulo: 'Resolución', ancho: 30 }, { titulo: 'Reportó', ancho: 16 }, { titulo: 'Revisó', ancho: 16 }, { titulo: 'Fecha', ancho: 18 }, { titulo: 'Fecha revisión', ancho: 18 }],
    filas: filtrarDifs(difs, filtro).map(d => [d.evento_nombre, d.variante_nombre, descripcionVariante(d), TIPO_INCIDENCIA[d.tipo],
      d.cantidad_esperada, d.cantidad_contada, d.diferencia, d.cantidad, d.motivo, ESTADO_INCIDENCIA[d.estado]?.texto, d.notas, d.accion,
      d.reportado_por_nombre, d.revisado_por_nombre, fechaHora(d.created_at), fechaHora(d.revisado_at)]),
  });
  return crearXlsx(hojas);
}

function imprimir({ eventos, items, difs }, filtro, ahora, nombre) {
  const area = document.getElementById('area-impresion');
  const salida = filtro === 'salida';
  const color = i => h('span', { class: 'imp-color' }, i.color_hex ? h('span', { class: 'imp-punto', style: { background: i.color_hex } }) : null, i.color_nombre || '');
  area.replaceChildren(...eventos.map(e => {
    const its = filtrarItems(items.filter(i => i.evento_id === e.id), filtro);
    const ds = filtrarDifs(difs.filter(d => d.evento_id === e.id), filtro);
    const t = totales(items.filter(i => i.evento_id === e.id));
    return h('section', { class: 'imp-evento' },
      h('header', { class: 'imp-cab' },
        h('div', null, h('h1', null, e.nombre), h('p', null, `${fecha(e.fecha)}${e.ubicacion ? ' · ' + e.ubicacion : ''} · Estado: ${ESTADOS_EVENTO[e.estado]?.texto}`),
          h('p', null, `Responsable: ${e.creado_por_nombre || '—'}`, e.estado === 'cerrado' ? ` · Cerrado por ${e.cerrado_por_nombre || ''} el ${fechaHora(e.cerrado_at)}${e.cierre_forzado ? ' (CIERRE EXCEPCIONAL)' : ''}` : '')),
        h('div', { class: 'imp-gen' }, h('div', null, FILTROS[filtro]), h('div', null, `Generado ${fechaHora(ahora)}`), h('div', null, `por ${estado.perfil.nombre}`))),
      h('table', { class: 'imp-resumen' }, h('tr', null, ...[['Planeado', t.planeado], ['Entregado', t.entregado], ['Contado de regreso', t.contado], ['Faltante', t.faltante],
        ['Sobrante', t.sobrante], ['Dañado', t.danado], ['Baja aprobada', t.baja], ['Diferencias sin resolver', e.incidencias_abiertas]]
        .map(([k, v]) => h('td', null, h('small', null, k), h('strong', null, v))))),
      h('table', { class: 'imp-tabla' },
        h('thead', null, h('tr', null, ...['Artículo', 'Color', 'Medida', 'Unidad', 'Planeado', 'Entregado',
          ...(salida ? ['✓ Cargado'] : ['Contado de regreso', 'Faltante', 'Sobrante', 'Dañadas', 'Estado'])].map(x => h('th', null, x)))),
        h('tbody', null, its.length ? its.map(i => h('tr', null,
          h('td', null, i.nombre, i.sku ? h('small', null, ` ${i.sku}`) : null), h('td', null, color(i)),
          h('td', null, i.medida ? `${formatoNum(i.medida)} ${i.unidad_medida || ''}` : ''), h('td', null, i.unidad_inventario),
          h('td', { class: 'n' }, i.cantidad_planeada), h('td', { class: 'n' }, i.entregada),
          ...(salida ? [h('td', null, '')] : [h('td', { class: 'n' }, i.regresada), h('td', { class: 'n' }, i.faltante || ''), h('td', { class: 'n' }, i.sobrante || ''),
            h('td', { class: 'n' }, i.danada || ''), h('td', null, CONCILIACION[i.estado_conciliacion]?.texto)]))) :
          h('tr', null, h('td', { colspan: 11 }, 'Sin artículos para este filtro.')))),
      ds.length ? h('div', null, h('h2', null, 'Diferencias y observaciones'),
        h('table', { class: 'imp-tabla' }, h('thead', null, h('tr', null, ...['Artículo', 'Tipo', 'Esperado', 'Contado', 'Dif.', 'Motivo', 'Estado', 'Notas / resolución'].map(x => h('th', null, x)))),
          h('tbody', null, ds.map(d => h('tr', null, h('td', null, d.variante_nombre, h('small', null, ` ${descripcionVariante(d)}`)), h('td', null, TIPO_INCIDENCIA[d.tipo]),
            h('td', { class: 'n' }, d.cantidad_esperada), h('td', { class: 'n' }, d.cantidad_contada), h('td', { class: 'n' }, d.diferencia > 0 ? `+${d.diferencia}` : d.diferencia),
            h('td', null, d.motivo), h('td', null, ESTADO_INCIDENCIA[d.estado]?.texto), h('td', null, [d.notas, d.accion].filter(Boolean).join(' · '))))))) : null,
      h('footer', { class: 'imp-firmas' }, h('div', null, 'Entregó'), h('div', null, 'Recibió')));
  }));
  const tituloAnterior = document.title;
  document.title = nombre;
  document.body.classList.add('imprimiendo');
  const fin = () => { document.title = tituloAnterior; document.body.classList.remove('imprimiendo'); window.removeEventListener('afterprint', fin); };
  window.addEventListener('afterprint', fin);
  setTimeout(() => window.print(), 100);
}
