import { estadoCola, sincronizar, reintentar, descartar, alCambiarCola } from '../cola.js';
import { h, toast, fechaHora, hace, confirmar, vacio, icono } from '../ui.js';

const ESTADOS = { pendiente: ['Pendiente de enviar', 'ambar'], sincronizado: ['Confirmado por el servidor', 'verde'], error: ['Rechazado', 'rojo'] };

export async function render(p) {
  const info = h('div', { class: 'aviso' });
  const lista = h('ul', { class: 'lista' });
  const pintar = e => {
    info.replaceChildren(
      h('div', null, h('strong', null, e.enLinea ? 'Con conexión' : 'Sin conexión'), ` · Última sincronización: ${hace(e.ultimaSync)}`),
      h('div', { class: 'pequeno' }, `${e.pendientes} pendiente(s) · ${e.errores} rechazada(s)`));
    lista.replaceChildren(...(e.ops.length ? e.ops.map(op => {
      const [t, c] = ESTADOS[op.estado] || [op.estado, 'gris'];
      return h('li', { class: 'tarjeta' },
        h('div', { class: 'fila-entre' }, h('strong', null, op.descripcion), h('span', { class: `chip chip-${c}` }, t)),
        h('div', { class: 'tenue pequeno' }, `Capturado ${fechaHora(op.creado)}`, op.enviado ? ` · enviado ${fechaHora(op.enviado)}` : '', op.intentos ? ` · ${op.intentos} intento(s)` : ''),
        op.error ? h('div', { class: 'texto-rojo pequeno' }, op.error) : null,
        op.estado === 'error' ? h('div', { class: 'tarjeta-acciones' },
          h('button', { class: 'btn btn-sec btn-chico', onclick: async () => {
            const r = await reintentar(op.id);
            toast(r?.estado === 'sincronizado' ? 'Enviado' : (r?.error || 'Sigue pendiente'), r?.estado === 'sincronizado' ? 'ok' : 'error');
          } }, 'Reintentar'),
          h('button', { class: 'btn btn-peligro btn-chico', onclick: async () => {
            if (await confirmar('Descartar operación', 'Esta operación NO quedó registrada en el servidor. Si la descartas, tendrás que capturarla de nuevo si era correcta.', 'Descartar', 'btn-peligro')) descartar(op.id);
          } }, 'Descartar')) : null);
    }) : [h('li', null, vacio('No hay operaciones recientes en este celular.'))]));
  };
  p.append(
    h('div', { class: 'fila-entre' }, h('h1', null, 'Sincronización'),
      h('button', { class: 'btn btn-sec', onclick: async () => {
        try { await sincronizar(); toast('Sincronizado', 'ok'); } catch { toast('Sin conexión; se reintentará automáticamente', 'aviso'); }
      } }, icono('nube', 18), 'Enviar ahora')),
    h('p', { class: 'tenue' }, 'Lo que se captura sin señal se guarda aquí y se envía solo, en orden. Nada se marca como confirmado hasta que el servidor lo acepta, y nunca se registra dos veces.'),
    info, lista);
  pintar(await estadoCola());
  const quitar = alCambiarCola(e => { if (!p.isConnected) return quitar(); pintar(e); });
}
