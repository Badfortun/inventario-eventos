// Utilidades de interfaz

// append/replaceChildren tolerantes: ignoran null/undefined/false y aplanan listas
// (las pantallas arman contenido condicional como "cond ? elemento : null").
for (const metodo of ['append', 'replaceChildren']) {
  const original = Element.prototype[metodo];
  Element.prototype[metodo] = function (...xs) {
    return original.apply(this, xs.flat(Infinity).filter(x => x != null && x !== false));
  };
}
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
    mover: 'M4 8h14l-4-4M20 16H6l4 4',
    codigo: 'M4 6v12M7 6v12M10 6v12M14 6v12M17 6v12M20 6v12',
    mapa: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
    escudo: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
    herramienta: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z',
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
    if (primero) setTimeout(() => { if (!caja.contains(document.activeElement)) primero.focus(); }, 50);
  });
}

export async function confirmar(titulo, mensaje, textoSi = 'Confirmar', clase = 'btn-pri') {
  return modal({ titulo, contenido: h('p', null, mensaje),
    acciones: [{ texto: 'Cancelar', valor: false }, { texto: textoSi, clase, valor: true }] });
}

/** Pide un texto (motivo). Devuelve el texto o null. */
export function pedirMotivo({ titulo, mensaje, textoBoton = 'Confirmar', clase = 'btn-pri', inicial = '' }) {
  const motivo = h('textarea', { class: 'input', rows: 3, placeholder: 'Motivo (obligatorio)' }, inicial);
  return modal({
    titulo,
    contenido: h('div', { class: 'pila' }, mensaje ? h('p', null, mensaje) : null, h('label', { class: 'campo' }, h('span', null, 'Motivo'), motivo)),
    acciones: [{ texto: 'Cancelar', valor: null }, { texto: textoBoton, clase, alHacer: () => {
      if (!motivo.value.trim()) { toast('Escribe el motivo', 'error'); return false; }
      return motivo.value.trim();
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
  return [v.color_nombre, v.medida ? `${formatoNum(v.medida)} ${v.unidad_medida || ''}`.trim() : null, v.tamano]
    .filter(Boolean).join(' · ');
}

/** Nombre del artículo con color, medida y código */
export function tituloArticulo(v) {
  return h('div', { class: 'variante' },
    h('div', { class: 'variante-nombre' }, v.nombre),
    h('div', { class: 'variante-detalle' },
      v.color_hex ? h('span', { class: 'color-punto', style: { background: v.color_hex }, 'aria-hidden': 'true' }) : null,
      descripcionVariante(v) || null,
      v.codigo ? h('span', { class: 'sku' }, v.codigo) : null));
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

export const TIPO_LUGAR = { almacen: 'Almacén', reparacion: 'Reparación', evento: 'Evento', perdida: 'Pérdidas', baja: 'Dados de baja' };
export const chipEstadoEvento = e => h('span', { class: `chip chip-${e === 'abierto' ? 'azul' : 'verde'}` }, e === 'abierto' ? 'Abierto' : 'Cerrado');

export const ESTADO_MOV = {
  aplicado: { texto: 'Registrado', clase: 'verde' },
  por_autorizar: { texto: 'Por autorizar', clase: 'ambar' },
  rechazado: { texto: 'Rechazado', clase: 'gris' },
  revertido: { texto: 'Corregido', clase: 'gris' },
};
export const TIPO_MOV = {
  traslado: 'Traslado', alta: 'Alta de material', ajuste: 'Ajuste', perdida: 'Pérdida (cierre de evento)',
  baja: 'Baja', correccion: 'Corrección', escaneo: 'Escaneo en almacén',
};
export function chipEscaneo(estado, nombre, etiqueta) {
  if (!estado) return null;
  return h('span', { class: `chip chip-${estado === 'escaneado' ? 'verde' : 'ambar'}` },
    `${etiqueta}: ${estado === 'escaneado' ? `escaneada${nombre ? ' · ' + nombre : ''}` : 'sin escaneo'}`);
}

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
