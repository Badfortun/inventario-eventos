// Reportes: inventario general y eventos, en Excel (.xlsx) y PDF (imprimir)
import { leer } from '../api.js';
import { h, icono, toast, fecha, fechaHora, descripcionVariante, formatoNum, chipEstadoEvento } from '../ui.js';
import { estado } from '../estado.js';
import { crearXlsx, descargar } from '../xlsx.js';

const sello = d => `${d.toISOString().slice(0, 10)}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
const limpiar = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/_+/g, '_').slice(0, 40);
const esc = (v, n) => (v === 'escaneado' ? `Sí (${n || ''})` : v === 'sin_escaneo' ? 'No' : '');

export async function render(p) {
  const eventos = await leer('v_lugares', { tipo: 'eq.evento', order: 'fecha.desc', limit: 300 });
  const pre = sessionStorage.getItem('inv2.reporteEvento');
  sessionStorage.removeItem('inv2.reporteEvento');
  const elegidos = new Set(pre && eventos.some(e => e.id === pre) ? [pre] : []);
  const lista = h('ul', { class: 'lista lista-check' }, eventos.map(e => h('li', null, h('label', { class: 'lista-item' },
    h('input', { type: 'checkbox', checked: elegidos.has(e.id), onchange: ev => (ev.target.checked ? elegidos.add(e.id) : elegidos.delete(e.id)) }),
    h('div', { class: 'crece' }, h('strong', null, e.nombre), h('div', { class: 'tenue pequeno' }, fecha(e.fecha))), chipEstadoEvento(e.estado)))));

  p.append(
    h('h1', null, 'Reportes'),
    h('section', { class: 'tarjeta' },
      h('h2', null, 'Inventario general'),
      h('p', { class: 'tenue' }, 'Todos los artículos con su total y dónde está cada pieza: Almacén, Reparación, cada evento abierto, pérdidas y bajas.'),
      h('div', { class: 'fila acciones' },
        h('button', { class: 'btn btn-pri', onclick: () => inventario('xlsx') }, icono('descarga', 18), 'Excel'),
        h('button', { class: 'btn btn-sec', onclick: () => inventario('pdf') }, icono('descarga', 18), 'PDF'))),
    h('section', { class: 'tarjeta' },
      h('h2', null, 'Eventos'),
      h('p', { class: 'tenue' }, 'Por evento: qué llegó, a dónde se fue cada pieza, faltantes, pérdidas y quién escaneó cada movimiento.'),
      lista,
      h('div', { class: 'fila acciones' },
        h('button', { class: 'btn btn-pri', onclick: () => reporteEventos('xlsx') }, icono('descarga', 18), 'Excel'),
        h('button', { class: 'btn btn-sec', onclick: () => reporteEventos('pdf') }, icono('descarga', 18), 'PDF'))),
    h('p', { class: 'tenue pequeno' }, 'PDF: se abre la vista de impresión; elige "Guardar como PDF".'));

  async function reporteEventos(tipo) {
    if (!elegidos.size) return toast('Elige al menos un evento', 'error');
    let datos;
    try { datos = await cargarEventos([...elegidos]); } catch { return toast('Se necesita conexión a internet', 'error'); }
    const ahora = new Date();
    const nombre = `${datos.eventos.length === 1 ? 'Evento_' + limpiar(datos.eventos[0].nombre) : 'Eventos_' + datos.eventos.length}_${sello(ahora)}`;
    if (tipo === 'xlsx') { descargar(excelEventos(datos, ahora), `${nombre}.xlsx`); toast('Excel generado', 'ok'); }
    else imprimir(htmlEventos(datos, ahora), nombre);
  }
}

async function cargarEventos(ids) {
  const eventos = await leer('v_lugares', { id: `in.(${ids.join(',')})`, order: 'fecha.asc' });
  const resumen = await leer('v_evento_resumen', { evento_id: `in.(${ids.join(',')})`, order: 'nombre.asc' });
  const movs = (await Promise.all(ids.map(id => leer('v_movimiento_items', { or: `(origen_id.eq.${id},destino_id.eq.${id})`, order: 'created_at.asc' })))).flat();
  const vistos = new Set();
  return { eventos, resumen, movs: movs.filter(m => (vistos.has(m.id) ? false : vistos.add(m.id))) };
}

const ESTADO = { aplicado: 'Registrado', por_autorizar: 'Por autorizar', rechazado: 'Rechazado', revertido: 'Corregido' };

function excelEventos({ eventos, resumen, movs }, ahora) {
  const gen = `Generado ${fechaHora(ahora)} por ${estado.perfil.nombre}`;
  return crearXlsx([
    { nombre: 'Resumen', titulo: ['Resumen por evento y artículo', gen],
      columnas: [{ titulo: 'Evento', ancho: 22 }, { titulo: 'Estado', ancho: 10 }, { titulo: 'Código', ancho: 12 }, { titulo: 'Artículo', ancho: 20 }, { titulo: 'Color / medida', ancho: 16 },
        { titulo: 'Llegó', tipo: 'n', ancho: 8 }, { titulo: 'Llegó de otros eventos', tipo: 'n', ancho: 11 }, { titulo: 'Regresó al almacén', tipo: 'n', ancho: 10 },
        { titulo: 'Dañadas', tipo: 'n', ancho: 8 }, { titulo: 'A otros eventos', tipo: 'n', ancho: 10 }, { titulo: 'A reparación', tipo: 'n', ancho: 10 },
        { titulo: 'Sobrante', tipo: 'n', ancho: 9 }, { titulo: 'Sigue en el evento', tipo: 'n', ancho: 10 }, { titulo: 'Pérdidas confirmadas', tipo: 'n', ancho: 11 }],
      filas: resumen.map(r => [r.evento_nombre, r.evento_estado === 'abierto' ? 'Abierto' : 'Cerrado', r.codigo, r.nombre, descripcionVariante(r),
        r.llego, r.llego_de_eventos, r.regreso_almacen, r.danadas, r.a_otros_eventos, r.a_reparacion, r.sobrante, r.en_evento, r.perdidas]) },
    { nombre: 'Faltantes y pérdidas',
      columnas: [{ titulo: 'Evento', ancho: 22 }, { titulo: 'Código', ancho: 12 }, { titulo: 'Artículo', ancho: 20 }, { titulo: 'Color / medida', ancho: 16 },
        { titulo: 'Situación', ancho: 26 }, { titulo: 'Cantidad', tipo: 'n', ancho: 9 }],
      filas: resumen.filter(r => r.en_evento > 0 || r.perdidas > 0).map(r => [r.evento_nombre, r.codigo, r.nombre, descripcionVariante(r),
        r.perdidas > 0 ? 'Pérdida confirmada (evento cerrado)' : 'Sin regresar (evento abierto)', r.perdidas || r.en_evento]) },
    { nombre: 'Movimientos',
      columnas: [{ titulo: 'Fecha', ancho: 18 }, { titulo: 'Desde', ancho: 18 }, { titulo: 'Hacia', ancho: 18 }, { titulo: 'Estado', ancho: 12 }, { titulo: 'Código', ancho: 12 },
        { titulo: 'Artículo', ancho: 20 }, { titulo: 'Cantidad', tipo: 'n', ancho: 9 }, { titulo: 'Dañadas', tipo: 'n', ancho: 8 }, { titulo: 'Sobrante', tipo: 'n', ancho: 8 },
        { titulo: 'Salida escaneada (entregó)', ancho: 22 }, { titulo: 'Entrada escaneada (entregó)', ancho: 22 }, { titulo: 'Registró', ancho: 16 }, { titulo: 'Notas', ancho: 24 }],
      filas: movs.map(m => [fechaHora(m.created_at), m.origen_nombre, m.destino_nombre, ESTADO[m.estado], m.codigo, m.nombre, m.cantidad, m.danadas, m.sobrante,
        esc(m.escaneo_salida, m.escaneo_salida_nombre), esc(m.escaneo_entrada, m.escaneo_entrada_nombre), m.registrado_nombre, m.notas || m.motivo]) },
    { nombre: 'Eventos',
      columnas: [{ titulo: 'Evento', ancho: 24 }, { titulo: 'Inicio', ancho: 12 }, { titulo: 'Fin', ancho: 12 }, { titulo: 'Ubicación', ancho: 20 }, { titulo: 'Estado', ancho: 10 },
        { titulo: 'Piezas en el evento', tipo: 'n', ancho: 10 }, { titulo: 'Pérdidas', tipo: 'n', ancho: 9 }, { titulo: 'Cerró', ancho: 18 }],
      filas: eventos.map(e => [e.nombre, e.fecha, e.fecha_fin, e.ubicacion, e.estado === 'abierto' ? 'Abierto' : 'Cerrado', e.piezas, e.perdidas,
        e.cerrado_por_nombre ? `${e.cerrado_por_nombre} · ${fechaHora(e.cerrado_at)}` : '']) },
  ]);
}

function htmlEventos({ eventos, resumen, movs }, ahora) {
  return eventos.map(e => {
    const rs = resumen.filter(r => r.evento_id === e.id);
    const ms = movs.filter(m => m.origen_id === e.id || m.destino_id === e.id);
    const t = k => rs.reduce((s, r) => s + (r[k] || 0), 0);
    return h('section', { class: 'imp-evento' },
      h('header', { class: 'imp-cab' },
        h('div', null, h('h1', null, e.nombre), h('p', null, `${fecha(e.fecha)}${e.fecha_fin && e.fecha_fin !== e.fecha ? ' al ' + fecha(e.fecha_fin) : ''}${e.ubicacion ? ' · ' + e.ubicacion : ''} · ${e.estado === 'abierto' ? 'Abierto' : 'Cerrado'}`),
          e.estado === 'cerrado' ? h('p', null, `Cerrado por ${e.cerrado_por_nombre || ''} el ${fechaHora(e.cerrado_at)}`) : null),
        h('div', { class: 'imp-gen' }, h('div', null, `Generado ${fechaHora(ahora)}`), h('div', null, `por ${estado.perfil.nombre}`))),
      h('table', { class: 'imp-resumen' }, h('tr', null, ...[['Llegó', t('llego')], ['Regresó al almacén', t('regreso_almacen')], ['A otros eventos', t('a_otros_eventos')],
        ['A reparación', t('a_reparacion')], ['Dañadas', t('danadas')], ['Sobrante', t('sobrante')], [e.estado === 'abierto' ? 'Sigue en el evento' : 'Pérdidas', e.estado === 'abierto' ? t('en_evento') : t('perdidas')]]
        .map(([k, v]) => h('td', null, h('small', null, k), h('strong', null, v))))),
      h('table', { class: 'imp-tabla' },
        h('thead', null, h('tr', null, ...['Código', 'Artículo', 'Color / medida', 'Llegó', 'Al almacén', 'Dañadas', 'A otros eventos', 'Reparación', 'Sobrante', e.estado === 'abierto' ? 'Sigue aquí' : 'Pérdidas'].map(x => h('th', null, x)))),
        h('tbody', null, rs.length ? rs.map(r => h('tr', null, h('td', null, r.codigo), h('td', null, r.nombre),
          h('td', null, r.color_hex ? h('span', { class: 'imp-punto', style: { background: r.color_hex } }) : null, ' ', descripcionVariante(r)),
          ...[r.llego, r.regreso_almacen, r.danadas, r.a_otros_eventos, r.a_reparacion, r.sobrante, e.estado === 'abierto' ? r.en_evento : r.perdidas].map(v => h('td', { class: 'n' }, v || ''))))
          : h('tr', null, h('td', { colspan: 10 }, 'Sin movimientos')))),
      h('h2', null, 'Movimientos'),
      h('table', { class: 'imp-tabla' },
        h('thead', null, h('tr', null, ...['Fecha', 'Desde → Hacia', 'Artículo', 'Cant.', 'Salida escaneada', 'Entrada escaneada', 'Registró', 'Estado'].map(x => h('th', null, x)))),
        h('tbody', null, ms.map(m => h('tr', null, h('td', null, fechaHora(m.created_at)), h('td', null, `${m.origen_nombre || '—'} → ${m.destino_nombre || '—'}`),
          h('td', null, m.nombre, h('small', null, ` ${m.codigo}`)), h('td', { class: 'n' }, m.cantidad, m.danadas ? ` (${m.danadas} dañ.)` : ''),
          h('td', null, esc(m.escaneo_salida, m.escaneo_salida_nombre)), h('td', null, esc(m.escaneo_entrada, m.escaneo_entrada_nombre)),
          h('td', null, m.registrado_nombre), h('td', null, ESTADO[m.estado]))))),
      h('footer', { class: 'imp-firmas' }, h('div', null, 'Entregó'), h('div', null, 'Recibió')));
  });
}

async function inventario(tipo) {
  let arts, ex, eventos;
  try {
    [arts, ex, eventos] = await Promise.all([leer('v_articulos', { activo: 'eq.true', order: 'nombre.asc,color_nombre.asc,medida.asc' }),
      leer('v_existencias', {}), leer('lugares', { tipo: 'eq.evento', estado: 'eq.abierto', order: 'fecha.asc', select: 'id,nombre' })]);
  } catch { return toast('Se necesita conexión a internet', 'error'); }
  const enEv = (a, e) => ex.find(x => x.articulo_id === a && x.lugar_id === e)?.cantidad || 0;
  const ahora = new Date();
  const nombre = `Inventario_${sello(ahora)}`;
  if (tipo === 'xlsx') {
    descargar(crearXlsx([{ nombre: 'Inventario', titulo: ['Inventario general', `Generado ${fechaHora(ahora)} por ${estado.perfil.nombre}`],
      columnas: [{ titulo: 'Código', ancho: 12 }, { titulo: 'Artículo', ancho: 20 }, { titulo: 'Categoría', ancho: 14 }, { titulo: 'Color / medida', ancho: 16 }, { titulo: 'Unidad', ancho: 8 },
        { titulo: 'TOTAL', tipo: 'n', ancho: 9 }, { titulo: 'Almacén', tipo: 'n', ancho: 9 }, { titulo: 'Sin escanear', tipo: 'n', ancho: 9 }, { titulo: 'Reparación', tipo: 'n', ancho: 10 },
        ...eventos.map(e => ({ titulo: e.nombre, tipo: 'n', ancho: 12 })), { titulo: 'Pérdidas', tipo: 'n', ancho: 9 }, { titulo: 'Bajas', tipo: 'n', ancho: 8 }],
      filas: arts.map(a => [a.codigo, a.nombre, a.categoria, descripcionVariante(a), a.unidad, a.total, a.en_almacen, a.sin_escanear, a.en_reparacion,
        ...eventos.map(e => enEv(a.id, e.id)), a.perdidas, a.bajas]) }]), `${nombre}.xlsx`);
    toast('Excel generado', 'ok');
  } else {
    imprimir([h('section', { class: 'imp-evento' },
      h('header', { class: 'imp-cab' }, h('div', null, h('h1', null, 'Inventario general')), h('div', { class: 'imp-gen' }, `Generado ${fechaHora(ahora)} por ${estado.perfil.nombre}`)),
      h('table', { class: 'imp-tabla' },
        h('thead', null, h('tr', null, ...['Código', 'Artículo', 'Color / medida', 'TOTAL', 'Almacén', 'Sin escanear', 'Reparación', ...eventos.map(e => e.nombre), 'Pérdidas'].map(x => h('th', null, x)))),
        h('tbody', null, arts.map(a => h('tr', null, h('td', null, a.codigo), h('td', null, a.nombre), h('td', null, descripcionVariante(a)),
          ...[a.total, a.en_almacen, a.sin_escanear, a.en_reparacion, ...eventos.map(e => enEv(a.id, e.id)), a.perdidas].map((v, i) => h('td', { class: 'n' }, i === 0 ? h('strong', null, formatoNum(v)) : (v || '')))))))) ], nombre);
  }
}

function imprimir(secciones, nombre) {
  const area = document.getElementById('area-impresion');
  area.replaceChildren(...secciones);
  const t = document.title;
  document.title = nombre;
  window.addEventListener('afterprint', () => { document.title = t; }, { once: true });
  setTimeout(() => window.print(), 100);
}
