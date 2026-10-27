import { leer } from '../api.js';
import { conCache, encolar, directo } from '../cola.js';
import { h, chipEstado, chipConciliacion, fecha, vacio, hace, icono, modal, campo, toast, tituloVariante, contador,
         pedirAutorizacion, confirmar, fechaHora } from '../ui.js';
import { esAdmin, puedeSalidas, puedeRecogidas, informar } from '../estado.js';
import { recargar } from '../app.js';
import { elegirArticulo } from './componentes.js';
import { editarEvento } from './eventos.js';
import { metrica } from './inicio.js';

export async function render(p, id) {
  const [{ datos: [ev], desdeCache, t }, { datos: items }] = await Promise.all([
    conCache(`evento.${id}`, () => leer('v_eventos', { id: `eq.${id}` })),
    conCache(`evento.${id}.items`, () => leer('v_evento_items', { evento_id: `eq.${id}`, order: 'nombre.asc,color_nombre.asc,medida.asc' })),
  ]);
  if (!ev) { p.append(vacio('Evento no encontrado')); return; }
  const editablePlan = esAdmin() && ['borrador', 'activo'].includes(ev.estado);

  // Acciones según estado y rol
  const acciones = [];
  const btn = (txt, clase, fn, ic) => h('button', { class: `btn ${clase}`, type: 'button', onclick: fn }, ic ? icono(ic, 18) : null, txt);
  const enlace = (txt, clase, href, ic) => h('a', { class: `btn ${clase}`, href }, ic ? icono(ic, 18) : null, txt);
  if (ev.estado === 'borrador' && esAdmin()) {
    acciones.push(btn('Activar y reservar material', 'btn-pri', () => cambiarEstado(ev, 'activo')));
  }
  if (ev.estado === 'activo') {
    if (puedeSalidas()) acciones.push(enlace('Registrar salida', 'btn-pri', `#/evento/${id}/salida`, 'salida'));
    if (puedeRecogidas()) acciones.push(enlace('Registrar recogida', 'btn-sec', `#/evento/${id}/recogida`, 'recogida'));
    if (esAdmin() || puedeRecogidas()) acciones.push(btn('Terminar salidas · pasar a recogida', 'btn-sec', () => cambiarEstado(ev, 'recogida')));
  }
  if (ev.estado === 'recogida') {
    if (puedeRecogidas()) acciones.push(enlace('Registrar recogida', 'btn-pri', `#/evento/${id}/recogida`, 'recogida'));
    if (puedeRecogidas()) acciones.push(btn(ev.conteo_terminado ? 'Recalcular diferencias' : 'Terminar conteo', 'btn-sec', () => terminarConteo(ev)));
    if (esAdmin() || puedeRecogidas()) acciones.push(enlace(`Diferencias${ev.incidencias_abiertas ? ` (${ev.incidencias_abiertas})` : ''}`, 'btn-sec', `#/evento/${id}/diferencias`, 'diferencias'));
    if (esAdmin()) acciones.push(btn('Cerrar evento', 'btn-sec', () => cambiarEstado(ev, 'cerrado')));
  }
  if (ev.estado === 'cerrado' && esAdmin()) acciones.push(btn('Reabrir evento', 'btn-sec', () => cambiarEstado(ev, 'recogida')));

  const secundarias = [
    enlace('Movimientos', 'btn-ter', `#/evento/${id}/movimientos`, 'lista'),
    ev.estado !== 'borrador' ? enlace('Diferencias', 'btn-ter', `#/evento/${id}/diferencias`, 'diferencias') : null,
    h('a', { class: 'btn btn-ter', href: '#/reportes', onclick: () => sessionStorage.setItem('inv.reporteEvento', id) }, icono('descarga', 18), 'Exportar PDF / Excel'),
    esAdmin() && ev.estado !== 'cerrado' ? btn('Editar datos', 'btn-ter', () => editarEvento(ev), 'editar') : null,
    esAdmin() && ev.estado === 'activo' && !ev.total_entregado ? btn('Volver a borrador', 'btn-ter', () => cambiarEstado(ev, 'borrador')) : null,
    esAdmin() && ev.estado === 'recogida' ? btn('Volver a salidas', 'btn-ter', () => cambiarEstado(ev, 'activo')) : null,
    esAdmin() && ev.estado === 'borrador' ? btn('Cancelar evento', 'btn-ter', () => cambiarEstado(ev, 'cerrado')) : null,
  ];

  // Lista de materiales
  let filtro = 'todos';
  const lista = h('div', { class: 'tabla-items' });
  const pintar = () => {
    const vis = items.filter(it => filtro === 'todos' || it.estado_conciliacion === filtro || (filtro === 'revisar' && it.por_revisar));
    lista.replaceChildren(...(vis.length ? vis.map(it => {
      const fila = h('div', { class: `item ${editablePlan ? 'item-editable' : ''}`, role: editablePlan ? 'button' : null, tabindex: editablePlan ? 0 : null },
        tituloVariante(it),
        h('div', { class: 'item-nums' },
          num('Planeado', it.cantidad_planeada),
          num('Entregado', it.entregada),
          num('Contado', it.regresada, it.danada ? `${it.danada} dañada${it.danada > 1 ? 's' : ''}` : null),
          num('Diferencia', it.entregada || it.regresada ? (it.diferencia > 0 ? `+${it.diferencia}` : it.diferencia) : '—', it.baja ? `${it.baja} de baja` : null,
            it.diferencia < 0 ? 'rojo' : it.diferencia > 0 ? 'morado' : null)),
        h('div', { class: 'item-estado' }, chipConciliacion(it.estado_conciliacion), it.por_revisar ? h('span', { class: 'chip chip-ambar' }, 'Por revisar') : null));
      if (editablePlan) {
        const abrir = () => editarPlan(ev, it);
        fila.addEventListener('click', abrir);
        fila.addEventListener('keydown', e => { if (e.key === 'Enter') abrir(); });
      }
      return fila;
    }) : [vacio(items.length ? 'Ningún artículo con este filtro.' : 'Este evento todavía no tiene materiales.',
      editablePlan ? btn('Agregar material', 'btn-pri', () => agregar(ev, items), 'mas1') : null)]));
  };
  const filtros = h('div', { class: 'chips-filtro' }, [['todos', 'Todos'], ['pendiente', 'Pendientes'], ['parcial', 'Parciales'], ['completo', 'Completos'],
    ['faltante', 'Faltantes'], ['sobrante', 'Sobrantes'], ['danado', 'Dañados'], ['revisar', 'Por revisar']].map(([k, txt]) =>
    h('button', { type: 'button', class: `chip-btn ${k === filtro ? 'activo' : ''}`, 'aria-pressed': String(k === filtro), onclick: e => {
      filtro = k; filtros.querySelectorAll('.chip-btn').forEach(b => { b.classList.toggle('activo', b === e.currentTarget); b.setAttribute('aria-pressed', String(b === e.currentTarget)); }); pintar(); } }, txt)));

  p.append(
    h('a', { class: 'volver', href: '#/eventos' }, icono('atras', 18), 'Eventos'),
    desdeCache ? h('div', { class: 'aviso aviso-aviso' }, `Sin conexión: datos guardados ${hace(t)}.`) : null,
    h('div', { class: 'fila-entre' }, h('h1', null, ev.nombre), chipEstado(ev.estado)),
    h('p', { class: 'subtitulo' }, fecha(ev.fecha), ev.ubicacion ? ` · ${ev.ubicacion}` : ''),
    ev.notas ? h('p', { class: 'notas' }, ev.notas) : null,
    ev.cierre_forzado ? h('div', { class: 'aviso aviso-error' }, `Cerrado con diferencias pendientes, autorizado por ${ev.cerrado_por_nombre} el ${fechaHora(ev.cerrado_at)}.`) : null,
    ev.estado === 'borrador' ? h('div', { class: 'aviso' }, 'Borrador: arma la lista de materiales. Al activarlo se reserva la existencia y se pueden registrar salidas.') : null,
    ev.estado === 'recogida' && !ev.conteo_terminado ? h('div', { class: 'aviso' }, 'Cuando termines de contar todo lo que regresó, pulsa "Terminar conteo" para generar las diferencias.') : null,
    h('div', { class: 'metricas' },
      metrica('Planeado', ev.total_planeado), metrica('Entregado', ev.total_entregado),
      metrica('Contado', ev.total_regresado), metrica('Por recoger', ev.total_por_recoger, ev.total_por_recoger && ev.estado === 'recogida' ? 'ambar' : null)),
    acciones.length ? h('div', { class: 'acciones-principales' }, acciones) : null,
    h('div', { class: 'fila-entre' }, h('h2', { class: 'seccion' }, `Materiales (${items.length})`),
      editablePlan && items.length ? btn('Agregar', 'btn-sec btn-chico', () => agregar(ev, items), 'mas1') : null),
    items.length ? filtros : null,
    lista,
    h('div', { class: 'acciones-secundarias' }, secundarias),
    h('p', { class: 'tenue pequeno' }, `Creado por ${ev.creado_por_nombre || '—'} el ${fechaHora(ev.created_at)}`));
  pintar();
}

function num(etq, val, sub, clase) {
  return h('div', { class: `num ${clase ? 'texto-' + clase : ''}` }, h('span', { class: 'num-etq' }, etq), h('strong', null, val), sub ? h('small', null, sub) : null);
}

async function agregar(ev, items) {
  const r = await elegirArticulo({ titulo: `Agregar a ${ev.nombre}`, excluir: items.map(i => i.variante_id), etiquetaCantidad: 'Cantidad planeada' });
  if (!r) return;
  await guardarPlan(ev, r.variante, r.cantidad);
}

async function editarPlan(ev, it) {
  let cant = it.cantidad_planeada;
  const r = await modal({
    titulo: 'Cantidad planeada',
    contenido: h('div', { class: 'pila' }, tituloVariante(it),
      h('p', { class: 'tenue' }, `Disponible para este evento: ${it.disponible_para_evento} · Ya entregado: ${it.entregada}`),
      contador({ valor: cant, alCambiar: v => (cant = v) })),
    acciones: [{ texto: 'Cancelar', valor: null }, { texto: 'Guardar', clase: 'btn-pri', valor: 'ok' }],
  });
  if (r) await guardarPlan(ev, it, cant);
}

async function guardarPlan(ev, v, cantidad, aut = null) {
  const args = { evento_id: ev.id, variante_id: v.variante_id || v.id, cantidad };
  let res;
  if (aut) {
    try { res = await directo('planear_item', { ...args, forzar: true, motivo: aut.motivo, pin: aut.pin }); }
    catch (e) { return toast(e.message, 'error'); }
    if (!res.ok) return toast(res.error, 'error');
    toast('Reserva excepcional autorizada', 'aviso');
    return recargar();
  }
  const op = await encolar('planear_item', args, `Planear ${v.nombre}`);
  if (op.estado === 'error' && op.resultado?.codigo === 'sin_disponible') {
    const si = await confirmar('No hay suficiente disponible', `${op.error}. ¿Autorizar una reserva excepcional por encima de lo disponible?`, 'Autorizar con PIN', 'btn-peligro');
    if (!si) return;
    const a = await pedirAutorizacion({ titulo: 'Reserva excepcional' });
    if (a) return guardarPlan(ev, v, cantidad, a);
    return;
  }
  if (informar(op, 'Cantidad planeada guardada')) recargar();
}

async function terminarConteo(ev) {
  const si = await confirmar(ev.conteo_terminado ? 'Recalcular diferencias' : 'Terminar conteo',
    'Se compararán las cantidades entregadas con las contadas y se generarán las incidencias de faltantes, sobrantes y daños. Aún podrás registrar material que llegue después.',
    ev.conteo_terminado ? 'Recalcular' : 'Terminar conteo');
  if (!si) return;
  const op = await encolar('terminar_conteo', { evento_id: ev.id }, `Terminar conteo ${ev.nombre}`);
  if (informar(op, 'Conteo terminado')) {
    const r = op.resultado || {};
    if (r.incidencias_abiertas) toast(`${r.incidencias_abiertas} diferencia(s) por revisar`, 'aviso', 5000);
    recargar();
  }
}

async function cambiarEstado(ev, nuevo, aut = null) {
  const textos = {
    activo: ev.estado === 'borrador' ? ['Activar evento', 'Se reservará la existencia de todos los materiales planeados.'] : ['Volver a salidas', 'El evento regresa a estado activo para registrar más salidas.'],
    recogida: ev.estado === 'cerrado' ? null : ['Pasar a recogida', 'Ya no se registrarán más salidas. Se liberan las reservas no entregadas.'],
    cerrado: ev.estado === 'borrador' ? ['Cancelar evento', 'El evento se cerrará sin movimientos.'] : ['Cerrar evento', 'El evento quedará de solo lectura.'],
    borrador: ['Volver a borrador', 'Se liberan las reservas.'],
  };
  if (!aut) {
    if (ev.estado === 'cerrado' && nuevo === 'recogida') {
      aut = await pedirAutorizacion({ titulo: 'Reabrir evento', mensaje: 'Reabrir un evento cerrado queda registrado en la bitácora.' });
      if (!aut) return;
    } else {
      const [t, m] = textos[nuevo];
      if (!(await confirmar(t, m, t))) return;
    }
  }
  let res;
  try {
    res = await directo('cambiar_estado_evento', { evento_id: ev.id, estado: nuevo, ...(aut ? { forzar: true, motivo: aut.motivo, pin: aut.pin } : {}) });
  } catch (e) { return toast(e.message === 'Sin conexión con el servidor' ? 'Para cambiar el estado del evento se necesita conexión' : e.message, 'error'); }
  if (res.ok) { toast('Estado actualizado', 'ok'); return recargar(); }

  if (esAdmin() && ['sin_disponible', 'diferencias_pendientes'].includes(res.codigo) && !aut) {
    let detalle = res.error;
    if (res.articulos) detalle += ': ' + res.articulos.map(a => `${a.nombre} (planeado ${a.planeada}, disponible ${a.disponible})`).join('; ');
    if (res.pendientes) {
      const pd = res.pendientes;
      detalle += `. Incidencias abiertas: ${pd.incidencias_abiertas}; por recoger: ${pd.por_recoger}; sobrante sin revisar: ${pd.sobrante_sin_revisar}; dañado sin revisar: ${pd.danado_sin_revisar}.`;
    }
    const si = await confirmar('No se puede sin autorización', `${detalle} ¿Autorizar de forma excepcional?`, 'Autorizar con PIN', 'btn-peligro');
    if (!si) return;
    const a = await pedirAutorizacion({ titulo: nuevo === 'cerrado' ? 'Cierre excepcional' : 'Activación excepcional' });
    if (a) return cambiarEstado(ev, nuevo, a);
    return;
  }
  toast(res.error, 'error', 6000);
}
