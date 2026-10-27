import { leer } from '../api.js';
import { conCache, encolar, directo } from '../cola.js';
import { h, muestraColor, descripcionVariante, formatoNum, fechaHora, modal, campo, toast, pedirAutorizacion, icono, chipEstado, vacio } from '../ui.js';
import { esAdmin, informar } from '../estado.js';
import { recargar } from '../app.js';
import { editarArticulo } from './inventario.js';
import { filaMovimiento } from './movimientos.js';

export async function render(p, id) {
  const [{ datos: [v] }, { datos: movs }, { datos: enEventos }] = await Promise.all([
    conCache(`articulo.${id}`, () => leer('v_inventario', { id: `eq.${id}` })),
    conCache(`articulo.${id}.movs`, () => leer('v_movimientos', { variante_id: `eq.${id}`, order: 'created_at.desc', limit: 100 })),
    conCache(`articulo.${id}.eventos`, () => leer('v_evento_items', { variante_id: `eq.${id}`, evento_estado: 'neq.cerrado', order: 'created_at.desc' })),
  ]);
  if (!v) { p.append(vacio('Artículo no encontrado')); return; }

  const datosFila = (k, val) => val ? h('div', { class: 'dato' }, h('dt', null, k), h('dd', null, val)) : null;

  p.append(
    h('a', { class: 'volver', href: '#/inventario' }, icono('atras', 18), 'Inventario'),
    h('div', { class: 'fila-entre' },
      h('div', null, h('h1', null, v.nombre), h('p', { class: 'subtitulo' }, descripcionVariante(v) || 'Sin color ni medida')),
      v.activo ? null : h('span', { class: 'chip chip-gris' }, 'Desactivado')),
    v.color_hex || v.color_nombre ? h('div', { class: 'color-grande' }, muestraColor(v.color_hex, v.color_nombre)) : null,
    h('div', { class: 'metricas metricas-grandes' },
      h('div', { class: 'metrica' }, h('strong', null, formatoNum(v.existencia)), h('span', null, 'En almacén')),
      h('div', { class: 'metrica' }, h('strong', null, formatoNum(v.reservado)), h('span', null, 'Reservado')),
      h('div', { class: `metrica ${v.disponible <= 0 ? 'metrica-rojo' : 'metrica-verde'}` }, h('strong', null, formatoNum(v.disponible)), h('span', null, 'Disponible')),
      h('div', { class: 'metrica' }, h('strong', null, formatoNum(v.en_eventos)), h('span', null, 'Fuera en eventos'))),
    h('p', { class: 'tenue pequeno' }, `Unidad: ${v.unidad_inventario}. Disponible = en almacén − reservado por eventos activos aún no entregado.`),
    esAdmin() ? h('div', { class: 'fila acciones' },
      h('button', { class: 'btn btn-sec', onclick: () => editarArticulo(v, () => recargar()) }, icono('editar', 18), 'Editar'),
      h('button', { class: 'btn btn-sec', onclick: () => entrada(v) }, icono('mas1', 18), 'Entrada (compra)'),
      h('button', { class: 'btn btn-sec', onclick: () => ajuste(v) }, 'Ajuste de existencia')) : null,
    h('dl', { class: 'datos' },
      datosFila('SKU', v.sku), datosFila('Categoría', v.categoria), datosFila('Marca / modelo', v.marca_modelo),
      datosFila('No. de serie', v.numero_serie), datosFila('Ubicación', v.ubicacion), datosFila('Descripción', v.descripcion),
      datosFila('Notas', v.notas), v.foto_url ? datosFila('Foto', h('a', { href: v.foto_url, target: '_blank', rel: 'noopener' }, 'Ver foto')) : null),
    h('h2', { class: 'seccion' }, 'En eventos abiertos'),
    enEventos.length ? h('ul', { class: 'lista' }, enEventos.map(it => h('li', null, h('a', { class: 'lista-item', href: `#/evento/${it.evento_id}` },
      h('div', null, h('strong', null, it.evento_nombre),
        h('div', { class: 'tenue pequeno' }, `Planeado ${it.cantidad_planeada} · Entregado ${it.entregada} · Contado ${it.regresada}`)),
      chipEstado(it.evento_estado))))) : h('p', { class: 'tenue' }, 'No está en eventos abiertos.'),
    h('h2', { class: 'seccion' }, 'Historial de movimientos'),
    movs.length ? h('ul', { class: 'lista lista-movs' }, movs.map(m => filaMovimiento(m, { mostrarEvento: true }))) : h('p', { class: 'tenue' }, 'Sin movimientos.'),
  );
}

async function entrada(v) {
  const cant = h('input', { class: 'input', type: 'number', min: 1, inputmode: 'numeric' });
  const motivo = h('input', { class: 'input', placeholder: 'Ej. Compra factura 1234' });
  await modal({
    titulo: `Entrada de ${v.nombre}`,
    contenido: h('div', { class: 'pila' }, h('p', { class: 'tenue' }, descripcionVariante(v)),
      campo('Cantidad que entra al almacén', cant), campo('Motivo', motivo)),
    acciones: [{ texto: 'Cancelar' }, { texto: 'Registrar entrada', clase: 'btn-pri', alHacer: async () => {
      const n = parseInt(cant.value, 10);
      if (!(n > 0)) { toast('Cantidad no válida', 'error'); return false; }
      if (!motivo.value.trim()) { toast('Escribe el motivo', 'error'); return false; }
      const op = await encolar('ajustar_existencia', { variante_id: v.id, cantidad: n, tipo: 'entrada', motivo: motivo.value.trim() }, `Entrada ${v.nombre}`);
      if (!informar(op, 'Entrada registrada')) return false;
      recargar();
    } }],
  });
}

async function ajuste(v) {
  const cant = h('input', { class: 'input', type: 'number', inputmode: 'numeric', placeholder: '-2 o 3' });
  const r = await modal({
    titulo: 'Ajuste de existencia',
    contenido: h('div', { class: 'pila' },
      h('p', null, `Existencia actual en almacén: `, h('strong', null, formatoNum(v.existencia))),
      campo('Cantidad a sumar (+) o restar (−)', cant, 'Para pérdidas de un evento usa la pantalla de Diferencias.')),
    acciones: [{ texto: 'Cancelar', valor: null }, { texto: 'Continuar', clase: 'btn-pri', alHacer: () => {
      const n = parseInt(cant.value, 10);
      if (!n) { toast('Cantidad no válida', 'error'); return false; }
      return n;
    } }],
  });
  if (!r) return;
  const aut = await pedirAutorizacion({ titulo: `Ajustar ${r > 0 ? '+' : ''}${r}`, mensaje: `Quedará en ${v.existencia + r}.` });
  if (!aut) return;
  try {
    const res = await directo('ajustar_existencia', { variante_id: v.id, cantidad: r, tipo: 'ajuste', motivo: aut.motivo, pin: aut.pin });
    if (!res.ok) return toast(res.error, 'error');
    toast('Ajuste registrado', 'ok');
    recargar();
  } catch (e) { toast(e.message, 'error'); }
}
