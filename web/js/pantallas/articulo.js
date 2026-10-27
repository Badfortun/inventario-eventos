import { leer } from '../api.js';
import { h, icono, vacio, campo, modal, toast, muestraColor, descripcionVariante, formatoNum, fechaHora, chipEscaneo, TIPO_LUGAR } from '../ui.js';
import { esAdmin, ejecutar, informar, estado } from '../estado.js';
import { recargar } from '../app.js';
import { editarArticulo } from './articulos.js';
import { metrica } from './componentes.js';

export async function render(p, id) {
  const [[a], dondeEsta, hist] = await Promise.all([
    leer('v_articulos', { id: `eq.${id}` }),
    leer('v_existencias', { articulo_id: `eq.${id}`, order: 'lugar_tipo.asc,lugar_fecha.asc' }),
    leer('v_movimiento_items', { articulo_id: `eq.${id}`, order: 'created_at.desc', limit: 100 }),
  ]);
  if (!a) return p.append(vacio('Artículo no encontrado'));
  const orden = { almacen: 0, reparacion: 1, evento: 2, perdida: 3, baja: 4 };
  dondeEsta.sort((x, y) => orden[x.lugar_tipo] - orden[y.lugar_tipo]);

  p.append(
    h('a', { class: 'volver', href: '#/articulos' }, icono('atras', 18), 'Artículos'),
    h('div', { class: 'fila-entre' }, h('div', null, h('h1', null, a.nombre), h('p', { class: 'subtitulo' }, h('span', { class: 'sku' }, a.codigo), ' ', descripcionVariante(a))),
      a.activo ? null : h('span', { class: 'chip chip-gris' }, 'Desactivado')),
    a.color_hex || a.color_nombre ? h('div', { class: 'color-grande' }, muestraColor(a.color_hex, a.color_nombre)) : null,
    h('div', { class: 'total-grande' }, h('strong', null, formatoNum(a.total)), h('span', null, `${a.unidad}(s) en total`),
      h('small', { class: 'tenue' }, 'Almacén + Reparación + eventos. Las pérdidas y bajas no cuentan.')),
    h('div', { class: 'metricas' }, metrica('Almacén', a.en_almacen), metrica('Eventos', a.en_eventos), metrica('Reparación', a.en_reparacion, a.en_reparacion ? 'ambar' : null),
      metrica('Sin escanear', a.sin_escanear, a.sin_escanear ? 'ambar' : null)),
    h('h2', { class: 'seccion' }, '¿Dónde está?'),
    dondeEsta.length ? h('ul', { class: 'lista' }, dondeEsta.map(e => h('li', null, h('a', { class: 'lista-item', href: `#/lugar/${e.lugar_id}` },
      h('div', null, h('strong', null, e.lugar_nombre), h('div', { class: 'tenue pequeno' }, TIPO_LUGAR[e.lugar_tipo],
        e.lugar_tipo === 'evento' && e.lugar_estado === 'cerrado' ? ' · cerrado' : '', e.sin_escanear ? ` · ${e.sin_escanear} sin escanear` : '')),
      h('strong', { class: `cant-grande ${e.lugar_tipo === 'perdida' ? 'texto-rojo' : ''}` }, formatoNum(e.cantidad)))))) : h('p', { class: 'tenue' }, 'Sin existencias registradas.'),
    esAdmin() ? h('div', { class: 'fila acciones' },
      h('button', { class: 'btn btn-sec', onclick: () => editarArticulo(a) }, icono('editar', 18), 'Editar'),
      h('button', { class: 'btn btn-sec', onclick: () => alta(a) }, icono('mas1', 18), 'Entrada de material nuevo'),
      h('button', { class: 'btn btn-sec', onclick: () => ajuste(a, dondeEsta) }, 'Ajuste de existencia')) : null,
    a.notas || a.marca_modelo || a.categoria ? h('dl', { class: 'datos' },
      a.categoria ? h('div', { class: 'dato' }, h('dt', null, 'Categoría'), h('dd', null, a.categoria)) : null,
      a.marca_modelo ? h('div', { class: 'dato' }, h('dt', null, 'Marca / modelo'), h('dd', null, a.marca_modelo)) : null,
      a.notas ? h('div', { class: 'dato' }, h('dt', null, 'Notas'), h('dd', null, a.notas)) : null) : null,
    h('h2', { class: 'seccion' }, 'Historial'),
    hist.length ? h('ul', { class: 'lista lista-movs' }, hist.map(m => h('li', { class: `mov ${['revertido', 'rechazado'].includes(m.estado) ? 'mov-revertido' : ''}` },
      h('div', { class: 'mov-cab' }, h('strong', { class: 'mov-ruta' }, m.tipo === 'escaneo' ? 'Escaneo en almacén' : `${m.origen_nombre || 'Alta/ajuste'} → ${m.destino_nombre || 'Ajuste'}`),
        m.estado !== 'aplicado' ? h('span', { class: 'chip chip-gris' }, { por_autorizar: 'Por autorizar', rechazado: 'Rechazado', revertido: 'Corregido' }[m.estado]) : null,
        m.tipo === 'correccion' ? h('span', { class: 'chip chip-gris' }, 'Corrección') : null,
        h('strong', { class: 'mov-cant' }, m.cantidad)),
      h('div', { class: 'fila chips' }, chipEscaneo(m.escaneo_salida, m.escaneo_salida_nombre, 'Salida'), chipEscaneo(m.escaneo_entrada, m.escaneo_entrada_nombre, 'Entrada'),
        m.danadas ? h('span', { class: 'chip chip-rojo' }, `${m.danadas} dañada(s)`) : null, m.sobrante ? h('span', { class: 'chip chip-morado' }, `${m.sobrante} sobrante(s)`) : null),
      h('div', { class: 'tenue pequeno' }, `${m.registrado_nombre} · ${fechaHora(m.created_at)}`)))) : h('p', { class: 'tenue' }, 'Sin movimientos.'));
}

async function alta(a) {
  const cant = h('input', { class: 'input', type: 'number', min: 1, inputmode: 'numeric' });
  const motivo = h('input', { class: 'input', placeholder: 'Ej. Compra factura 1234' });
  const esc = h('select', { class: 'input' }, h('option', { value: 'escaneado' }, 'Sí, ya se escanearon'), h('option', { value: 'sin_escaneo' }, 'No, quedan pendientes'));
  await modal({ titulo: `Entrada de ${a.nombre}`, contenido: h('div', { class: 'pila' }, campo('Cantidad que entra al almacén', cant), campo('Motivo', motivo), campo('¿Se escanearon?', esc)),
    acciones: [{ texto: 'Cancelar' }, { texto: 'Registrar', clase: 'btn-pri', alHacer: async () => {
      const n = parseInt(cant.value, 10);
      if (!(n > 0) || !motivo.value.trim()) { toast('Cantidad y motivo son obligatorios', 'error'); return false; }
      if (!informar(await ejecutar('ajustar_existencia', { articulo_id: a.id, cantidad: n, tipo: 'alta', motivo: motivo.value.trim(), escaneo: esc.value }), 'Entrada registrada')) return false;
      recargar();
    } }] });
}

async function ajuste(a, dondeEsta) {
  const lugares = await leer('lugares', { estado: 'eq.abierto', tipo: 'in.(almacen,reparacion,evento)', order: 'tipo.asc,fecha.asc', select: 'id,nombre,tipo' });
  const lugar = h('select', { class: 'input' }, lugares.map(l => h('option', { value: l.id }, `${l.nombre} (hay ${dondeEsta.find(e => e.lugar_id === l.id)?.cantidad || 0})`)));
  const cant = h('input', { class: 'input', type: 'number', inputmode: 'numeric', placeholder: '-2 o 3' });
  const motivo = h('textarea', { class: 'input', rows: 2 });
  await modal({ titulo: 'Ajuste de existencia', contenido: h('div', { class: 'pila' },
      h('p', { class: 'tenue' }, 'Úsalo solo para corregir conteos. Para material que se perdió en un evento, cierra el evento.'),
      campo('Lugar', lugar), campo('Cantidad a sumar (+) o restar (−)', cant), campo('Motivo *', motivo)),
    acciones: [{ texto: 'Cancelar' }, { texto: 'Ajustar', clase: 'btn-pri', alHacer: async () => {
      const n = parseInt(cant.value, 10);
      if (!n || !motivo.value.trim()) { toast('Cantidad y motivo son obligatorios', 'error'); return false; }
      if (!informar(await ejecutar('ajustar_existencia', { articulo_id: a.id, lugar_id: lugar.value, cantidad: n, tipo: 'ajuste', motivo: motivo.value.trim() }), 'Ajuste registrado')) return false;
      recargar();
    } }] });
  void estado;
}
