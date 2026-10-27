import { leer } from '../api.js';
import { conCache, encolar, directo, leerBorrador, guardarBorrador, borrarBorrador } from '../cola.js';
import { h, vacio, hace, icono, modal, toast, tituloVariante, contador, pedirAutorizacion, confirmar, formatoNum } from '../ui.js';
import { esAdmin, puedeSalidas, informar } from '../estado.js';
import { recargar } from '../app.js';
import { elegirArticulo, bandaEvento } from './componentes.js';

export async function render(p, id) {
  const [{ datos: [ev], desdeCache, t }, { datos: items }] = await Promise.all([
    conCache(`evento.${id}`, () => leer('v_eventos', { id: `eq.${id}` })),
    conCache(`evento.${id}.items`, () => leer('v_evento_items', { evento_id: `eq.${id}`, order: 'nombre.asc,color_nombre.asc,medida.asc' })),
  ]);
  if (!ev) { p.append(vacio('Evento no encontrado')); return; }
  p.append(h('a', { class: 'volver', href: `#/evento/${id}` }, icono('atras', 18), 'Volver al evento'));
  if (!puedeSalidas()) { p.append(h('div', { class: 'aviso aviso-error' }, 'Tu usuario no tiene permiso para registrar salidas.')); return; }
  if (ev.estado !== 'activo') { p.append(bandaEvento(ev, 'salida'), h('div', { class: 'aviso aviso-error' }, 'Solo se registran salidas cuando el evento está activo.')); return; }

  const claveB = `salida.${id}`;
  const borrador = (await leerBorrador(claveB)) || { cant: {}, extras: [] };
  const extras = borrador.extras || [];   // artículos no planeados que se agregan aquí
  const lineas = [...items, ...extras.filter(x => !items.some(i => i.variante_id === x.variante_id))];
  const cant = borrador.cant || {};
  const guardar = () => guardarBorrador(claveB, { cant, extras });

  const resumen = h('div', { class: 'resumen-flotante' });
  const pintarResumen = () => {
    const n = Object.values(cant).filter(v => v > 0).length;
    const total = Object.values(cant).reduce((a, b) => a + (b || 0), 0);
    resumen.replaceChildren(
      h('div', null, h('strong', null, `${total} unidades`), h('span', { class: 'tenue' }, ` · ${n} artículo(s)`)),
      h('button', { class: 'btn btn-pri', disabled: total === 0, onclick: confirmarSalida }, 'Confirmar salida'));
  };

  const lista = h('div', { class: 'captura' });
  const pintar = () => {
    lista.replaceChildren(...(lineas.length ? lineas.map(it => {
      const vid = it.variante_id;
      const disp = it.disponible_para_evento ?? it.disponible ?? 0;
      const falta = Math.max(0, (it.cantidad_planeada || 0) - (it.entregada || 0));
      const aviso = h('div', { class: 'captura-aviso' });
      const revisar = v => {
        aviso.textContent = v > disp ? `⚠ Supera lo disponible (${disp})` : (v > falta && it.cantidad_planeada ? `Más de lo planeado (+${v - falta})` : '');
        aviso.className = `captura-aviso ${v > disp ? 'texto-rojo' : 'texto-ambar'}`;
      };
      revisar(cant[vid] || 0);
      return h('div', { class: 'captura-fila' },
        tituloVariante(it),
        h('div', { class: 'captura-info' },
          h('span', null, 'Planeado ', h('strong', null, it.cantidad_planeada || 0)),
          h('span', null, 'Ya salió ', h('strong', null, it.entregada || 0)),
          h('span', null, 'Falta ', h('strong', null, falta)),
          h('span', null, 'Disponible para este evento ', h('strong', { class: disp <= 0 ? 'texto-rojo' : '' }, formatoNum(disp)))),
        contador({ valor: cant[vid] || 0, etiqueta: `Cantidad que sale de ${it.nombre}`, alCambiar: v => { cant[vid] = v; revisar(v); guardar(); pintarResumen(); } }),
        aviso);
    }) : [vacio('Este evento no tiene materiales planeados. Agrega lo que va a salir.')]));
  };

  async function agregarExtra() {
    const r = await elegirArticulo({ titulo: 'Agregar artículo no planeado', excluir: lineas.map(l => l.variante_id), etiquetaCantidad: 'Cantidad que sale' });
    if (!r) return;
    const v = r.variante;
    const linea = { variante_id: v.id, nombre: v.nombre, color_nombre: v.color_nombre, color_hex: v.color_hex, medida: v.medida,
      unidad_medida: v.unidad_medida, sku: v.sku, cantidad_planeada: 0, entregada: 0, disponible_para_evento: v.disponible };
    extras.push(linea); lineas.push(linea);
    cant[v.id] = r.cantidad;
    guardar(); pintar(); pintarResumen();
  }

  async function confirmarSalida() {
    const sel = lineas.filter(l => cant[l.variante_id] > 0);
    const si = await modal({
      titulo: 'Confirmar salida',
      contenido: h('div', { class: 'pila' },
        h('p', null, 'Evento: ', h('strong', null, ev.nombre)),
        h('ul', { class: 'lista-simple' }, sel.map(l => h('li', null, h('strong', null, cant[l.variante_id]), ` × ${l.nombre}`,
          l.color_nombre ? ` · ${l.color_nombre}` : '', l.medida ? ` · ${formatoNum(l.medida)} ${l.unidad_medida || ''}` : ''))),
        h('p', { class: 'tenue' }, 'Se registrará a tu nombre. Si falta disponible en cualquier artículo, no se registra nada.')),
      acciones: [{ texto: 'Revisar', valor: false }, { texto: 'Registrar salida', clase: 'btn-pri', valor: true }],
    });
    if (!si) return;
    const items = sel.map(l => ({ variante_id: l.variante_id, cantidad: cant[l.variante_id] }));
    const op = await encolar('registrar_salida', { evento_id: id, items }, `Salida a ${ev.nombre} (${items.length} art.)`);
    if (op.estado === 'error' && op.resultado?.codigo === 'sin_disponible') {
      const lista = (op.resultado.articulos || []).map(a => `${a.nombre}: pides ${a.solicitado}, disponible ${a.disponible}`).join('\n');
      if (!esAdmin()) return modal({ titulo: 'No hay suficiente disponible', contenido: h('pre', { class: 'pre' }, lista + '\n\nAjusta las cantidades o pide autorización a un administrador.') });
      const forzar = await confirmar('No hay suficiente disponible', lista + '\n\n¿Autorizar salida excepcional?', 'Autorizar con PIN', 'btn-peligro');
      if (!forzar) return;
      const a = await pedirAutorizacion({ titulo: 'Salida excepcional', mensaje: 'Quedará marcada como excepcional en la bitácora.' });
      if (!a) return;
      try {
        const res = await directo('registrar_salida', { evento_id: id, items, forzar: true, motivo: a.motivo, pin: a.pin });
        if (!res.ok) return toast(res.error, 'error');
      } catch (e) { return toast(e.message, 'error'); }
      toast('Salida excepcional registrada', 'aviso');
    } else if (!informar(op, 'Salida registrada')) return;
    await borrarBorrador(claveB);
    location.hash = `#/evento/${id}`;
  }

  p.append(
    bandaEvento(ev, 'salida'),
    desdeCache ? h('div', { class: 'aviso aviso-aviso' }, `Sin conexión (datos de ${hace(t)}). La salida se guardará en el celular y el servidor validará la disponibilidad al enviarse.`) : null,
    h('div', { class: 'fila acciones' },
      h('button', { class: 'btn btn-sec', onclick: () => { lineas.forEach(l => { cant[l.variante_id] = Math.max(0, (l.cantidad_planeada || 0) - (l.entregada || 0)); }); guardar(); pintar(); pintarResumen(); } }, 'Llenar con lo que falta'),
      h('button', { class: 'btn btn-sec', onclick: () => { Object.keys(cant).forEach(k => (cant[k] = 0)); guardar(); pintar(); pintarResumen(); } }, 'Poner todo en 0'),
      h('button', { class: 'btn btn-sec', onclick: agregarExtra }, icono('mas1', 18), 'Otro artículo')),
    Object.values(cant).some(v => v > 0) ? h('p', { class: 'tenue pequeno' }, 'Se recuperó la captura que no habías confirmado.') : null,
    lista, resumen);
  pintar(); pintarResumen();
  void recargar;
}
