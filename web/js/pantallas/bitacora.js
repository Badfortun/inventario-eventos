import { leer } from '../api.js';
import { h, icono, toast, fechaHora, campo, vacio, cargando } from '../ui.js';
import { estado, esAdmin, puedeVerBitacora } from '../estado.js';
import { crearXlsx, descargar } from '../xlsx.js';

export const ACCIONES = {
  inicio_sesion: 'Inicio de sesión', registro_usuario: 'Registro de usuario', alta_primer_administrador: 'Primer administrador',
  actualizar_usuario: 'Cambio de usuario / rol', restablecer_acceso: 'Restablecer acceso', establecer_pin: 'Cambio de PIN', verificar_pin: 'PIN incorrecto',
  alta_articulo: 'Alta de artículo', editar_articulo: 'Edición de artículo', desactivar_articulo: 'Artículo desactivado', reactivar_articulo: 'Artículo reactivado',
  guardar_variante: 'Alta/edición de artículo', entrada_existencia: 'Entrada de existencia', ajuste_existencia: 'Ajuste de existencia', ajustar_existencia: 'Ajuste de existencia',
  crear_evento: 'Evento creado', editar_evento: 'Evento editado', guardar_evento: 'Alta/edición de evento', agregar_a_evento: 'Material agregado a evento', cambiar_planeado: 'Cambio de cantidad planeada',
  planear_item: 'Planeación de material', cambiar_estado_evento: 'Cambio de estado de evento', cerrar_evento: 'Evento cerrado', reabrir_evento: 'Evento reabierto',
  registrar_salida: 'Salida', registrar_recogida: 'Recogida', terminar_conteo: 'Conteo terminado',
  revertir_salida: 'Corrección de salida', revertir_devolucion: 'Corrección de recogida', revertir_movimiento: 'Corrección',
  transferir_entre_eventos: 'Transferencia entre eventos', incidencia_pendiente: 'Diferencia: notas', incidencia_investigacion: 'Diferencia en investigación',
  incidencia_aprobada: 'Diferencia aprobada', incidencia_rechazada: 'Diferencia rechazada', resolver_incidencia: 'Revisión de diferencia',
};

function resumenCambio(a) {
  const d = a.despues || {}, b = a.antes || {};
  const partes = [];
  if (d.cantidad != null) partes.push(`Cantidad: ${d.cantidad}${d.condicion === 'danada' ? ' (dañadas)' : ''}`);
  if (b.existencia != null && d.existencia != null) partes.push(`Almacén: ${b.existencia} → ${d.existencia}`);
  if (b.estado && d.estado) partes.push(`Estado: ${b.estado} → ${d.estado}`);
  if (b.planeada != null || d.planeada != null) partes.push(`Planeado: ${b.planeada ?? '—'} → ${d.planeada}`);
  if (b.roles && d.roles) partes.push(`Roles: ${b.roles.join(', ') || 'ninguno'} → ${d.roles.join(', ') || 'ninguno'}; activo: ${b.activo ? 'sí' : 'no'} → ${d.activo ? 'sí' : 'no'}`);
  if (d.forzado) partes.push('EXCEPCIONAL');
  if (d.accion) partes.push(d.accion);
  if (d.origen && d.destino) partes.push(`${d.origen} → ${d.destino}`);
  if (a.entidad === 'variante' && b.nombre !== undefined && d.nombre !== undefined) {
    const cambios = Object.keys(d).filter(k => !['updated_at', 'existencia'].includes(k) && JSON.stringify(b[k]) !== JSON.stringify(d[k]));
    if (cambios.length) partes.push(`Cambió: ${cambios.join(', ')}`);
  }
  return partes.join(' · ');
}

export async function render(p) {
  if (!puedeVerBitacora()) { p.append(h('div', { class: 'aviso aviso-error' }, 'Tu rol no tiene acceso a la bitácora.')); return; }
  const [usuarios, eventos] = await Promise.all([
    esAdmin() ? leer('perfiles', { select: 'id,nombre,usuario', order: 'nombre.asc' }) : Promise.resolve([]),
    leer('eventos', { select: 'id,nombre,fecha', order: 'fecha.desc', limit: 300 }),
  ]);
  const fUsuario = h('select', { class: 'input' }, h('option', { value: '' }, 'Todos'), usuarios.map(u => h('option', { value: u.id }, `${u.nombre} (${u.usuario})`)));
  const fEvento = h('select', { class: 'input' }, h('option', { value: '' }, 'Todos'), eventos.map(e => h('option', { value: e.id }, `${e.nombre} · ${e.fecha}`)));
  const fAccion = h('select', { class: 'input' }, h('option', { value: '' }, 'Todas'),
    Object.entries(ACCIONES).filter(([k]) => !['guardar_variante', 'guardar_evento', 'planear_item', 'revertir_movimiento', 'resolver_incidencia', 'ajustar_existencia'].includes(k))
      .map(([k, t]) => h('option', { value: k }, t)));
  const fDesde = h('input', { class: 'input', type: 'date' });
  const fHasta = h('input', { class: 'input', type: 'date' });
  const fRech = h('input', { type: 'checkbox' });
  const lista = h('ul', { class: 'lista lista-bitacora' });
  const info = h('p', { class: 'tenue pequeno' });
  const mas = h('button', { class: 'btn btn-sec', hidden: true }, 'Cargar más');
  let filas = [], offset = 0;
  const PAG = 150;

  const params = () => {
    const q = { order: 'created_at.desc', limit: PAG, offset };
    if (fUsuario.value) q.usuario_id = `eq.${fUsuario.value}`;
    if (fEvento.value) q.evento_id = `eq.${fEvento.value}`;
    if (fAccion.value) q.accion = `eq.${fAccion.value}`;
    if (fRech.checked) q.exito = 'eq.false';
    const and = [];
    if (fDesde.value) and.push(`created_at.gte.${new Date(fDesde.value + 'T00:00:00').toISOString()}`);
    if (fHasta.value) and.push(`created_at.lte.${new Date(fHasta.value + 'T23:59:59').toISOString()}`);
    if (and.length) q.and = `(${and.join(',')})`;
    return q;
  };

  async function buscar(reiniciar = true) {
    if (reiniciar) { offset = 0; filas = []; lista.replaceChildren(cargando()); }
    try {
      const nuevas = await leer('v_auditoria', params());
      filas = filas.concat(nuevas);
      offset += nuevas.length;
      mas.hidden = nuevas.length < PAG;
      info.textContent = `${filas.length} registro(s)${mas.hidden ? '' : ' (hay más)'}`;
      lista.replaceChildren(...(filas.length ? filas.map(fila) : [h('li', null, vacio('Sin registros con estos filtros.'))]));
    } catch (e) { lista.replaceChildren(h('li', { class: 'aviso aviso-error' }, e.message)); }
  }
  mas.onclick = () => buscar(false);

  function fila(a) {
    return h('li', { class: `bit ${a.exito ? '' : 'bit-rechazo'}` },
      h('div', { class: 'fila-entre' },
        h('strong', null, ACCIONES[a.accion] || a.accion),
        a.exito ? null : h('span', { class: 'chip chip-rojo' }, 'Rechazado')),
      h('div', { class: 'pequeno' }, h('strong', null, a.usuario_nombre || '—'), ` · ${fechaHora(a.created_at)}`, a.dispositivo ? ` · ${a.dispositivo}` : ''),
      a.evento_nombre || a.variante_nombre ? h('div', { class: 'pequeno' }, [a.evento_nombre, a.variante_nombre].filter(Boolean).join(' · ')) : null,
      resumenCambio(a) ? h('div', { class: 'pequeno' }, resumenCambio(a)) : null,
      a.motivo ? h('div', { class: 'pequeno' }, `Motivo: ${a.motivo}`) : null,
      a.detalle ? h('div', { class: 'pequeno tenue' }, a.detalle) : null,
      a.hora_local && Math.abs(new Date(a.hora_local) - new Date(a.created_at)) > 120000
        ? h('div', { class: 'pequeno texto-ambar' }, `Capturado sin conexión a las ${fechaHora(a.hora_local)}`) : null);
  }

  function exportar() {
    if (!filas.length) return toast('No hay registros que exportar', 'error');
    const blob = crearXlsx([{
      nombre: 'Bitácora',
      titulo: ['Bitácora de inventario', `Generado: ${fechaHora(new Date())} por ${estado.perfil.nombre}`],
      columnas: [{ titulo: 'Fecha y hora (servidor)', ancho: 20 }, { titulo: 'Usuario', ancho: 18 }, { titulo: 'Acción', ancho: 24 }, { titulo: 'Resultado', ancho: 11 },
        { titulo: 'Evento', ancho: 22 }, { titulo: 'Artículo', ancho: 20 }, { titulo: 'Cambio', ancho: 40 }, { titulo: 'Motivo', ancho: 24 },
        { titulo: 'Detalle', ancho: 24 }, { titulo: 'Dispositivo', ancho: 18 }, { titulo: 'Hora en el celular', ancho: 20 }],
      filas: filas.map(a => [fechaHora(a.created_at), a.usuario_nombre, ACCIONES[a.accion] || a.accion, a.exito ? 'OK' : 'Rechazado',
        a.evento_nombre, a.variante_nombre, resumenCambio(a), a.motivo, a.detalle, a.dispositivo, fechaHora(a.hora_local)]),
    }]);
    const d = new Date();
    descargar(blob, `Bitacora_${d.toISOString().slice(0, 10)}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.xlsx`);
  }

  p.append(
    h('div', { class: 'fila-entre' }, h('h1', null, 'Bitácora'), h('button', { class: 'btn btn-sec', onclick: exportar }, icono('descarga', 18), 'Excel')),
    h('p', { class: 'tenue' }, esAdmin() ? 'Todo lo que se hizo en el sistema: quién, qué, cuándo y desde dónde. Nadie puede borrar ni editar estos registros.'
      : 'Tus propias acciones registradas en el sistema.'),
    h('details', { class: 'filtros-bit', open: window.innerWidth > 700 }, h('summary', null, 'Filtros'),
      h('div', { class: 'form-grid' },
        esAdmin() ? campo('Usuario', fUsuario) : null, campo('Evento', fEvento), campo('Acción', fAccion),
        campo('Desde', fDesde), campo('Hasta', fHasta),
        h('label', { class: 'check' }, fRech, 'Solo intentos rechazados')),
      h('button', { class: 'btn btn-pri', onclick: () => buscar() }, icono('buscar', 18), 'Buscar')),
    info, lista, mas);
  buscar();
}
