import { leer } from '../api.js';
import { h, icono, fecha, vacio, ROLES } from '../ui.js';
import { estado, esAdmin, puedeSalidas, puedeRecogidas, puedeMover } from '../estado.js';
import { metrica } from './componentes.js';

export async function render(p) {
  const [lugares, pendientes] = await Promise.all([
    leer('v_lugares', { estado: 'eq.abierto', order: 'fecha.asc.nullsfirst' }),
    leer('movimientos', { estado: 'eq.por_autorizar', select: 'id,registrado_por' }),
  ]);
  const alm = lugares.find(l => l.tipo === 'almacen');
  const rep = lugares.find(l => l.tipo === 'reparacion');
  const eventos = lugares.filter(l => l.tipo === 'evento');
  const misPend = pendientes.filter(m => m.registrado_por === estado.perfil.id).length;

  const accion = (href, ic, titulo, sub, clase = '') => h('a', { class: `accion ${clase}`, href },
    h('span', { class: 'accion-icono' }, icono(ic, 26)), h('span', null, h('strong', null, titulo), sub ? h('small', null, sub) : null));

  p.append(
    h('div', { class: 'saludo' }, h('h1', null, `Hola, ${estado.perfil.nombre.split(' ')[0]}`),
      h('p', { class: 'tenue' }, estado.perfil.roles.map(r => ROLES[r]).join(' · '))),
    esAdmin() && pendientes.length ? h('a', { class: 'aviso aviso-aviso enlace-aviso', href: '#/autorizaciones' },
      h('strong', null, `${pendientes.length} traslado(s) entre eventos por autorizar`), ' · Revisar →') : null,
    !esAdmin() && misPend ? h('a', { class: 'aviso enlace-aviso', href: '#/autorizaciones' }, `Tienes ${misPend} traslado(s) esperando autorización →`) : null,
    puedeMover() ? h('div', { class: 'acciones-rapidas' },
      puedeSalidas() ? accion('#/mover?o=almacen', 'salida', 'Salida a evento', 'Del almacén a un evento', 'accion-azul') : null,
      puedeRecogidas() ? accion('#/mover?d=almacen', 'recogida', 'Regreso al almacén', 'De un evento al almacén', 'accion-verde') : null,
      accion('#/mover?entre=1', 'mover', 'Entre eventos', esAdmin() ? 'De un evento a otro' : 'Lo autoriza el administrador', 'accion-morado'),
      puedeRecogidas() ? accion('#/escaneo', 'codigo', 'Pendiente de escanear', `${alm?.sin_escanear || 0} pieza(s) en almacén`, alm?.sin_escanear ? 'accion-ambar' : '') : null) : null,
    h('div', { class: 'metricas' },
      metrica('En almacén', alm?.piezas), metrica('Sin escanear', alm?.sin_escanear, alm?.sin_escanear ? 'ambar' : null),
      metrica('En eventos', eventos.reduce((a, e) => a + e.piezas, 0)), metrica('Reparación', rep?.piezas)),
    h('div', { class: 'fila-entre' }, h('h2', { class: 'seccion' }, 'Eventos abiertos'), h('a', { href: '#/donde', class: 'btn btn-ter btn-chico' }, icono('mapa', 18), '¿Dónde está?')));

  if (!eventos.length) p.append(vacio('No hay eventos abiertos.', esAdmin() ? h('a', { class: 'btn btn-pri', href: '#/eventos' }, 'Crear evento') : null));
  for (const e of eventos) {
    p.append(h('a', { class: 'tarjeta tarjeta-enlace', href: `#/lugar/${e.id}` },
      h('div', { class: 'fila-entre' }, h('h3', null, e.nombre), e.por_autorizar ? h('span', { class: 'chip chip-ambar' }, `${e.por_autorizar} por autorizar`) : null),
      h('div', { class: 'tenue pequeno' }, fecha(e.fecha), e.fecha_fin && e.fecha_fin !== e.fecha ? ` al ${fecha(e.fecha_fin)}` : '', e.ubicacion ? ` · ${e.ubicacion}` : ''),
      h('div', { class: 'evento-piezas' }, h('strong', null, e.piezas), ` pieza(s) en el evento · ${e.articulos} artículo(s)`)));
  }
}
