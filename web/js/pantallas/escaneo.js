// Material del Almacén pendiente de escanear
import { leer } from '../api.js';
import { h, icono, vacio, contador, modal, tituloArticulo, toast } from '../ui.js';
import { estado, puedeRecogidas, ejecutar, informar } from '../estado.js';
import { recargar } from '../app.js';
import { selectorEscaneo } from './componentes.js';

export async function render(p) {
  const alm = estado.lugaresFijos.almacen;
  const [filas, hechos] = await Promise.all([
    leer('v_existencias', { lugar_id: `eq.${alm.id}`, sin_escanear: 'gt.0', order: 'nombre.asc' }),
    leer('v_movimientos', { tipo: 'eq.escaneo', order: 'created_at.desc', limit: 10 }),
  ]);
  const cant = {};
  const total = filas.reduce((s, f) => s + f.sin_escanear, 0);
  const quien = await selectorEscaneo('¿Quién entregó al escaneador?');
  quien.fijar('escaneado');
  quien.el.querySelector('.segmentado').hidden = true;

  const resumen = h('div', { class: 'resumen-flotante' });
  const pintarResumen = () => {
    const n = Object.values(cant).reduce((a, b) => a + b, 0);
    resumen.replaceChildren(h('strong', null, `${n} pieza(s) a marcar`), h('button', { class: 'btn btn-pri', disabled: !n, onclick: guardar }, 'Marcar escaneadas'));
  };
  async function guardar() {
    const items = Object.entries(cant).filter(([, v]) => v > 0).map(([articulo_id, cantidad]) => ({ articulo_id, cantidad }));
    const ok = await modal({ titulo: 'Confirmar escaneo', contenido: h('p', null, `${items.reduce((s, i) => s + i.cantidad, 0)} pieza(s) pasarán a "escaneadas".`),
      acciones: [{ texto: 'Cancelar', valor: false }, { texto: 'Confirmar', clase: 'btn-pri', valor: true }] });
    if (ok && informar(await ejecutar('marcar_escaneado', { items, escaneado_por: quien.quien() }), 'Marcadas como escaneadas')) recargar();
  }

  p.append(
    h('a', { class: 'volver', href: `#/lugar/${alm.id}` }, icono('atras', 18), 'Almacén'),
    h('h1', null, 'Pendiente de escanear'),
    h('p', { class: 'tenue' }, `${total} pieza(s) llegaron al Almacén sin escanear. Cuando el escaneador termine, márcalas aquí.`),
    !puedeRecogidas() ? h('div', { class: 'aviso' }, 'Solo Recogidas o el administrador pueden marcar material como escaneado.') : null,
    filas.length ? [
      puedeRecogidas() ? quien.el : null,
      h('div', { class: 'captura' }, filas.map(f => h('div', { class: 'captura-fila' },
        h('div', { class: 'fila-entre' }, tituloArticulo(f), h('div', { class: 'hay' }, h('strong', { class: 'texto-ambar' }, f.sin_escanear), h('small', null, `de ${f.cantidad} sin escanear`))),
        puedeRecogidas() ? [contador({ valor: 0, max: f.sin_escanear, etiqueta: `Escaneadas de ${f.nombre}`, alCambiar: v => { cant[f.articulo_id] = v; pintarResumen(); } }),
          h('button', { type: 'button', class: 'btn-link pequeno', onclick: e => { cant[f.articulo_id] = f.sin_escanear; e.currentTarget.parentElement.querySelector('.contador-input').value = f.sin_escanear; pintarResumen(); } }, `Todas (${f.sin_escanear})`)] : null))),
      puedeRecogidas() ? resumen : null] : vacio('✓ Todo el material del Almacén está escaneado.'),
    hechos.length ? [h('h2', { class: 'seccion' }, 'Escaneos registrados recientemente'), h('ul', { class: 'lista-compacta' }, hechos.map(m =>
      h('li', null, h('span', null, `${m.piezas} pz · entregó ${m.escaneo_entrada_nombre} · registró ${m.registrado_nombre}`), h('small', { class: 'tenue' }, new Date(m.created_at).toLocaleDateString('es-MX')))))] : null);
  pintarResumen();
  void toast;
}
