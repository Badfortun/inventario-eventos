// Bitácora: quién hizo qué, cuándo y desde dónde
import { leer } from '../api.js';
import { h, icono, toast, fechaHora, campo, vacio, cargando } from '../ui.js';
import { estado, esAdmin, puedeVerBitacora } from '../estado.js';
import { crearXlsx, descargar } from '../xlsx.js';

export const ACCIONES = {
  inicio_sesion: 'Inicio de sesión', registro_usuario: 'Registro de usuario', alta_primer_administrador: 'Primer administrador',
  actualizar_usuario: 'Cambio de usuario / rol', restablecer_contrasena: 'Contraseña restablecida',
  alta_articulo: 'Alta de artículo', editar_articulo: 'Edición de artículo', desactivar_articulo: 'Artículo desactivado', guardar_articulo: 'Alta/edición de artículo',
  alta_existencia: 'Entrada de material nuevo', ajuste_existencia: 'Ajuste de existencia', ajustar_existencia: 'Ajuste de existencia',
  crear_evento: 'Evento creado', editar_evento: 'Evento editado', guardar_evento: 'Alta/edición de evento', cerrar_evento: 'Evento cerrado', reabrir_evento: 'Evento reabierto',
  registrar_movimiento: 'Movimiento de material', solicitar_traslado: 'Solicitud de traslado entre eventos',
  autorizar_traslado: 'Traslado autorizado', rechazar_traslado: 'Traslado rechazado', cancelar_traslado: 'Solicitud cancelada', autorizar_movimiento: 'Autorización',
  corregir_movimiento: 'Corrección de movimiento', revertir_movimiento: 'Corrección', marcar_escaneado: 'Material marcado como escaneado',
};

function resumen(a) {
  const d = a.despues || {}, b = a.antes || {};
  const t = [];
  if (d.origen && d.destino) t.push(`${d.origen} → ${d.destino}`);
  if (d.piezas != null) t.push(`${d.piezas} pieza(s)`);
  if (d.escaneo_salida) t.push(`salida ${d.escaneo_salida === 'escaneado' ? 'escaneada' : 'sin escaneo'}`);
  if (d.escaneo_entrada) t.push(`entrada ${d.escaneo_entrada === 'escaneado' ? 'escaneada' : 'sin escaneo'}`);
  if (d.danadas) t.push(`${d.danadas} dañada(s)`);
  if (d.sobrantes?.length) t.push(`sobrantes: ${d.sobrantes.map(s => `${s.nombre} +${s.sobrante}`).join(', ')}`);
  if (d.perdidas?.length) t.push(`pérdidas: ${d.perdidas.map(s => `${s.cantidad} ${s.nombre}`).join(', ')}`);
  if (b.cantidad != null && d.cantidad != null) t.push(`${b.cantidad} → ${d.cantidad}`);
  if (b.roles && d.roles) t.push(`roles: ${b.roles.join(', ') || 'ninguno'} → ${d.roles.join(', ') || 'ninguno'}; activo: ${b.activo ? 'sí' : 'no'} → ${d.activo ? 'sí' : 'no'}`);
  if (d.escaneado_por) t.push(`entregó al escaneador: ${d.escaneado_por}`);
  return t.join(' · ');
}

export async function render(p) {
  if (!puedeVerBitacora()) return p.append(h('div', { class: 'aviso aviso-error' }, 'Tu rol no tiene acceso a la bitácora.'));
  const usuarios = esAdmin() ? await leer('perfiles', { select: 'id,nombre', order: 'nombre.asc' }) : [];
  const fU = h('select', { class: 'input' }, h('option', { value: '' }, 'Todos'), usuarios.map(u => h('option', { value: u.id }, u.nombre)));
  const fA = h('select', { class: 'input' }, h('option', { value: '' }, 'Todas'), Object.entries(ACCIONES).map(([k, v]) => h('option', { value: k }, v)));
  const fD = h('input', { class: 'input', type: 'date' }), fH = h('input', { class: 'input', type: 'date' });
  const fR = h('input', { type: 'checkbox' });
  const lista = h('ul', { class: 'lista' });
  const info = h('p', { class: 'tenue pequeno' });
  let filas = [];

  async function buscar() {
    lista.replaceChildren(cargando());
    const q = { order: 'created_at.desc', limit: 300 };
    if (fU.value) q.usuario_id = `eq.${fU.value}`;
    if (fA.value) q.accion = `eq.${fA.value}`;
    if (fR.checked) q.exito = 'eq.false';
    const and = [];
    if (fD.value) and.push(`created_at.gte.${new Date(fD.value + 'T00:00:00').toISOString()}`);
    if (fH.value) and.push(`created_at.lte.${new Date(fH.value + 'T23:59:59').toISOString()}`);
    if (and.length) q.and = `(${and.join(',')})`;
    try {
      filas = await leer('v_auditoria', q);
      info.textContent = `${filas.length} registro(s)`;
      lista.replaceChildren(...(filas.length ? filas.map(a => h('li', { class: `bit ${a.exito ? '' : 'bit-rechazo'}` },
        h('div', { class: 'fila-entre' }, h('strong', null, ACCIONES[a.accion] || a.accion), a.exito ? null : h('span', { class: 'chip chip-rojo' }, 'Rechazado')),
        h('div', { class: 'pequeno' }, h('strong', null, a.usuario_nombre || '—'), ` · ${fechaHora(a.created_at)}`, a.dispositivo ? ` · ${a.dispositivo}` : ''),
        a.lugar_nombre || a.articulo_nombre ? h('div', { class: 'pequeno' }, [a.lugar_nombre, a.articulo_nombre].filter(Boolean).join(' · ')) : null,
        resumen(a) ? h('div', { class: 'pequeno' }, resumen(a)) : null,
        a.motivo ? h('div', { class: 'pequeno' }, `Motivo: ${a.motivo}`) : null,
        a.detalle ? h('div', { class: 'pequeno tenue' }, a.detalle) : null)) : [h('li', null, vacio('Sin registros.'))]));
    } catch (e) { lista.replaceChildren(h('li', { class: 'aviso aviso-error' }, e.message)); }
  }

  function exportar() {
    if (!filas.length) return toast('No hay registros', 'error');
    const d = new Date();
    descargar(crearXlsx([{ nombre: 'Bitácora', titulo: ['Bitácora', `Generado ${fechaHora(d)} por ${estado.perfil.nombre}`],
      columnas: [{ titulo: 'Fecha', ancho: 18 }, { titulo: 'Usuario', ancho: 18 }, { titulo: 'Acción', ancho: 26 }, { titulo: 'Resultado', ancho: 10 },
        { titulo: 'Lugar', ancho: 20 }, { titulo: 'Artículo', ancho: 18 }, { titulo: 'Detalle', ancho: 50 }, { titulo: 'Motivo', ancho: 24 }, { titulo: 'Dispositivo', ancho: 18 }],
      filas: filas.map(a => [fechaHora(a.created_at), a.usuario_nombre, ACCIONES[a.accion] || a.accion, a.exito ? 'OK' : 'Rechazado',
        a.lugar_nombre, a.articulo_nombre, [resumen(a), a.detalle].filter(Boolean).join(' · '), a.motivo, a.dispositivo]) }]),
      `Bitacora_${d.toISOString().slice(0, 10)}.xlsx`);
  }

  p.append(
    h('div', { class: 'fila-entre' }, h('h1', null, 'Bitácora'), h('button', { class: 'btn btn-sec', onclick: exportar }, icono('descarga', 18), 'Excel')),
    h('p', { class: 'tenue' }, esAdmin() ? 'Todo lo que se hizo en el sistema. Nadie puede borrar ni editar estos registros.' : 'Tus acciones registradas.'),
    h('details', { class: 'filtros-bit', open: window.innerWidth > 700 }, h('summary', null, 'Filtros'),
      h('div', { class: 'form-grid' }, esAdmin() ? campo('Usuario', fU) : null, campo('Acción', fA), campo('Desde', fD), campo('Hasta', fH),
        h('label', { class: 'check' }, fR, 'Solo intentos rechazados')),
      h('button', { class: 'btn btn-pri', onclick: buscar }, icono('buscar', 18), 'Buscar')),
    info, lista);
  buscar();
}
