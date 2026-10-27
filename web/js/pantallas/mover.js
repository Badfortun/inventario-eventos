// Mover material de un lugar a otro (salida, regreso, entre eventos, reparación, baja)
import { leer } from '../api.js';
import { h, icono, vacio, modal, toast, tituloArticulo, contador, descripcionVariante, formatoNum, textoNormal, campo, TIPO_LUGAR } from '../ui.js';
import { estado, esAdmin, permisoRuta, ejecutar, informar, uuid } from '../estado.js';
import { selectorEscaneo, elegirArticulo } from './componentes.js';

const REALES = ['almacen', 'evento', 'reparacion'];

export async function render(p, qs) {
  qs = qs instanceof URLSearchParams ? qs : new URLSearchParams();
  const todos = await leer('lugares', { estado: 'eq.abierto', order: 'tipo.asc,fecha.asc.nullsfirst', select: 'id,tipo,nombre,fecha' });
  const resolver = v => (!v ? null : todos.find(l => l.id === v) || todos.find(l => l.tipo === v && l.tipo !== 'evento') || null);
  const entre = qs.get('entre') === '1';
  let origen = resolver(qs.get('o'));
  let destino = resolver(qs.get('d'));

  const lugaresOrigen = todos.filter(o => todos.some(d => d.id !== o.id && permisoRuta(o.tipo, d.tipo) !== 'no') && (!entre || o.tipo === 'evento'));
  if (origen && !lugaresOrigen.some(l => l.id === origen.id)) origen = null;
  if (!origen && lugaresOrigen.length === 1) origen = lugaresOrigen[0];

  const etiqueta = l => l.tipo === 'evento' ? `${l.nombre}${l.fecha ? ' · ' + l.fecha.slice(5).split('-').reverse().join('/') : ''}` : l.nombre;
  const selO = h('select', { class: 'input input-grande', 'aria-label': 'Desde' }, h('option', { value: '' }, 'Elige de dónde sale…'),
    lugaresOrigen.map(l => h('option', { value: l.id, selected: l.id === origen?.id }, etiqueta(l))));
  const selD = h('select', { class: 'input input-grande', 'aria-label': 'Hacia' });
  const avisoRuta = h('div');
  const zonaItems = h('div', { class: 'pila' });
  const zonaEscaneo = h('div', { class: 'pila' });
  const notas = h('textarea', { class: 'input', rows: 2, placeholder: 'Opcional: quién lo lleva, vehículo, observaciones…' });
  const resumen = h('div', { class: 'resumen-flotante' });

  let existencias = [];
  let extras = [];       // artículos agregados que no estaban registrados en el origen
  let cant = {}, dan = {};
  let escSalida = null, escEntrada = null;
  const claveBorrador = () => `inv2.mover.${origen?.id}.${destino?.id}`;
  const guardarBorrador = () => { try { localStorage.setItem(claveBorrador(), JSON.stringify({ cant, dan, extras })); } catch {} };

  function pintarDestinos() {
    const opciones = origen ? todos.filter(d => d.id !== origen.id && permisoRuta(origen.tipo, d.tipo) !== 'no' && (!entre || d.tipo === 'evento')) : [];
    if (destino && !opciones.some(d => d.id === destino.id)) destino = null;
    if (!destino && opciones.length === 1) destino = opciones[0];
    selD.replaceChildren(h('option', { value: '' }, origen ? 'Elige a dónde va…' : 'Primero elige de dónde sale'),
      ...opciones.map(l => h('option', { value: l.id, selected: l.id === destino?.id }, etiqueta(l) + (permisoRuta(origen.tipo, l.tipo) === 'autorizar' ? ' (requiere autorización)' : ''))));
    selD.disabled = !origen;
  }

  async function cargarOrigen() {
    existencias = origen ? await leer('v_existencias', { lugar_id: `eq.${origen.id}`, order: 'nombre.asc,color_nombre.asc,medida.asc' }) : [];
    try { const b = JSON.parse(localStorage.getItem(claveBorrador()) || 'null'); if (b) { cant = b.cant || {}; dan = b.dan || {}; extras = b.extras || []; } else { cant = {}; dan = {}; extras = []; } }
    catch { cant = {}; dan = {}; extras = []; }
  }

  const permiteSobrante = () => origen?.tipo === 'evento' && ['almacen', 'reparacion'].includes(destino?.tipo);
  const permiteDanadas = () => destino?.tipo === 'almacen';

  let filtro = '';
  function pintarItems() {
    if (!origen || !destino) { zonaItems.replaceChildren(); return; }
    const lineas = [...existencias, ...extras.filter(x => !existencias.some(e => e.articulo_id === x.articulo_id))];
    const buscar = h('input', { class: 'input', type: 'search', value: filtro, placeholder: 'Buscar por código o nombre…', 'aria-label': 'Buscar artículo' });
    const lista = h('div', { class: 'captura' });
    const pintarLista = () => {
      const w = textoNormal(filtro).split(/\s+/).filter(Boolean);
      const vis = lineas.filter(l => w.every(x => textoNormal([l.codigo, l.nombre, l.color_nombre, l.medida, l.tamano].join(' ')).includes(x)));
      lista.replaceChildren(...(vis.length ? vis.map(l => {
        const hay = l.cantidad || 0;
        const aviso = h('div', { class: 'captura-aviso' });
        const revisar = () => {
          const v = cant[l.articulo_id] || 0;
          aviso.className = 'captura-aviso';
          aviso.textContent = '';
          if (v > hay && permiteSobrante()) { aviso.textContent = `${v - hay} de más: se registrarán como sobrante`; aviso.classList.add('texto-morado'); }
        };
        const zonaDan = h('div', { class: 'captura-danada', hidden: !(dan[l.articulo_id] > 0) }, h('span', { class: 'etq texto-rojo' }, 'De esas, dañadas (van a Reparación)'),
          contador({ valor: dan[l.articulo_id] || 0, etiqueta: `Dañadas de ${l.nombre}`, alCambiar: v => { dan[l.articulo_id] = Math.min(v, cant[l.articulo_id] || 0); guardarBorrador(); pintarResumen(); } }));
        const fila = h('div', { class: `captura-fila ${cant[l.articulo_id] > 0 ? 'con-cantidad' : ''}` },
          h('div', { class: 'fila-entre' }, tituloArticulo(l), h('div', { class: 'hay' }, h('strong', null, formatoNum(hay)), h('small', null, `en ${origen.nombre}`))),
          contador({ valor: cant[l.articulo_id] || 0, max: permiteSobrante() ? null : hay, etiqueta: `Cantidad de ${l.nombre}`,
            alCambiar: v => { cant[l.articulo_id] = v; if ((dan[l.articulo_id] || 0) > v) dan[l.articulo_id] = v; fila.classList.toggle('con-cantidad', v > 0); revisar(); guardarBorrador(); pintarResumen(); } }),
          h('div', { class: 'fila' },
            hay > 0 ? h('button', { type: 'button', class: 'btn-link pequeno', onclick: () => { cant[l.articulo_id] = hay; guardarBorrador(); pintarLista(); pintarResumen(); } }, `Todas (${hay})`) : null,
            permiteDanadas() && zonaDan.hidden ? h('button', { type: 'button', class: 'btn-link pequeno', onclick: e => { zonaDan.hidden = false; e.currentTarget.remove(); } }, '+ Hay dañadas') : null),
          permiteDanadas() ? zonaDan : null, aviso);
        revisar();
        return fila;
      }) : [vacio(lineas.length ? 'Ningún artículo coincide.' : `No hay material registrado en ${origen.nombre}.`)]));
    };
    buscar.oninput = () => { filtro = buscar.value; pintarLista(); };
    zonaItems.replaceChildren(
      h('h2', { class: 'seccion' }, '¿Qué se mueve?'),
      lineas.length > 6 ? buscar : null,
      h('div', { class: 'fila' },
        h('button', { type: 'button', class: 'btn btn-sec btn-chico', onclick: () => { existencias.forEach(e => (cant[e.articulo_id] = e.cantidad)); guardarBorrador(); pintarLista(); pintarResumen(); } }, 'Todo lo que hay'),
        h('button', { type: 'button', class: 'btn btn-sec btn-chico', onclick: () => { cant = {}; dan = {}; guardarBorrador(); pintarLista(); pintarResumen(); } }, 'Poner todo en 0'),
        permiteSobrante() ? h('button', { type: 'button', class: 'btn btn-sec btn-chico', onclick: agregarExtra }, icono('mas1', 16), 'Artículo no registrado aquí') : null),
      lista);
    pintarLista();
  }

  async function agregarExtra() {
    const a = await elegirArticulo({ titulo: 'Material que llegó y no estaba registrado aquí', excluir: [...existencias, ...extras].map(x => x.articulo_id) });
    if (!a) return;
    extras.push({ articulo_id: a.id, codigo: a.codigo, nombre: a.nombre, color_nombre: a.color_nombre, color_hex: a.color_hex, medida: a.medida, unidad_medida: a.unidad_medida, tamano: a.tamano, cantidad: 0 });
    cant[a.id] = 1;
    guardarBorrador(); pintarItems(); pintarResumen();
    toast('Se registrará como sobrante de este evento', 'info');
  }

  async function pintarEscaneo() {
    if (!origen || !destino) { zonaEscaneo.replaceChildren(); escSalida = escEntrada = null; return; }
    escSalida = REALES.includes(origen.tipo) ? await selectorEscaneo(`Salida de ${origen.nombre}`, '¿Se escaneó el material al salir?') : null;
    escEntrada = REALES.includes(destino.tipo) ? await selectorEscaneo(`Entrada a ${destino.nombre}`, '¿Se escaneó al llegar? Si aún no llega, márcalo después.') : null;
    zonaEscaneo.replaceChildren(h('h2', { class: 'seccion' }, 'Escaneo'), escSalida?.el, escEntrada?.el, campo('Notas', notas));
  }

  function pintarAviso() {
    const perm = origen && destino ? permisoRuta(origen.tipo, destino.tipo) : null;
    avisoRuta.replaceChildren(
      perm === 'autorizar' ? h('div', { class: 'aviso aviso-aviso' }, 'Este traslado entre eventos quedará POR AUTORIZAR. Las cantidades cambian cuando el administrador lo apruebe.') : null,
      destino?.tipo === 'baja' ? h('div', { class: 'aviso aviso-error' }, 'Dar de baja: el material deja de contar en el inventario (no sirve).') : null);
  }

  function pintarResumen() {
    const piezas = Object.values(cant).reduce((a, b) => a + (b || 0), 0);
    const arts = Object.values(cant).filter(v => v > 0).length;
    resumen.hidden = !origen || !destino;
    resumen.replaceChildren(h('div', null, h('strong', null, `${piezas} pieza(s)`), h('span', { class: 'tenue' }, ` · ${arts} artículo(s)`)),
      h('button', { class: 'btn btn-pri', disabled: piezas === 0, onclick: confirmar }, 'Registrar'));
  }

  async function confirmar() {
    if (escSalida && !escSalida.valor()) return toast('Indica si la salida se escaneó o no', 'error');
    if (escEntrada && !escEntrada.valor()) return toast('Indica si la entrada se escaneó o no', 'error');
    const lineas = [...existencias, ...extras];
    const items = Object.entries(cant).filter(([, v]) => v > 0).map(([id, v]) => ({ articulo_id: id, cantidad: v, danadas: Math.min(dan[id] || 0, v) }));
    const perm = permisoRuta(origen.tipo, destino.tipo);
    const ok = await modal({ titulo: perm === 'autorizar' ? 'Solicitar traslado' : 'Confirmar movimiento',
      contenido: h('div', { class: 'pila' },
        h('div', { class: 'ruta-grande' }, h('span', null, origen.nombre), icono('mover', 20), h('span', null, destino.nombre)),
        h('ul', { class: 'lista-simple' }, items.map(i => { const l = lineas.find(x => x.articulo_id === i.articulo_id);
          return h('li', null, h('strong', null, i.cantidad), ` × ${l.nombre}`, descripcionVariante(l) ? ` · ${descripcionVariante(l)}` : '',
            i.danadas ? h('span', { class: 'texto-rojo' }, ` (${i.danadas} dañadas → Reparación)`) : '',
            i.cantidad > (l.cantidad || 0) && permiteSobrante() ? h('span', { class: 'texto-morado' }, ` (${i.cantidad - (l.cantidad || 0)} sobrante)`) : ''); })),
        h('p', { class: 'pequeno' }, escSalida ? `Salida: ${escSalida.valor() === 'escaneado' ? 'escaneada' : 'sin escaneo'}. ` : '', escEntrada ? `Entrada: ${escEntrada.valor() === 'escaneado' ? 'escaneada' : 'sin escaneo'}.` : ''),
        h('p', { class: 'tenue pequeno' }, `Se registrará a nombre de ${estado.perfil.nombre}.`)),
      acciones: [{ texto: 'Revisar', valor: false }, { texto: perm === 'autorizar' ? 'Enviar a autorizar' : 'Registrar', clase: 'btn-pri', valor: true }] });
    if (!ok) return;
    const r = await ejecutar('registrar_movimiento', {
      origen_id: origen.id, destino_id: destino.id, items, notas: notas.value,
      escaneo_salida: escSalida?.valor(), escaneo_salida_por: escSalida?.quien(),
      escaneo_entrada: escEntrada?.valor(), escaneo_entrada_por: escEntrada?.quien(),
    }, idemActual);
    if (!r.ok) {
      if (r.articulos) return modal({ titulo: r.error, contenido: h('ul', { class: 'lista-simple' }, r.articulos.map(a => h('li', null, `${a.nombre}: pides ${a.solicitado}, hay ${a.disponible}`))) });
      return informar(r);
    }
    idemActual = uuid();
    try { localStorage.removeItem(claveBorrador()); } catch {}
    if (r.estado === 'por_autorizar') toast('Enviado. Queda por autorizar por el administrador.', 'aviso', 5000);
    else informar(r, 'Movimiento registrado');
    if (r.sobrantes?.length) await modal({ titulo: 'Sobrantes registrados', contenido: h('div', { class: 'pila' }, h('p', null, 'Llegaron más piezas de las que estaban registradas en el evento:'),
      h('ul', { class: 'lista-simple' }, r.sobrantes.map(s => h('li', null, `${s.nombre}: registradas ${s.registradas}, contadas ${s.contadas} → ${s.sobrante} sobrante(s)`)))) });
    location.hash = `#/lugar/${destino.tipo === 'baja' ? origen.id : (origen.tipo === 'evento' ? origen.id : destino.id)}`;
  }
  let idemActual = uuid(); // la misma clave mientras no se registre con éxito (evita duplicados por doble toque)

  async function cambio() {
    pintarDestinos(); pintarAviso();
    await cargarOrigen();
    pintarItems(); await pintarEscaneo(); pintarResumen();
  }
  selO.onchange = async () => { origen = todos.find(l => l.id === selO.value) || null; destino = null; filtro = ''; await cambio(); };
  selD.onchange = async () => { destino = todos.find(l => l.id === selD.value) || null; await cambio(); };

  p.append(
    h('h1', null, entre ? 'Traslado entre eventos' : 'Mover material'),
    entre && !esAdmin() ? h('p', { class: 'tenue' }, 'Los traslados entre eventos los autoriza el administrador.') : null,
    h('div', { class: 'ruta' }, campo('Desde', selO), h('div', { class: 'ruta-flecha', 'aria-hidden': 'true' }, icono('mover', 22)), campo('Hacia', selD)),
    avisoRuta, zonaItems, zonaEscaneo, resumen);
  void TIPO_LUGAR;
  await cambio();
}
