import { leer } from '../api.js';
import { conCache, encolar, leerBorrador, guardarBorrador, borrarBorrador, estadoCola } from '../cola.js';
import { h, vacio, hace, icono, modal, toast, tituloVariante, contador, chipConciliacion, formatoNum } from '../ui.js';
import { puedeRecogidas, informar } from '../estado.js';
import { recargar } from '../app.js';
import { elegirArticulo, bandaEvento } from './componentes.js';

export async function render(p, id) {
  const [{ datos: [ev], desdeCache, t }, { datos: items }] = await Promise.all([
    conCache(`evento.${id}`, () => leer('v_eventos', { id: `eq.${id}` })),
    conCache(`evento.${id}.items`, () => leer('v_evento_items', { evento_id: `eq.${id}`, order: 'nombre.asc,color_nombre.asc,medida.asc' })),
  ]);
  if (!ev) { p.append(vacio('Evento no encontrado')); return; }
  p.append(h('a', { class: 'volver', href: `#/evento/${id}` }, icono('atras', 18), 'Volver al evento'));
  if (!puedeRecogidas()) { p.append(h('div', { class: 'aviso aviso-error' }, 'Tu usuario no tiene permiso para registrar recogidas.')); return; }
  if (!['activo', 'recogida'].includes(ev.estado)) { p.append(bandaEvento(ev, 'recogida'), h('div', { class: 'aviso aviso-error' }, 'Este evento no admite recogidas en su estado actual.')); return; }

  // Lo que ya está pendiente en la cola de este celular (aún no confirmado por el servidor)
  const cola = await estadoCola();
  const enCola = {};
  cola.ops.filter(o => o.fn === 'registrar_recogida' && o.estado === 'pendiente' && o.args.evento_id === id)
    .forEach(o => o.args.items.forEach(i => { enCola[i.variante_id] = (enCola[i.variante_id] || 0) + i.cantidad; }));

  const claveB = `recogida.${id}`;
  const b = (await leerBorrador(claveB)) || { buena: {}, danada: {}, extras: [] };
  const extras = b.extras || [];
  const lineas = [...items, ...extras.filter(x => !items.some(i => i.variante_id === x.variante_id))];
  const guardar = () => guardarBorrador(claveB, { buena: b.buena, danada: b.danada, extras });

  let filtro = 'todos';
  const lista = h('div', { class: 'captura' });
  const resumen = h('div', { class: 'resumen-flotante' });

  const pintarResumen = () => {
    const tb = Object.values(b.buena).reduce((a, x) => a + (x || 0), 0);
    const td = Object.values(b.danada).reduce((a, x) => a + (x || 0), 0);
    resumen.replaceChildren(
      h('div', null, h('strong', null, `${tb + td} por guardar`), td ? h('span', { class: 'texto-rojo' }, ` · ${td} dañada(s)`) : null),
      h('button', { class: 'btn btn-pri', disabled: tb + td === 0, onclick: guardarConteo }, 'Guardar conteo'));
  };

  const pintar = () => {
    const vis = lineas.filter(it => {
      if (filtro === 'todos') return true;
      if (filtro === 'pendientes') return (it.por_recoger || 0) > 0;
      if (filtro === 'revisar') return it.por_revisar;
      return it.estado_conciliacion === filtro;
    });
    lista.replaceChildren(...(vis.length ? vis.map(it => {
      const vid = it.variante_id;
      const entregada = it.entregada || 0;
      const yaContado = (it.regresada || 0) + (enCola[vid] || 0);
      const dif = h('div', { class: 'captura-dif' });
      const pintarDif = () => {
        const total = yaContado + (b.buena[vid] || 0) + (b.danada[vid] || 0);
        const d = total - entregada;
        dif.className = `captura-dif ${d < 0 ? 'texto-rojo' : d > 0 ? 'texto-morado' : 'texto-verde'}`;
        dif.textContent = d === 0 ? `✓ Completo (${total} de ${entregada})` : d < 0 ? `Faltan ${-d} (${total} de ${entregada})` : `Sobran ${d} (${total} de ${entregada})`;
      };
      pintarDif();
      const zonaDanada = h('div', { class: 'captura-danada', hidden: !(b.danada[vid] > 0) },
        h('span', { class: 'etq texto-rojo' }, 'Dañadas'),
        contador({ valor: b.danada[vid] || 0, etiqueta: `Dañadas de ${it.nombre}`, alCambiar: v => { b.danada[vid] = v; guardar(); pintarDif(); pintarResumen(); } }));
      return h('div', { class: 'captura-fila' },
        h('div', { class: 'fila-entre' }, tituloVariante(it), it.estado_conciliacion ? chipConciliacion(it.estado_conciliacion) : null),
        h('div', { class: 'captura-info' },
          h('span', null, 'Entregado ', h('strong', null, entregada)),
          h('span', null, 'Ya contado ', h('strong', null, it.regresada || 0)),
          enCola[vid] ? h('span', { class: 'texto-ambar' }, `+${enCola[vid]} sin enviar`) : null),
        h('span', { class: 'etq' }, 'Contado ahora (buen estado)'),
        contador({ valor: b.buena[vid] || 0, etiqueta: `Contado ahora de ${it.nombre}`, alCambiar: v => { b.buena[vid] = v; guardar(); pintarDif(); pintarResumen(); } }),
        zonaDanada.hidden ? h('button', { type: 'button', class: 'btn-link pequeno', onclick: e => { zonaDanada.hidden = false; e.currentTarget.remove(); } }, '+ Registrar piezas dañadas') : null,
        zonaDanada, dif);
    }) : [vacio(lineas.length ? 'Nada con este filtro.' : 'No hay materiales registrados para este evento.')]));
  };

  const filtros = h('div', { class: 'chips-filtro' }, [['todos', 'Todos'], ['pendientes', 'Pendientes'], ['completo', 'Completos'], ['faltante', 'Faltantes'],
    ['sobrante', 'Sobrantes'], ['danado', 'Dañados'], ['revisar', 'Por revisar']].map(([k, txt]) =>
    h('button', { type: 'button', class: `chip-btn ${k === filtro ? 'activo' : ''}`, 'aria-pressed': String(k === filtro), onclick: e => {
      filtro = k; filtros.querySelectorAll('.chip-btn').forEach(x => { x.classList.toggle('activo', x === e.currentTarget); x.setAttribute('aria-pressed', String(x === e.currentTarget)); }); pintar(); } }, txt)));

  async function agregarExtra() {
    const r = await elegirArticulo({ titulo: 'Material que no estaba en la lista', excluir: lineas.map(l => l.variante_id), etiquetaCantidad: 'Cantidad contada' });
    if (!r) return;
    const v = r.variante;
    const linea = { variante_id: v.id, nombre: v.nombre, color_nombre: v.color_nombre, color_hex: v.color_hex, medida: v.medida,
      unidad_medida: v.unidad_medida, sku: v.sku, entregada: 0, regresada: 0 };
    extras.push(linea); lineas.push(linea);
    b.buena[v.id] = r.cantidad;
    guardar(); pintar(); pintarResumen();
    toast('Se registrará como sobrante de este evento', 'info');
  }

  async function guardarConteo() {
    const itemsEnvio = [];
    for (const l of lineas) {
      if (b.buena[l.variante_id] > 0) itemsEnvio.push({ variante_id: l.variante_id, cantidad: b.buena[l.variante_id], condicion: 'buena' });
      if (b.danada[l.variante_id] > 0) itemsEnvio.push({ variante_id: l.variante_id, cantidad: b.danada[l.variante_id], condicion: 'danada' });
    }
    const si = await modal({
      titulo: 'Guardar conteo',
      contenido: h('div', { class: 'pila' }, h('p', null, 'Evento: ', h('strong', null, ev.nombre)),
        h('ul', { class: 'lista-simple' }, itemsEnvio.map(i => {
          const l = lineas.find(x => x.variante_id === i.variante_id);
          return h('li', null, h('strong', null, i.cantidad), ` × ${l.nombre}`, l.color_nombre ? ` · ${l.color_nombre}` : '',
            l.medida ? ` · ${formatoNum(l.medida)} ${l.unidad_medida || ''}` : '', i.condicion === 'danada' ? h('span', { class: 'texto-rojo' }, ' (dañadas)') : '');
        })),
        h('p', { class: 'tenue' }, 'Se suma a lo ya contado. Se registra exactamente lo que contaste, aunque sea más de lo que salió.')),
      acciones: [{ texto: 'Revisar', valor: false }, { texto: 'Guardar', clase: 'btn-pri', valor: true }],
    });
    if (!si) return;
    const op = await encolar('registrar_recogida', { evento_id: id, items: itemsEnvio }, `Recogida de ${ev.nombre}`);
    if (!informar(op, 'Conteo guardado')) return;
    await borrarBorrador(claveB);
    recargar();
  }

  p.append(
    bandaEvento(ev, 'recogida'),
    desdeCache ? h('div', { class: 'aviso aviso-aviso' }, `Sin conexión (datos de ${hace(t)}). Lo que guardes se enviará al recuperar señal.`) : null,
    h('p', { class: 'tenue pequeno' }, 'Puedes contar en varias tandas y desde varios celulares; cada "Guardar conteo" se suma a lo anterior. Si te equivocas, corrige desde Movimientos.'),
    h('div', { class: 'fila acciones' },
      h('button', { class: 'btn btn-sec', onclick: agregarExtra }, icono('mas1', 18), 'Material no listado'),
      h('a', { class: 'btn btn-ter', href: `#/evento/${id}/movimientos` }, icono('deshacer', 18), 'Corregir registros')),
    filtros, lista, resumen);
  pintar(); pintarResumen();
}
