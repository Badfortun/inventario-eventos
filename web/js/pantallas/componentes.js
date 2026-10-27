// Piezas compartidas entre pantallas
import { leer } from '../api.js';
import { h, icono, fechaHora, descripcionVariante, chipEscaneo, ESTADO_MOV, TIPO_MOV, modal, campo, toast, pedirMotivo } from '../ui.js';
import { estado, esAdmin, ejecutar, informar } from '../estado.js';

export function metrica(etiqueta, valor, clase) {
  return h('div', { class: `metrica ${clase ? 'metrica-' + clase : ''}` }, h('strong', null, valor ?? 0), h('span', null, etiqueta));
}

/** Lista de usuarios activos (para "entregó al escaneador") */
let cachePersonas = null;
export async function personas() {
  if (!cachePersonas) cachePersonas = await leer('perfiles', { activo: 'eq.true', select: 'id,nombre,usuario', order: 'nombre.asc' });
  return cachePersonas;
}

/** Selector de escaneo: [Escaneado | Sin escaneo] + quién entregó al escaneador */
export async function selectorEscaneo(titulo, ayuda) {
  const gente = await personas();
  let valor = null;
  const quien = h('select', { class: 'input', 'aria-label': `${titulo}: entregó al escaneador` },
    gente.map(p => h('option', { value: p.id, selected: p.id === estado.perfil.id }, p.nombre)));
  const zonaQuien = h('label', { class: 'campo', hidden: true }, h('span', null, 'Entregó al escaneador'), quien);
  const btnSi = h('button', { type: 'button', class: 'seg', 'aria-pressed': 'false' }, icono('check', 18), 'Escaneado');
  const btnNo = h('button', { type: 'button', class: 'seg', 'aria-pressed': 'false' }, 'Sin escaneo');
  const fijar = v => {
    valor = v;
    btnSi.setAttribute('aria-pressed', String(v === 'escaneado'));
    btnNo.setAttribute('aria-pressed', String(v === 'sin_escaneo'));
    btnSi.classList.toggle('activo', v === 'escaneado'); btnNo.classList.toggle('activo', v === 'sin_escaneo');
    zonaQuien.hidden = v !== 'escaneado';
  };
  btnSi.onclick = () => fijar('escaneado');
  btnNo.onclick = () => fijar('sin_escaneo');
  const el = h('fieldset', { class: 'escaneo' }, h('legend', null, titulo), ayuda ? h('small', { class: 'tenue' }, ayuda) : null,
    h('div', { class: 'segmentado', role: 'group' }, btnSi, btnNo), zonaQuien);
  return { el, valor: () => valor, quien: () => (valor === 'escaneado' ? quien.value : null), fijar };
}

export function nombreLugar(tipo, nombre) {
  return nombre;
}

/** Tarjeta de un movimiento */
export function tarjetaMovimiento(m, { alCambiar } = {}) {
  const est = ESTADO_MOV[m.estado];
  const puedeCorregir = m.estado === 'aplicado' && ['traslado', 'alta', 'ajuste', 'baja'].includes(m.tipo) &&
    (esAdmin() || (m.registrado_por === estado.perfil.id && estado.perfil.roles.some(r => ['salidas', 'recogidas'].includes(r))));
  const ruta = m.tipo === 'escaneo' ? 'Almacén · escaneo posterior'
    : `${m.origen_nombre || (m.tipo === 'alta' ? 'Alta' : 'Ajuste')} → ${m.destino_nombre || 'Ajuste'}`;
  return h('article', { class: `mov ${m.estado === 'revertido' || m.estado === 'rechazado' ? 'mov-revertido' : ''}` },
    h('div', { class: 'mov-cab' },
      h('strong', { class: 'mov-ruta' }, ruta),
      m.estado !== 'aplicado' ? h('span', { class: `chip chip-${est.clase}` }, est.texto) : null,
      m.tipo !== 'traslado' ? h('span', { class: 'chip chip-gris' }, TIPO_MOV[m.tipo]) : null,
      h('strong', { class: 'mov-cant' }, `${m.piezas} pz`)),
    h('ul', { class: 'mov-items' }, (m.items || []).map(i => h('li', null,
      h('strong', null, i.cantidad), ` × ${i.nombre}`, descripcionVariante(i) ? h('span', { class: 'tenue' }, ` · ${descripcionVariante(i)}`) : null,
      h('span', { class: 'sku' }, i.codigo),
      i.danadas ? h('span', { class: 'chip chip-rojo' }, `${i.danadas} dañada(s) → Reparación`) : null,
      i.sobrante ? h('span', { class: 'chip chip-morado' }, `${i.sobrante} sobrante(s)`) : null))),
    h('div', { class: 'fila chips' },
      chipEscaneo(m.escaneo_salida, m.escaneo_salida_nombre, 'Salida'),
      chipEscaneo(m.escaneo_entrada, m.escaneo_entrada_nombre, m.tipo === 'escaneo' ? 'Escaneo' : 'Entrada')),
    h('div', { class: 'tenue pequeno' }, `Registró ${m.registrado_nombre} · ${fechaHora(m.created_at)}`, m.dispositivo ? ` · ${m.dispositivo}` : ''),
    m.autorizado_nombre ? h('div', { class: 'pequeno' }, `${m.estado === 'rechazado' ? 'Rechazó' : 'Autorizó'} ${m.autorizado_nombre} · ${fechaHora(m.autorizado_at)}`,
      m.rechazo_motivo ? ` · ${m.rechazo_motivo}` : '') : null,
    m.revertido_nombre ? h('div', { class: 'pequeno' }, `Corregido por ${m.revertido_nombre} · ${fechaHora(m.revertido_at)}`) : null,
    m.notas || m.motivo ? h('div', { class: 'pequeno' }, m.motivo ? `Motivo: ${m.motivo}` : '', m.notas ? ` ${m.notas}` : '') : null,
    puedeCorregir ? h('button', { class: 'btn btn-sec btn-chico', onclick: async () => {
      const motivo = await pedirMotivo({ titulo: 'Corregir movimiento', textoBoton: 'Corregir', clase: 'btn-peligro',
        mensaje: 'Se anula este movimiento y las piezas regresan a donde estaban. El registro original NO se borra.' });
      if (!motivo) return;
      if (informar(await ejecutar('revertir_movimiento', { movimiento_id: m.id, motivo }), 'Movimiento corregido')) alCambiar?.();
    } }, icono('deshacer', 16), 'Corregir') : null);
}

/** Selector de artículo con búsqueda */
export async function elegirArticulo({ titulo = 'Agregar artículo', excluir = [] } = {}) {
  const lista = await leer('v_articulos', { activo: 'eq.true', order: 'nombre.asc,color_nombre.asc,medida.asc' });
  const disp = lista.filter(a => !excluir.includes(a.id));
  const buscar = h('input', { class: 'input', type: 'search', placeholder: 'Código, nombre, color…', 'aria-label': 'Buscar' });
  const ul = h('ul', { class: 'lista lista-elegir' });
  let elegido = null;
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const pintar = () => {
    const w = norm(buscar.value).split(/\s+/).filter(Boolean);
    ul.replaceChildren(...disp.filter(a => w.every(x => norm([a.codigo, a.nombre, a.color_nombre, a.categoria, a.medida, a.tamano].join(' ')).includes(x)))
      .slice(0, 60).map(a => h('li', null, h('button', { type: 'button', class: `lista-item ${elegido?.id === a.id ? 'elegido' : ''}`,
        onclick: () => { elegido = a; pintar(); } },
        h('div', null, h('strong', null, a.nombre), h('div', { class: 'tenue pequeno' }, [descripcionVariante(a), a.codigo].filter(Boolean).join(' · '))),
        h('span', { class: 'tenue pequeno' }, `${a.total} pz`)))));
  };
  buscar.addEventListener('input', pintar);
  pintar();
  return modal({ titulo, ancho: '560px', contenido: h('div', { class: 'pila' }, buscar, ul),
    acciones: [{ texto: 'Cancelar', valor: null }, { texto: 'Agregar', clase: 'btn-pri', alHacer: () => elegido || (toast('Elige un artículo', 'error'), false) }] });
}

void campo;
