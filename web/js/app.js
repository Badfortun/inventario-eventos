// Arranque, sesión, bloqueo con PIN, navegación
import { CONFIG } from '../config.js';
import { leer, rpc, sesionActual, salir, configurado, ErrorRed } from './api.js';
import { iniciarSincronizacion, alCambiarCola, estadoCola, conCache, nombreDispositivo, uuid } from './cola.js';
import { h, icono, toast, $, hace } from './ui.js';
import { estado, esAdmin, puedeRecogidas, puedeVerBitacora } from './estado.js';
import * as acceso from './pantallas/acceso.js';

const RUTAS = [
  [/^\/?$|^\/inicio$/, () => import('./pantallas/inicio.js')],
  [/^\/inventario$/, () => import('./pantallas/inventario.js')],
  [/^\/articulo\/([\w-]+)$/, () => import('./pantallas/articulo.js')],
  [/^\/eventos$/, () => import('./pantallas/eventos.js')],
  [/^\/evento\/([\w-]+)$/, () => import('./pantallas/evento.js')],
  [/^\/evento\/([\w-]+)\/salida$/, () => import('./pantallas/salida.js')],
  [/^\/evento\/([\w-]+)\/recogida$/, () => import('./pantallas/recogida.js')],
  [/^\/evento\/([\w-]+)\/movimientos$/, () => import('./pantallas/movimientos.js')],
  [/^\/diferencias$/, () => import('./pantallas/diferencias.js')],
  [/^\/evento\/([\w-]+)\/diferencias$/, () => import('./pantallas/diferencias.js')],
  [/^\/bitacora$/, () => import('./pantallas/bitacora.js')],
  [/^\/usuarios$/, () => import('./pantallas/usuarios.js')],
  [/^\/reportes$/, () => import('./pantallas/reportes.js')],
  [/^\/cuenta$/, () => import('./pantallas/cuenta.js')],
  [/^\/cola$/, () => import('./pantallas/cola.js')],
  [/^\/mas$/, () => import('./pantallas/mas.js')],
];

const app = $('#app');

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
async function iniciar() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (!configurado()) return pantallaSinConfigurar();
  if (!sesionActual()) return acceso.render(app, entrarAlSistema);
  await entrarAlSistema({ nuevaSesion: false });
}

export async function entrarAlSistema({ nuevaSesion = true } = {}) {
  app.replaceChildren(h('div', { class: 'cargando-inicial' }, 'Cargando…'));
  let perfil;
  try {
    const uid = sesionActual().user_id;
    const { datos } = await conCache('perfil', () => leer('perfiles', { id: `eq.${uid}` }));
    perfil = datos[0];
  } catch (e) {
    if (!(e instanceof ErrorRed)) {
      await salir();
      return acceso.render(app, entrarAlSistema, e.message);
    }
    return pantallaError('Sin conexión y sin datos guardados en este celular. Conéctate para entrar por primera vez.');
  }
  estado.perfil = perfil;
  if (nuevaSesion) rpc('registrar_acceso', { p_args: { dispositivo: nombreDispositivo() } }).catch(() => {});

  if (!perfil || !perfil.activo || !perfil.roles?.length) return pantallaPendiente();

  // PIN obligatorio (para desbloquear la app y autorizar operaciones delicadas)
  let tienePin = localStorage.getItem(`inv.pin.${perfil.id}`);
  if (!tienePin) {
    try {
      const r = await rpc('verificar_pin', { p_args: { pin: '' } });
      tienePin = r.tiene_pin;
    } catch {}
  }
  if (!tienePin) return acceso.crearPin(app, perfil, () => montar());
  if (nuevaSesion) marcarActividad();
  montar();
}

// ---------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------
let indicador;
function montar() {
  indicador = h('button', { class: 'sync', type: 'button', onclick: () => (location.hash = '#/cola') });
  const nav = h('nav', { class: 'nav', 'aria-label': 'Principal' },
    enlaceNav('#/inicio', 'inicio', 'Inicio'),
    enlaceNav('#/inventario', 'inventario', 'Inventario'),
    enlaceNav('#/eventos', 'eventos', 'Eventos'),
    (esAdmin() || puedeRecogidas()) ? enlaceNav('#/diferencias', 'diferencias', 'Diferencias') : null,
    enlaceNav('#/mas', 'mas', 'Más'));
  app.replaceChildren(
    h('header', { class: 'barra' },
      h('div', { class: 'barra-titulo' }, h('strong', null, CONFIG.NOMBRE_APP),
        h('span', { class: 'barra-usuario' }, estado.perfil.nombre)),
      indicador),
    h('main', { id: 'contenido', tabindex: '-1' }),
    nav);
  alCambiarCola(pintarIndicador);
  estadoCola().then(pintarIndicador);
  iniciarSincronizacion();
  window.addEventListener('hashchange', navegar);
  navegar();
}

function enlaceNav(href, ic, texto) {
  return h('a', { href, class: 'nav-item', 'data-ruta': href.slice(1) }, icono(ic), h('span', null, texto));
}

function pintarIndicador(e) {
  if (!indicador) return;
  let clase = 'ok', texto = 'Sincronizado';
  if (!e.enLinea) { clase = 'off'; texto = e.pendientes ? `Sin señal · ${e.pendientes} pendiente${e.pendientes > 1 ? 's' : ''}` : 'Sin señal'; }
  else if (e.errores) { clase = 'error'; texto = `${e.errores} con error`; }
  else if (e.pendientes) { clase = 'pend'; texto = `Enviando ${e.pendientes}…`; }
  indicador.className = `sync sync-${clase}`;
  indicador.title = `Última sincronización: ${hace(e.ultimaSync)}`;
  indicador.replaceChildren(h('span', { class: 'sync-punto', 'aria-hidden': 'true' }), texto);
}

let renderId = 0;
async function navegar() {
  if (bloqueado) return;
  const ruta = location.hash.replace(/^#/, '') || '/inicio';
  const cont = $('#contenido');
  if (!cont) return;
  const seccion = /^\/(inventario|articulo)/.test(ruta) ? '/inventario'
    : /\/diferencias$/.test(ruta) ? '/diferencias'
    : /^\/evento/.test(ruta) ? '/eventos'
    : /^\/(bitacora|usuarios|reportes|cuenta|cola|mas)/.test(ruta) ? '/mas' : '/inicio';
  document.querySelectorAll('.nav-item').forEach(a => {
    a.classList.toggle('activo', a.dataset.ruta === seccion);
    if (a.dataset.ruta === seccion) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const id = ++renderId;
  for (const [re, cargar] of RUTAS) {
    const m = ruta.match(re);
    if (!m) continue;
    cont.replaceChildren(h('div', { class: 'cargando' }, h('span', { class: 'giro' }), 'Cargando…'));
    try {
      const mod = await cargar();
      if (id !== renderId) return;
      const pagina = h('div', { class: 'pagina' });
      // append tolerante: ignora null/false y aplana listas (las pantallas lo usan así)
      const anexar = pagina.append.bind(pagina);
      pagina.append = (...xs) => anexar(...xs.flat(Infinity).filter(x => x != null && x !== false));
      await mod.render(pagina, ...m.slice(1));
      if (id !== renderId) return;
      cont.replaceChildren(pagina);
      window.scrollTo(0, 0);
    } catch (e) {
      if (id !== renderId) return;
      console.error(e);
      cont.replaceChildren(h('div', { class: 'pagina' }, h('div', { class: 'aviso aviso-error' },
        e instanceof ErrorRed ? 'Sin conexión y sin datos guardados para esta pantalla.' : `Error: ${e.message}`),
        h('button', { class: 'btn btn-sec', onclick: navegar }, 'Reintentar')));
    }
    return;
  }
  location.hash = '#/inicio';
}
export const recargar = navegar;

// ---------------------------------------------------------------------
// Bloqueo por inactividad
// ---------------------------------------------------------------------
let bloqueado = false;
const LS_ACT = 'inv.actividad';
function marcarActividad() { try { localStorage.setItem(LS_ACT, String(Date.now())); } catch {} }
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { if (!bloqueado) marcarActividad(); }, { passive: true }));

function revisarBloqueo() {
  if (bloqueado || !estado.perfil?.activo || !$('#contenido')) return;
  const ultima = Number(localStorage.getItem(LS_ACT) || 0);
  if (Date.now() - ultima > CONFIG.MINUTOS_BLOQUEO * 60000) bloquear();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) revisarBloqueo(); });
setInterval(revisarBloqueo, 30000);

function bloquear() {
  bloqueado = true;
  const capa = h('div', { class: 'bloqueo' });
  document.body.append(capa);
  acceso.desbloquear(capa, estado.perfil, () => {
    bloqueado = false; marcarActividad(); capa.remove(); navegar();
  }, async () => { await salir(); location.reload(); });
}

// ---------------------------------------------------------------------
function pantallaPendiente() {
  app.replaceChildren(h('div', { class: 'acceso' }, h('div', { class: 'acceso-caja' },
    h('h1', null, 'Cuenta en espera'),
    h('p', null, `Hola ${estado.perfil?.nombre || ''}. Tu cuenta `, h('strong', null, `"${estado.perfil?.usuario || ''}"`),
      ' está registrada pero un administrador todavía no la aprueba ni le asigna un rol.'),
    h('p', { class: 'tenue' }, 'Avísale al administrador y vuelve a intentar.'),
    h('div', { class: 'fila' },
      h('button', { class: 'btn btn-pri', onclick: () => entrarAlSistema({ nuevaSesion: false }) }, 'Volver a revisar'),
      h('button', { class: 'btn btn-sec', onclick: async () => { await salir(); location.reload(); } }, 'Salir')))));
}

function pantallaError(msg) {
  app.replaceChildren(h('div', { class: 'acceso' }, h('div', { class: 'acceso-caja' },
    h('h1', null, 'No se pudo entrar'), h('p', null, msg),
    h('button', { class: 'btn btn-pri', onclick: () => location.reload() }, 'Reintentar'))));
}

function pantallaSinConfigurar() {
  app.replaceChildren(h('div', { class: 'acceso' }, h('div', { class: 'acceso-caja' },
    h('h1', null, 'Falta configurar'),
    h('p', null, 'Edita el archivo ', h('code', null, 'config.js'), ' con la URL y la "anon public key" de tu proyecto de Supabase (Project Settings → API).'))));
}

window.addEventListener('unhandledrejection', e => {
  if (e.reason instanceof ErrorRed) { toast('Sin conexión', 'aviso'); e.preventDefault(); }
});

iniciar();
export { uuid };
