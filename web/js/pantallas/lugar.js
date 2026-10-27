// Detalle de un lugar: Almacén, Reparación, Pérdidas o un evento
import { leer } from '../api.js';
import { h, icono, vacio, modal, campo, toast, fecha, fechaHora, descripcionVariante, tituloArticulo, formatoNum, chipEstadoEvento, pedirMotivo, TIPO_LUGAR } from '../ui.js';
import { estado, esAdmin, puedeSalidas, puedeRecogidas, puedeMover, ejecutar, informar } from '../estado.js';
import { recargar } from '../app.js';
import { metrica, tarjetaMovimiento } from './componentes.js';
import { editarEvento } from './eventos.js';

export async function render(p, id, qs) {
  const [[l], aqui, movs] = await Promise.all([
    leer('v_lugares', { id: `eq.${id}` }),
    leer('v_existencias', { lugar_id: `eq.${id}`, order: 'nombre.asc,color_nombre.asc' }),
    leer('v_movimientos', { or: `(origen_id.eq.${id},destino_id.eq.${id})`, order: 'created_at.desc', limit: 200 }),
  ]);
  if (!l) return p.append(vacio('Lugar no encontrado'));
  const esEvento = l.tipo === 'evento';
  const resumen = esEvento ? await leer('v_evento_resumen', { evento_id: `eq.${id}`, order: 'nombre.asc' }) : [];
  const alm = estado.lugaresFijos.almacen?.id, rep = estado.lugaresFijos.reparacion?.id;
  const abierto = l.estado === 'abierto';

  const btn = (txt, href, clase = 'btn-sec', ic) => h('a', { class: `btn ${clase}`, href }, ic ? icono(ic, 18) : null, txt);
  const acciones = [];
  if (esEvento && abierto) {
    if (puedeSalidas()) acciones.push(btn('Enviar material aquí', `#/mover?o=almacen&d=${id}`, 'btn-pri', 'salida'));
    if (puedeRecogidas()) acciones.push(btn('Regresar al almacén', `#/mover?o=${id}&d=almacen`, puedeSalidas() ? 'btn-sec' : 'btn-pri', 'recogida'));
    if (puedeMover()) acciones.push(btn('Mover a otro evento', `#/mover?o=${id}&entre=1`, 'btn-sec', 'mover'));
    if (puedeRecogidas()) acciones.push(btn('Enviar a reparación', `#/mover?o=${id}&d=reparacion`, 'btn-sec', 'herramienta'));
    if (esAdmin()) acciones.push(h('button', { class: 'btn btn-sec', onclick: () => cerrar(l, aqui) }, icono('check', 18), 'Cerrar evento'));
  }
  if (esEvento && !abierto && esAdmin()) acciones.push(h('button', { class: 'btn btn-sec', onclick: () => reabrir(l) }, 'Reabrir evento'));
  if (l.tipo === 'almacen') {
    if (puedeSalidas()) acciones.push(btn('Salida a evento', '#/mover?o=almacen', 'btn-pri', 'salida'));
    if (puedeRecogidas()) acciones.push(btn(`Pendiente de escanear (${l.sin_escanear})`, '#/escaneo', l.sin_escanear ? 'btn-pri' : 'btn-sec', 'codigo'));
    if (puedeRecogidas()) acciones.push(btn('Enviar a reparación', '#/mover?o=almacen&d=reparacion', 'btn-sec', 'herramienta'));
  }
  if (l.tipo === 'reparacion') {
    if (puedeRecogidas()) acciones.push(btn('Regresar reparadas al almacén', '#/mover?o=reparacion&d=almacen', 'btn-pri', 'recogida'));
    if (esAdmin()) acciones.push(btn('Dar de baja (sin arreglo)', '#/mover?o=reparacion&d=baja', 'btn-sec'));
  }
  if (l.tipo === 'perdida' && esAdmin()) acciones.push(btn('Recuperar material (apareció)', '#/mover?o=perdida', 'btn-sec'));

  // Pestañas
  let tab = qs?.get('tab') || (esEvento && !abierto ? 'resumen' : 'aqui');
  const zona = h('div');
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const opciones = [['aqui', esEvento && !abierto ? 'Quedó aquí' : 'Ahora aquí'], ...(esEvento ? [['resumen', 'Resumen']] : []), ['movs', 'Movimientos']];
  function pintar() {
    tabs.replaceChildren(...opciones.map(([k, t]) => h('button', { role: 'tab', class: `tab ${k === tab ? 'activo' : ''}`, 'aria-selected': String(k === tab),
      onclick: () => { tab = k; pintar(); } }, t)));
    if (tab === 'aqui') {
      zona.replaceChildren(aqui.length ? h('ul', { class: 'lista' }, aqui.map(e => h('li', null, h('a', { class: 'lista-item', href: `#/articulo/${e.articulo_id}` },
        tituloArticulo(e), h('div', { class: 'existencias' }, h('div', { class: 'exist-num' }, formatoNum(e.cantidad)),
          e.sin_escanear ? h('div', { class: 'exist-sub texto-ambar' }, `${e.sin_escanear} sin escanear`) : h('div', { class: 'exist-etq' }, e.lugar_tipo === 'almacen' ? 'escaneadas' : 'piezas')))))) :
        vacio(esEvento ? 'No hay material registrado en este evento.' : 'Vacío.'));
    } else if (tab === 'resumen') {
      zona.replaceChildren(resumen.length ? h('div', { class: 'pila' }, resumen.map(r => h('article', { class: `item ${r.en_evento ? 'item-alerta' : ''}` },
        tituloArticulo(r),
        h('div', { class: 'item-nums' },
          num('Llegó', r.llego, r.llego_de_eventos ? `${r.llego_de_eventos} de otros eventos` : null),
          num('Al almacén', r.regreso_almacen, r.danadas ? `${r.danadas} dañadas` : null),
          num('A otros eventos', r.a_otros_eventos),
          num(abierto ? 'Siguen aquí' : 'Perdidas', abierto ? r.en_evento : r.perdidas, null, (abierto ? r.en_evento : r.perdidas) ? 'rojo' : 'verde')),
        r.a_reparacion || r.sobrante || r.dado_de_baja || r.ajustes ? h('div', { class: 'fila chips' },
          r.a_reparacion ? h('span', { class: 'chip chip-ambar' }, `${r.a_reparacion} a reparación`) : null,
          r.sobrante ? h('span', { class: 'chip chip-morado' }, `${r.sobrante} sobrante(s)`) : null,
          r.dado_de_baja ? h('span', { class: 'chip chip-gris' }, `${r.dado_de_baja} dadas de baja`) : null,
          r.ajustes ? h('span', { class: 'chip chip-gris' }, `Ajustes ${r.ajustes > 0 ? '+' : ''}${r.ajustes}`) : null) : null))) :
        vacio('Todavía no hay movimientos en este evento.'));
    } else {
      zona.replaceChildren(movs.length ? h('div', { class: 'pila' }, movs.map(m => tarjetaMovimiento(m, { alCambiar: recargar }))) : vacio('Sin movimientos.'));
    }
  }

  p.append(
    h('a', { class: 'volver', href: '#/eventos' }, icono('atras', 18), 'Lugares y eventos'),
    h('div', { class: 'fila-entre' }, h('h1', null, l.nombre), esEvento ? chipEstadoEvento(l.estado) : h('span', { class: 'chip chip-gris' }, TIPO_LUGAR[l.tipo])),
    esEvento ? h('p', { class: 'subtitulo' }, fecha(l.fecha), l.fecha_fin && l.fecha_fin !== l.fecha ? ` al ${fecha(l.fecha_fin)}` : '', l.ubicacion ? ` · ${l.ubicacion}` : '') : null,
    l.notas ? h('p', { class: 'notas' }, l.notas) : null,
    !abierto ? h('div', { class: 'aviso' }, `Cerrado por ${l.cerrado_por_nombre || '—'} el ${fechaHora(l.cerrado_at)}.`,
      l.perdidas ? h('strong', { class: 'texto-rojo' }, ` ${l.perdidas} pieza(s) quedaron como pérdida de este evento.`) : ' Todo el material regresó.') : null,
    l.por_autorizar ? h('a', { class: 'aviso aviso-aviso enlace-aviso', href: '#/autorizaciones' }, `${l.por_autorizar} traslado(s) por autorizar →`) : null,
    h('div', { class: 'metricas' }, metrica(esEvento ? 'Piezas aquí' : 'Piezas', l.piezas), metrica('Artículos', l.articulos),
      l.tipo === 'almacen' ? metrica('Sin escanear', l.sin_escanear, l.sin_escanear ? 'ambar' : null) : null,
      esEvento ? metrica('Perdidas', l.perdidas, l.perdidas ? 'rojo' : null) : null),
    acciones.length ? h('div', { class: 'acciones-principales' }, acciones) : null,
    h('div', { class: 'acciones-secundarias' },
      h('a', { class: 'btn btn-ter', href: '#/reportes', onclick: () => sessionStorage.setItem('inv2.reporteEvento', id) }, icono('descarga', 18), 'Exportar'),
      esEvento && abierto && esAdmin() ? h('button', { class: 'btn btn-ter', onclick: () => editarEvento(l) }, icono('editar', 18), 'Editar datos') : null),
    tabs, zona);
  pintar();
}

function num(etq, val, sub, clase) {
  return h('div', { class: `num ${clase ? 'texto-' + clase : ''}` }, h('span', { class: 'num-etq' }, etq), h('strong', null, val ?? 0), sub ? h('small', null, sub) : null);
}

async function cerrar(l, aqui) {
  const notas = h('textarea', { class: 'input', rows: 2, placeholder: 'Opcional' });
  const r = await modal({
    titulo: `Cerrar ${l.nombre}`,
    contenido: h('div', { class: 'pila' },
      aqui.length ? [h('div', { class: 'aviso aviso-error' }, h('strong', null, `Todavía hay ${aqui.reduce((s, e) => s + e.cantidad, 0)} pieza(s) registradas en este evento.`),
        ' Al cerrar se confirmarán como PÉRDIDA de este evento. Si aún van a regresar o están en otro evento, regístralo antes de cerrar.'),
        h('ul', { class: 'lista-compacta' }, aqui.map(e => h('li', null, h('span', null, e.nombre, h('span', { class: 'tenue' }, ` ${descripcionVariante(e)}`)), h('strong', { class: 'texto-rojo' }, e.cantidad))))]
        : h('div', { class: 'aviso' }, '✓ Todo el material salió de este evento. Se cerrará sin pérdidas.'),
      campo('Notas', notas)),
    acciones: [{ texto: 'Cancelar', valor: null }, { texto: aqui.length ? 'Cerrar y confirmar pérdidas' : 'Cerrar evento', clase: aqui.length ? 'btn-peligro' : 'btn-pri', valor: true }],
  });
  if (!r) return;
  if (informar(await ejecutar('cerrar_evento', { evento_id: l.id, notas: notas.value }), 'Evento cerrado')) recargar();
}

async function reabrir(l) {
  const motivo = await pedirMotivo({ titulo: `Reabrir ${l.nombre}`, mensaje: 'Las pérdidas confirmadas se quedan registradas. Si apareció material, recupéralo desde "Pérdidas".' });
  if (motivo && informar(await ejecutar('reabrir_evento', { evento_id: l.id, motivo }), 'Evento reabierto')) recargar();
  void toast;
}
