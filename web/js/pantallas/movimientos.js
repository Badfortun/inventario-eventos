import { leer } from '../api.js';
import { conCache, encolar } from '../cola.js';
import { h, fechaHora, descripcionVariante, icono, modal, campo, toast, chipEstado, vacio } from '../ui.js';
import { estado, esAdmin, informar } from '../estado.js';
import { recargar } from '../app.js';

const TIPOS = {
  entrada: ['Entrada', 'verde'], ajuste: ['Ajuste', 'morado'], salida: ['Salida', 'azul'], devolucion: ['Recogida', 'verde'],
  reversion: ['Corrección', 'gris'], transferencia: ['Transferencia', 'morado'], baja: ['Baja (pérdida)', 'rojo'],
  retiro_dano: ['Retiro por daño', 'rojo'],
};

export function filaMovimiento(m, { mostrarEvento = false, mostrarArticulo = false, permitirRevertir = false } = {}) {
  const [txt, clase] = TIPOS[m.tipo] || [m.tipo, 'gris'];
  const signo = m.efecto_existencia > 0 ? '+' : '';
  const puede = permitirRevertir && !m.revertido && ['salida', 'devolucion'].includes(m.tipo) &&
    (esAdmin() || (m.usuario_id === estado.perfil.id &&
      ((m.tipo === 'salida' && estado.perfil.roles.includes('salidas')) || (m.tipo === 'devolucion' && estado.perfil.roles.includes('recogidas')))));
  return h('li', { class: `mov ${m.revertido ? 'mov-revertido' : ''}` },
    h('div', { class: 'mov-cab' },
      h('span', { class: `chip chip-${clase}` }, txt),
      m.condicion === 'danada' ? h('span', { class: 'chip chip-rojo' }, 'Dañada') : null,
      m.forzado ? h('span', { class: 'chip chip-rojo' }, 'Excepcional') : null,
      m.revertido ? h('span', { class: 'chip chip-gris' }, 'Corregido') : null,
      h('strong', { class: 'mov-cant' }, `${m.tipo === 'transferencia' && m.cantidad > 0 ? '+' : ''}${m.cantidad}`)),
    mostrarArticulo ? h('div', null, h('strong', null, m.variante_nombre), ' ', h('span', { class: 'tenue' }, descripcionVariante(m))) : null,
    mostrarEvento && m.evento_nombre ? h('div', null, h('a', { href: `#/evento/${m.evento_id}` }, m.evento_nombre)) : null,
    h('div', { class: 'tenue pequeno' },
      `${m.usuario_nombre} · ${fechaHora(m.created_at)}`,
      m.dispositivo ? ` · ${m.dispositivo}` : '',
      m.efecto_existencia ? ` · almacén ${signo}${m.efecto_existencia}` : ''),
    m.motivo ? h('div', { class: 'pequeno' }, `Motivo: ${m.motivo}`) : null,
    puede ? h('button', { class: 'btn btn-sec btn-chico', onclick: () => revertir(m) }, icono('deshacer', 16), 'Corregir (revertir)') : null);
}

async function revertir(m) {
  const motivo = h('textarea', { class: 'input', rows: 2, placeholder: 'Ej. Conté de más / me equivoqué de evento' });
  await modal({
    titulo: 'Corregir registro',
    contenido: h('div', { class: 'pila' },
      h('p', null, `Se anulará la ${m.tipo === 'salida' ? 'salida' : 'recogida'} de `, h('strong', null, `${m.cantidad} × ${m.variante_nombre}`),
        '. El registro original NO se borra: se agrega un movimiento de corrección a tu nombre.'),
      campo('Motivo *', motivo)),
    acciones: [{ texto: 'Cancelar' }, { texto: 'Corregir', clase: 'btn-peligro', alHacer: async () => {
      if (!motivo.value.trim()) { toast('Escribe el motivo', 'error'); return false; }
      const op = await encolar('revertir_movimiento', { movimiento_id: m.id, motivo: motivo.value.trim() }, `Corregir ${m.variante_nombre}`);
      if (!informar(op, 'Registro corregido')) return false;
      recargar();
    } }],
  });
}

export async function render(p, eventoId) {
  const [{ datos: [ev] }, { datos: movs }] = await Promise.all([
    conCache(`evento.${eventoId}`, () => leer('v_eventos', { id: `eq.${eventoId}` })),
    conCache(`evento.${eventoId}.movs`, () => leer('v_movimientos', { evento_id: `eq.${eventoId}`, order: 'created_at.desc', limit: 500 })),
  ]);
  if (!ev) { p.append(vacio('Evento no encontrado')); return; }
  let filtro = 'todos';
  const lista = h('ul', { class: 'lista lista-movs' });
  const pintar = () => {
    const vis = movs.filter(m => filtro === 'todos' || (filtro === 'mios' ? m.usuario_id === estado.perfil.id : m.tipo === filtro));
    lista.replaceChildren(...(vis.length ? vis.map(m => filaMovimiento(m, { mostrarArticulo: true, permitirRevertir: ev.estado !== 'cerrado' }))
      : [h('li', null, vacio('Sin movimientos con este filtro.'))]));
  };
  const chips = h('div', { class: 'chips-filtro', role: 'group', 'aria-label': 'Filtrar' },
    [['todos', 'Todos'], ['mios', 'Míos'], ['salida', 'Salidas'], ['devolucion', 'Recogidas'], ['reversion', 'Correcciones']].map(([k, t]) =>
      h('button', { type: 'button', class: `chip-btn ${k === filtro ? 'activo' : ''}`, 'aria-pressed': String(k === filtro),
        onclick: e => { filtro = k; chips.querySelectorAll('.chip-btn').forEach(b => { b.classList.toggle('activo', b === e.currentTarget); b.setAttribute('aria-pressed', String(b === e.currentTarget)); }); pintar(); } }, t)));
  p.append(
    h('a', { class: 'volver', href: `#/evento/${eventoId}` }, icono('atras', 18), ev.nombre),
    h('div', { class: 'fila-entre' }, h('h1', null, 'Movimientos'), chipEstado(ev.estado)),
    h('p', { class: 'tenue' }, 'Cada registro muestra quién lo hizo, cuándo y desde qué dispositivo. Solo puedes corregir tus propios registros.'),
    chips, lista);
  pintar();
}
