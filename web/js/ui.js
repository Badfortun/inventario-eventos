// Utilidades de interfaz
export function h(tag, attrs, ...hijos) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  agregar(el, hijos);
  return el;
}
function agregar(el, hijos) {
  for (const c of hijos.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, raiz = document) => raiz.querySelector(sel);

export function icono(nombre, tam = 22) {
  const p = {
    inicio: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    inventario: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
    eventos: 'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
    diferencias: 'M12 3l9 16H3zM12 10v4M12 17v.5',
    mas: 'M5 12h.01M12 12h.01M19 12h.01',
    buscar: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
    mas1: 'M12 5v14M5 12h14',
    menos: 'M5 12h14',
    atras: 'M15 5l-7 7 7 7',
    nube: 'M7 18a4 4 0 0 1-.5-8 6 6 0 0 1 11.5 1.5A3.5 3.5 0 0 1 17.5 18z',
    salida: 'M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5M3 12h12M11 8l4 4-4 4',
    recogida: 'M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M21 12H9M13 8l-4 4 4 4',
    lista: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    usuario: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
    reloj: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
    descarga: 'M12 4v11M7 10l5 5 5-5M5 20h14',
    editar: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
    deshacer: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
    candado: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
    check: 'M5 13l4 4L19 7',
  }[nombre] || '';
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', tam); s.setAttribute('height', tam);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', p);
  s.append(path);
  return s;
}

// ---------------------------------------------------------------------
export function toast(msg, tipo = 'info', ms = 3500) {
  let cont = $('#toasts');
  if (!cont) { cont = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(cont); }
  const t = h('div', { class: `toast toast-${tipo}`, role: tipo === 'error' ? 'alert' : 'status' }, msg);
  cont.append(t);
  setTimeout(() => { t.classList.add('fuera'); setTimeout(() => t.remove(), 300); }, ms);
}

/** Ventana modal. acciones: [{texto, clase, valor, alHacer: async () => valor|false}]
 *  Devuelve el valor de la acción elegida (o null si se cancela). */
export function modal({ titulo, contenido, acciones = [{ texto: 'Cerrar', valor: null }], ancho }) {
  return new Promise(resolver => {
    const fondo = h('div', { class: 'modal-fondo' });
    const cerrar = v => { fondo.remove(); document.removeEventListener('keydown', esc); resolver(v); };
    const esc = e => { if (e.key === 'Escape') cerrar(null); };
    document.addEventListener('keydown', esc);
    const pie = h('div', { class: 'modal-pie' }, acciones.map(a => h('button', {
      class: `btn ${a.clase || 'btn-sec'}`, type: 'button',
      onclick: async ev => {
        const b = ev.currentTarget;
        if (a.alHacer) {
          b.disabled = true;
          try {
            const r = await a.alHacer();
            if (r === false) { b.disabled = false; return; }
            cerrar(r === undefined ? a.valor : r);
          } catch (e) { b.disabled = false; toast(e.message, 'error'); }
        } else cerrar(a.valor);
      },
    }, a.texto)));
    const caja = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo, style: ancho ? { maxWidth: ancho } : null },
      h('h2', { class: 'modal-titulo' }, titulo),
      h('div', { class: 'modal-cuerpo' }, contenido),
      pie);
    fondo.append(caja);
    fondo.addEventListener('click', e => { if (e.target === fondo) cerrar(null); });
    document.body.append(fondo);
    const primero = caja.querySelector('input, select, textarea');
    if (primero) setTimeout(() => primero.focus(), 50);
  });
}

export async function confirmar(titulo, mensaje, textoSi = 'Confirmar', clase = 'btn-pri') {
  return modal({ titulo, contenido: h('p', null, mensaje),
    acciones: [{ texto: 'Cancelar', valor: false }, { texto: textoSi, clase, valor: true }] });
}

/** Pide PIN (y opcionalmente motivo). Devuelve {pin, motivo} o null. */
export function pedirAutorizacion({ titulo = 'Autorización', mensaje, conMotivo = true, motivoInicial = '' }) {
  const pin = h('input', { type: 'password', inputmode: 'numeric', maxlength: 6, autocomplete: 'off', class: 'input input-pin', placeholder: '••••' });
  const motivo = conMotivo ? h('textarea', { class: 'input', rows: 2, placeholder: 'Motivo (obligatorio)' }, motivoInicial) : null;
  return modal({
    titulo,
    contenido: h('div', { class: 'pila' }, mensaje ? h('p', null, mensaje) : null,
      motivo ? h('label', { class: 'campo' }, h('span', null, 'Motivo'), motivo) : null,
      h('label', { class: 'campo' }, h('span', null, 'Tu PIN'), pin)),
    acciones: [{ texto: 'Cancelar', valor: null },
      { texto: 'Autorizar', clase: 'btn-pri', alHacer: () => {
        if (motivo && !motivo.value.trim()) { toast('Escribe el motivo', 'error'); return false; }
        if (!/^\d{4,6}$/.test(pin.value)) { toast('El PIN tiene de 4 a 6 dígitos', 'error'); return false; }
        return { pin: pin.value, motivo: motivo ? motivo.value.trim() : null };
      } }],
  });
}

// ---------------------------------------------------------------------
export function muestraColor(hex, nombre) {
  if (!hex && !nombre) return null;
  return h('span', { class: 'color' },
    hex ? h('span', { class: 'color-punto', style: { background: hex }, 'aria-hidden': 'true' }) : null,
    nombre ? h('span', null, nombre) : null);
}

export function descripcionVariante(v) {
  return [v.color_nombre, v.medida ? `${formatoNum(v.medida)} ${v.unidad_medida || ''}`.trim() : null]
    .filter(Boolean).join(' · ');
}

export function tituloVariante(v) {
  return h('div', { class: 'variante' },
    h('div', { class: 'variante-nombre' }, v.nombre || v.variante_nombre),
    h('div', { class: 'variante-detalle' },
      v.color_hex ? h('span', { class: 'color-punto', style: { background: v.color_hex }, 'aria-hidden': 'true' }) : null,
      descripcionVariante(v) || (v.sku ? '' : '—'),
      v.sku ? h('span', { class: 'sku' }, v.sku) : null));
}

export const formatoNum = n => (n == null ? '' : Number(n).toLocaleString('es-MX', { maximumFractionDigits: 2 }));

export function fechaHora(t) {
  if (!t) return '';
  return new Date(t).toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function fecha(d) {
  if (!d) return '';
  const [y, m, dd] = String(d).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
export function hace(t) {
  if (!t) return 'nunca';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return fechaHora(t);
}

export const ESTADOS_EVENTO = {
  borrador: { texto: 'Borrador', clase: 'gris' },
  activo: { texto: 'Activo · salidas', clase: 'azul' },
  recogida: { texto: 'En recogida', clase: 'ambar' },
  cerrado: { texto: 'Cerrado', clase: 'verde' },
};
export const chipEstado = e => h('span', { class: `chip chip-${ESTADOS_EVENTO[e]?.clase || 'gris'}` }, ESTADOS_EVENTO[e]?.texto || e);

export const CONCILIACION = {
  sin_salida: { texto: 'Sin salida', clase: 'gris' },
  pendiente: { texto: 'Pendiente', clase: 'gris' },
  parcial: { texto: 'Parcial', clase: 'ambar' },
  completo: { texto: 'Completo', clase: 'verde' },
  faltante: { texto: 'Faltante', clase: 'rojo' },
  sobrante: { texto: 'Sobrante', clase: 'morado' },
  danado: { texto: 'Dañado', clase: 'rojo' },
};
export const chipConciliacion = e => h('span', { class: `chip chip-${CONCILIACION[e]?.clase || 'gris'}` }, CONCILIACION[e]?.texto || e);

export const TIPO_INCIDENCIA = { faltante: 'Faltante', sobrante: 'Sobrante', dano: 'Daño' };
export const ESTADO_INCIDENCIA = {
  pendiente: { texto: 'Pendiente', clase: 'ambar' },
  investigacion: { texto: 'En investigación', clase: 'azul' },
  aprobada: { texto: 'Aprobada', clase: 'verde' },
  rechazada: { texto: 'Rechazada', clase: 'gris' },
  resuelta: { texto: 'Resuelta', clase: 'verde' },
};
export const MOTIVOS = ['pendiente de investigar', 'pérdida confirmada', 'daño', 'préstamo', 'material de otro evento',
  'error de captura', 'sobrante encontrado', 'otro'];

export const ROLES = {
  admin: 'Administrador', salidas: 'Salidas', recogidas: 'Recogidas', lectura: 'Solo lectura',
};

export function vacio(texto, accion) {
  return h('div', { class: 'vacio' }, h('p', null, texto), accion || null);
}

export function cargando() {
  return h('div', { class: 'cargando', role: 'status' }, h('span', { class: 'giro', 'aria-hidden': 'true' }), 'Cargando…');
}

/** Control numérico grande con botones − / + */
export function contador({ valor = 0, min = 0, max = null, alCambiar, etiqueta }) {
  const input = h('input', { type: 'number', inputmode: 'numeric', min, class: 'contador-input', value: valor, 'aria-label': etiqueta || 'Cantidad' });
  const fijar = v => {
    v = Math.max(min, Math.floor(Number(v) || 0));
    if (max != null) v = Math.min(max, v);
    input.value = v;
    alCambiar && alCambiar(v);
  };
  input.addEventListener('change', () => fijar(input.value));
  input.addEventListener('focus', () => input.select());
  return h('div', { class: 'contador' },
    h('button', { type: 'button', class: 'contador-btn', 'aria-label': 'Restar uno', onclick: () => fijar(Number(input.value) - 1) }, icono('menos')),
    input,
    h('button', { type: 'button', class: 'contador-btn', 'aria-label': 'Sumar uno', onclick: () => fijar(Number(input.value) + 1) }, icono('mas1')));
}

export function campo(etiqueta, control, ayuda) {
  return h('label', { class: 'campo' }, h('span', null, etiqueta), control, ayuda ? h('small', null, ayuda) : null);
}

export function textoNormal(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
