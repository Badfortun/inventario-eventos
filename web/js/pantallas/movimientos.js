// Historial de movimientos con filtros (lugar, persona, escaneo, fechas)
import { leer } from '../api.js';
import { h, icono, vacio, campo, cargando, toast, fechaHora, descripcionVariante, TIPO_MOV, ESTADO_MOV } from '../ui.js';
import { estado } from '../estado.js';
import { recargar } from '../app.js';
import { tarjetaMovimiento, personas } from './componentes.js';
import { crearXlsx, descargar } from '../xlsx.js';

export async function render(p) {
  const [lugares, gente] = await Promise.all([leer('lugares', { select: 'id,nombre,tipo,fecha', order: 'tipo.asc,fecha.desc.nullsfirst' }), personas()]);
  const fLugar = h('select', { class: 'input' }, h('option', { value: '' }, 'Todos'), lugares.map(l => h('option', { value: l.id }, l.nombre)));
  const fPersona = h('select', { class: 'input' }, h('option', { value: '' }, 'Todas'), gente.map(g => h('option', { value: g.id }, g.nombre)));
  const fRol = h('select', { class: 'input' }, h('option', { value: 'cualquiera' }, 'Registró o escaneó'), h('option', { value: 'registro' }, 'Registró'),
    h('option', { value: 'salida' }, 'Entregó al escaneador (salida)'), h('option', { value: 'entrada' }, 'Entregó al escaneador (entrada)'));
  const fEsc = h('select', { class: 'input' }, h('option', { value: '' }, 'Todos'), h('option', { value: 'sin' }, 'Con algo sin escanear'));
  const fDesde = h('input', { class: 'input', type: 'date' });
  const fHasta = h('input', { class: 'input', type: 'date' });
  const lista = h('div', { class: 'pila' });
  const info = h('p', { class: 'tenue pequeno' });
  let filas = [];

  async function buscar() {
    lista.replaceChildren(cargando());
    const q = { order: 'created_at.desc', limit: 300 };
    if (fLugar.value) q.or = `(origen_id.eq.${fLugar.value},destino_id.eq.${fLugar.value})`;
    const per = fPersona.value;
    let personaLocal = null; // "registró o escaneó" junto con filtro de lugar: se filtra aquí
    if (per) {
      const campos = { registro: ['registrado_por'], salida: ['escaneo_salida_por'], entrada: ['escaneo_entrada_por'],
        cualquiera: ['registrado_por', 'escaneo_salida_por', 'escaneo_entrada_por'] }[fRol.value];
      if (campos.length === 1) q[campos[0]] = `eq.${per}`;
      else if (!q.or) q.or = `(${campos.map(c => `${c}.eq.${per}`).join(',')})`;
      else personaLocal = per;
    }
    const and = [];
    if (fDesde.value) and.push(`created_at.gte.${new Date(fDesde.value + 'T00:00:00').toISOString()}`);
    if (fHasta.value) and.push(`created_at.lte.${new Date(fHasta.value + 'T23:59:59').toISOString()}`);
    if (and.length) q.and = `(${and.join(',')})`;
    try {
      filas = await leer('v_movimientos', q);
      if (personaLocal) filas = filas.filter(m => [m.registrado_por, m.escaneo_salida_por, m.escaneo_entrada_por].includes(personaLocal));
      if (fEsc.value === 'sin') filas = filas.filter(m => m.escaneo_salida === 'sin_escaneo' || m.escaneo_entrada === 'sin_escaneo');
      info.textContent = `${filas.length} movimiento(s)${filas.length === 300 ? ' (se muestran los 300 más recientes)' : ''}`;
      lista.replaceChildren(...(filas.length ? filas.map(m => tarjetaMovimiento(m, { alCambiar: recargar })) : [vacio('Sin movimientos con estos filtros.')]));
    } catch (e) { lista.replaceChildren(h('div', { class: 'aviso aviso-error' }, e.message)); }
  }

  function exportar() {
    if (!filas.length) return toast('No hay movimientos que exportar', 'error');
    const renglones = filas.flatMap(m => (m.items || []).map(i => [fechaHora(m.created_at), TIPO_MOV[m.tipo], ESTADO_MOV[m.estado].texto,
      m.origen_nombre, m.destino_nombre, i.codigo, i.nombre, descripcionVariante(i), i.cantidad, i.danadas, i.sobrante,
      m.escaneo_salida === 'escaneado' ? 'Sí' : m.escaneo_salida ? 'No' : '', m.escaneo_salida_nombre,
      m.escaneo_entrada === 'escaneado' ? 'Sí' : m.escaneo_entrada ? 'No' : '', m.escaneo_entrada_nombre,
      m.registrado_nombre, m.autorizado_nombre, m.motivo || m.notas || m.rechazo_motivo]));
    const d = new Date();
    descargar(crearXlsx([{ nombre: 'Movimientos', titulo: ['Movimientos de inventario', `Generado ${fechaHora(d)} por ${estado.perfil.nombre}`],
      columnas: [{ titulo: 'Fecha', ancho: 18 }, { titulo: 'Tipo', ancho: 14 }, { titulo: 'Estado', ancho: 12 }, { titulo: 'Desde', ancho: 20 }, { titulo: 'Hacia', ancho: 20 },
        { titulo: 'Código', ancho: 12 }, { titulo: 'Artículo', ancho: 20 }, { titulo: 'Color / medida', ancho: 16 }, { titulo: 'Cantidad', tipo: 'n', ancho: 9 },
        { titulo: 'Dañadas', tipo: 'n', ancho: 9 }, { titulo: 'Sobrante', tipo: 'n', ancho: 9 }, { titulo: 'Salida escaneada', ancho: 9 }, { titulo: 'Entregó (salida)', ancho: 16 },
        { titulo: 'Entrada escaneada', ancho: 9 }, { titulo: 'Entregó (entrada)', ancho: 16 }, { titulo: 'Registró', ancho: 16 }, { titulo: 'Autorizó', ancho: 16 }, { titulo: 'Notas / motivo', ancho: 30 }],
      filas: renglones }]), `Movimientos_${d.toISOString().slice(0, 10)}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.xlsx`);
  }

  p.append(
    h('div', { class: 'fila-entre' }, h('h1', null, 'Movimientos'), h('button', { class: 'btn btn-sec', onclick: exportar }, icono('descarga', 18), 'Excel')),
    h('details', { class: 'filtros-bit', open: window.innerWidth > 700 }, h('summary', null, 'Filtros'),
      h('div', { class: 'form-grid' }, campo('Lugar', fLugar), campo('Persona', fPersona), campo('Qué hizo la persona', fRol), campo('Escaneo', fEsc), campo('Desde', fDesde), campo('Hasta', fHasta)),
      h('button', { class: 'btn btn-pri', onclick: buscar }, icono('buscar', 18), 'Buscar')),
    info, lista);
  buscar();
}
