import { leer } from '../api.js';
import { conCache, encolar, directo } from '../cola.js';
import { h, vacio, hace, icono, modal, toast, campo, fechaHora, descripcionVariante, pedirAutorizacion,
         TIPO_INCIDENCIA, ESTADO_INCIDENCIA, MOTIVOS, chipEstado } from '../ui.js';
import { esAdmin, puedeRecogidas, informar } from '../estado.js';
import { recargar } from '../app.js';

export async function render(p, eventoId) {
  const filtroBase = eventoId ? { evento_id: `eq.${eventoId}` } : {};
  let ver = sessionStorage.getItem('inv.difVer') || 'abiertas';
  const [{ datos, desdeCache, t }, ev] = await Promise.all([
    conCache(`difs.${eventoId || 'todas'}`, () => leer('v_incidencias', { ...filtroBase, order: 'created_at.desc', limit: 500 })),
    eventoId ? conCache(`evento.${eventoId}`, () => leer('v_eventos', { id: `eq.${eventoId}` })).then(r => r.datos[0]) : null,
  ]);

  const lista = h('div', { class: 'pila' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const abierta = i => ['pendiente', 'investigacion'].includes(i.estado);
  const pintar = () => {
    tabs.replaceChildren(...[['abiertas', 'Por revisar'], ['cerradas', 'Revisadas'], ['todas', 'Todas']].map(([k, txt]) =>
      h('button', { role: 'tab', class: `tab ${k === ver ? 'activo' : ''}`, 'aria-selected': String(k === ver),
        onclick: () => { ver = k; sessionStorage.setItem('inv.difVer', k); pintar(); } },
        txt, h('span', { class: 'tab-n' }, datos.filter(i => k === 'todas' || (k === 'abiertas') === abierta(i)).length))));
    const vis = datos.filter(i => ver === 'todas' || (ver === 'abiertas') === abierta(i));
    lista.replaceChildren(...(vis.length ? vis.map(tarjeta) : [vacio(ver === 'abiertas' ? 'No hay diferencias por revisar. 👍' : 'Sin registros.')]));
  };

  p.append(
    eventoId ? h('a', { class: 'volver', href: `#/evento/${eventoId}` }, icono('atras', 18), ev?.nombre || 'Evento') : null,
    h('div', { class: 'fila-entre' }, h('h1', null, 'Diferencias'), ev ? chipEstado(ev.estado) : null),
    h('p', { class: 'tenue' }, eventoId ? 'Faltantes, sobrantes y daños de este evento.' : 'Faltantes, sobrantes y daños de todos los eventos.'),
    desdeCache ? h('div', { class: 'aviso aviso-aviso' }, `Sin conexión: datos guardados ${hace(t)}.`) : null,
    ev && ev.estado === 'recogida' && !ev.conteo_terminado ? h('div', { class: 'aviso' }, 'Las diferencias se generan al pulsar "Terminar conteo" en el evento.') : null,
    tabs, lista);
  pintar();
}

function tarjeta(i) {
  const est = ESTADO_INCIDENCIA[i.estado];
  const abierta = ['pendiente', 'investigacion'].includes(i.estado);
  const cerrado = i.evento_estado === 'cerrado';
  const claseTipo = i.tipo === 'sobrante' ? 'morado' : 'rojo';
  return h('article', { class: 'tarjeta' },
    h('div', { class: 'fila-entre' },
      h('div', { class: 'fila' }, h('span', { class: `chip chip-${claseTipo}` }, TIPO_INCIDENCIA[i.tipo]), h('span', { class: `chip chip-${est.clase}` }, est.texto)),
      h('strong', { class: `cant-grande texto-${claseTipo}` }, `${i.tipo === 'sobrante' ? '+' : i.tipo === 'faltante' ? '−' : ''}${i.cantidad}`)),
    h('h3', null, i.variante_nombre, ' ', h('span', { class: 'tenue normal' }, descripcionVariante(i))),
    h('div', null, h('a', { href: `#/evento/${i.evento_id}` }, i.evento_nombre)),
    h('div', { class: 'tenue pequeno' }, i.tipo === 'dano'
      ? `${i.cantidad_contada} pieza(s) regresaron dañadas`
      : `Entregado ${i.cantidad_esperada} · Contado ${i.cantidad_contada} · Diferencia ${i.diferencia > 0 ? '+' : ''}${i.diferencia}`),
    h('div', { class: 'pequeno' }, h('strong', null, 'Motivo: '), i.motivo),
    i.notas ? h('div', { class: 'pequeno' }, h('strong', null, 'Notas: '), i.notas) : null,
    i.accion ? h('div', { class: 'pequeno' }, h('strong', null, 'Resolución: '), i.accion) : null,
    h('div', { class: 'tenue pequeno' }, `Generada ${fechaHora(i.created_at)}`, i.reportado_por_nombre ? ` · ${i.reportado_por_nombre}` : '',
      i.revisado_por_nombre ? ` · Revisó ${i.revisado_por_nombre} ${fechaHora(i.revisado_at)}` : ''),
    abierta && !cerrado ? h('div', { class: 'tarjeta-acciones' },
      puedeRecogidas() ? h('button', { class: 'btn btn-sec btn-chico', onclick: () => anotar(i) }, icono('editar', 16), 'Motivo / notas') : null,
      esAdmin() && i.tipo === 'sobrante' ? h('button', { class: 'btn btn-sec btn-chico', onclick: () => transferir(i) }, 'Es de otro evento') : null,
      esAdmin() ? h('button', { class: 'btn btn-sec btn-chico', onclick: () => resolver(i, 'rechazada') }, 'Rechazar') : null,
      esAdmin() ? h('button', { class: 'btn btn-pri btn-chico', onclick: () => resolver(i, 'aprobada') }, icono('check', 16), 'Aprobar') : null) : null);
}

function selectorMotivo(actual) {
  return h('select', { class: 'input' }, MOTIVOS.map(m => h('option', { value: m, selected: m === actual }, m[0].toUpperCase() + m.slice(1))));
}

async function anotar(i) {
  const motivo = selectorMotivo(i.motivo);
  const notas = h('textarea', { class: 'input', rows: 3, placeholder: 'Qué se sabe: quién lo tenía, dónde se buscó…' }, i.notas || '');
  const enInv = h('input', { type: 'checkbox', checked: i.estado === 'investigacion' });
  await modal({
    titulo: 'Motivo y notas',
    contenido: h('div', { class: 'pila' }, campo('Motivo', motivo), campo('Notas', notas), h('label', { class: 'check' }, enInv, 'Marcar como "en investigación"')),
    acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', clase: 'btn-pri', alHacer: async () => {
      const op = await encolar('resolver_incidencia', { incidencia_id: i.id, estado: enInv.checked ? 'investigacion' : 'pendiente',
        motivo: motivo.value, notas: notas.value.trim() }, `Notas en diferencia ${i.variante_nombre}`);
      if (!informar(op, 'Guardado')) return false;
      recargar();
    } }],
  });
}

async function resolver(i, estadoNuevo) {
  const motivo = selectorMotivo(estadoNuevo === 'aprobada'
    ? (i.tipo === 'faltante' ? (i.motivo === 'pendiente de investigar' ? 'pérdida confirmada' : i.motivo)
      : i.tipo === 'sobrante' ? (i.motivo === 'pendiente de investigar' ? 'sobrante encontrado' : i.motivo) : 'daño')
    : 'error de captura');
  const notas = h('textarea', { class: 'input', rows: 2 }, i.notas || '');
  const retirar = h('input', { type: 'checkbox' });
  const pin = h('input', { type: 'password', inputmode: 'numeric', maxlength: 6, class: 'input input-pin', placeholder: '••••', autocomplete: 'off' });
  const efecto = estadoNuevo === 'rechazada'
    ? 'La diferencia no se acepta. Corrige el conteo (Movimientos → Corregir) y vuelve a terminar el conteo.'
    : i.tipo === 'faltante' ? `Se darán de baja ${i.cantidad} unidad(es) como pérdida de este evento. La existencia del almacén no cambia (esas piezas ya no estaban).`
    : i.tipo === 'sobrante' ? `Se aceptan ${i.cantidad} unidad(es) de más. Ya están sumadas en el almacén. Si son de otro evento, usa "Es de otro evento".`
    : `Se revisan ${i.cantidad} pieza(s) dañada(s).`;
  await modal({
    titulo: `${estadoNuevo === 'aprobada' ? 'Aprobar' : 'Rechazar'} ${TIPO_INCIDENCIA[i.tipo].toLowerCase()}`,
    contenido: h('div', { class: 'pila' },
      h('p', null, h('strong', null, `${i.cantidad} × ${i.variante_nombre}`), ` · ${i.evento_nombre}`),
      h('div', { class: 'aviso' }, efecto),
      campo('Motivo', motivo), campo('Notas', notas),
      i.tipo === 'dano' && estadoNuevo === 'aprobada' ? h('label', { class: 'check' }, retirar, 'Retirar del inventario (ya no sirven)') : null,
      estadoNuevo === 'aprobada' ? campo('Tu PIN', pin) : null),
    acciones: [{ texto: 'Cancelar' }, { texto: estadoNuevo === 'aprobada' ? 'Aprobar' : 'Rechazar', clase: estadoNuevo === 'aprobada' ? 'btn-pri' : 'btn-peligro', alHacer: async () => {
      if (estadoNuevo === 'aprobada' && !/^\d{4,6}$/.test(pin.value)) { toast('Escribe tu PIN', 'error'); return false; }
      try {
        const r = await directo('resolver_incidencia', { incidencia_id: i.id, estado: estadoNuevo, motivo: motivo.value,
          notas: notas.value.trim(), retirar: retirar.checked, pin: pin.value });
        if (!r.ok) { toast(r.error, 'error'); return false; }
      } catch (e) { toast(e.message, 'error'); return false; }
      toast(estadoNuevo === 'aprobada' ? 'Diferencia aprobada' : 'Diferencia rechazada', 'ok');
      recargar();
    } }],
  });
}

async function transferir(i) {
  const { datos: eventos } = await conCache('eventos', () => leer('v_eventos', { order: 'fecha.desc', limit: 300 }));
  const opciones = eventos.filter(e => e.id !== i.evento_id && e.estado !== 'cerrado');
  if (!opciones.length) return toast('No hay otros eventos abiertos', 'error');
  const destino = h('select', { class: 'input' }, opciones.map(e => h('option', { value: e.id }, `${e.nombre} (${e.fecha})`)));
  const cant = h('input', { class: 'input', type: 'number', min: 1, max: i.cantidad, value: i.cantidad, inputmode: 'numeric' });
  const datosT = await modal({
    titulo: 'Material de otro evento',
    contenido: h('div', { class: 'pila' },
      h('p', null, `Se contaron de más ${i.cantidad} × ${i.variante_nombre} en "${i.evento_nombre}". Si pertenecen a otro evento, se reclasifica el conteo (la existencia del almacén no cambia).`),
      campo('Evento al que pertenecen', destino), campo('Cantidad', cant)),
    acciones: [{ texto: 'Cancelar', valor: null }, { texto: 'Continuar', clase: 'btn-pri', alHacer: () => {
      const n = parseInt(cant.value, 10);
      if (!(n > 0)) { toast('Cantidad no válida', 'error'); return false; }
      return { destino: destino.value, n };
    } }],
  });
  if (!datosT) return;
  const a = await pedirAutorizacion({ titulo: 'Transferir conteo entre eventos', motivoInicial: 'Material de otro evento' });
  if (!a) return;
  try {
    const r = await directo('transferir_entre_eventos', { origen_id: i.evento_id, destino_id: datosT.destino, variante_id: i.variante_id,
      cantidad: datosT.n, motivo: a.motivo, pin: a.pin });
    if (!r.ok) return toast(r.error, 'error');
    toast('Conteo transferido', 'ok');
    recargar();
  } catch (e) { toast(e.message, 'error'); }
}
