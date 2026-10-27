// Arranque, sesión y navegación
import { CONFIG } from '../config.js';
import { leer, rpc, sesionActual, salir, configurado, ErrorRed, ErrorApi } from './api.js';
import { h, icono, toast, $ } from './ui.js';
import { estado, esAdmin, puedeMover, nombreDispositivo } from './estado.js';
import * as acceso from './pantallas/acceso.js';

const RUTAS = [
  [/^\/?$|^\/inicio$/, () => import('./pantallas/inicio.js')],
  [/^\/articulos$/, () => import('./pantallas/articulos.js')],
  [/^\/articulo\/([\w-]+)$/, () => import('./pantallas/articulo.js')],
  [/^\/donde$/, () => import('./pantallas/donde.js')],
  [/^\/eventos$/, () => import('./pantallas/eventos.js')],
  [/^\/lugar\/([\w-]+)$/, () => import('./pantallas/lugar.js')],
  [/^\/mover$/, () => import('./pantallas/mover.js')],
  [/^\/autorizaciones$/, () => import('./pantallas/autorizaciones.js')],
  [/^\/escaneo$/, () => import('./pantallas/escaneo.js')],
  [/^\/movimientos$/, () => import('./pantallas/movimientos.js')],
  [/^\/bitacora$/, () => import('./pantallas/bitacora.js')],
  [/^\/usuarios$/, () => import('./pantallas/usuarios.js')],
  [/^\/reportes$/, () => import('./pantallas/reportes.js')],
  [/^\/cuenta$/, () => import('./pantallas/cuenta.js')],
  [/^\/mas$/, () => import('./pantallas/mas.js')],
];

const app = $('#app');

async function iniciar() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!configurado()) return pantallaMensaje('Falta configurar',
    'Edita el archivo config.js con la URL y la clave pública (anon/publishable) de tu proyecto de Supabase.');
  if (!sesionActual()) return acceso.render(app, entrar);
  await entrar({ nueva: false });
}

export async function entrar({ nueva = true } = {}) {
  app.replaceChildren(h('div', { class: 'cargando-inicial' }, 'Cargando…'));
  try {
    const [perfil] = await leer('perfiles', { id: `eq.${sesionActual().user_id}` });
    estado.perfil = perfil;
    if (nueva) rpc('registrar_acceso', { p_args: { dispositivo: nombreDispositivo() } }).catch(() => {});
    if (!perfil?.activo || !perfil.roles?.length) return pantallaPendiente();
    const fijos = await leer('lugares', { tipo: 'neq.evento', select: 'id,tipo,nombre' });
    estado.lugaresFijos = Object.fromEntries(fijos.map(l => [l.tipo, l]));
  } catch (e) {
    if (e instanceof ErrorRed) return pantallaMensaje('Sin conexión', 'Para usar la app se necesita internet. Revisa tu conexión e inténtalo de nuevo.', true);
    await salir();
    return acceso.render(app, entrar, e instanceof ErrorApi ? e.message : String(e));
  }
  montar();
}

function montar() {
  const nav = h('nav', { class: 'nav', 'aria-label': 'Principal' },
    enlace('#/inicio', 'inicio', 'Inicio', '/inicio'),
    enlace('#/articulos', 'inventario', 'Artículos', '/articulos'),
    puedeMover() ? h('a', { href: '#/mover', class: 'nav-item nav-central', 'data-ruta': '/mover' },
      h('span', { class: 'nav-burbuja' }, icono('mover', 24)), h('span', null, 'Mover')) : null,
    enlace('#/eventos', 'eventos', 'Eventos', '/eventos'),
    enlace('#/mas', 'mas', 'Más', '/mas'));
  app.replaceChildren(
    h('header', { class: 'barra' },
      h('div', { class: 'barra-titulo' }, h('strong', null, CONFIG.NOMBRE_APP), h('span', { class: 'barra-usuario' }, estado.perfil.nombre)),
      h('button', { class: 'sync', type: 'button', title: 'Actualizar', onclick: () => navegar() }, icono('deshacer', 16), 'Actualizar')),
    h('main', { id: 'contenido', tabindex: '-1' }),
    nav);
  window.addEventListener('hashchange', navegar);
  navegar();
}

function enlace(href, ic, texto, ruta) {
  return h('a', { href, class: 'nav-item', 'data-ruta': ruta }, icono(ic), h('span', null, texto));
}

let renderId = 0;
async function navegar() {
  const cont = $('#contenido');
  if (!cont) return;
  const [ruta, qs] = (location.hash.replace(/^#/, '') || '/inicio').split('?');
  const seccion = /^\/(articulos|articulo|donde)/.test(ruta) ? '/articulos'
    : /^\/(eventos|lugar)/.test(ruta) ? '/eventos'
    : ruta === '/mover' ? '/mover'
    : /^\/(mas|autorizaciones|escaneo|movimientos|bitacora|usuarios|reportes|cuenta)/.test(ruta) ? '/mas' : '/inicio';
  document.querySelectorAll('.nav-item').forEach(a => {
    a.classList.toggle('activo', a.dataset.ruta === seccion);
    a.dataset.ruta === seccion ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
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
      const anexar = pagina.append.bind(pagina);
      pagina.append = (...xs) => anexar(...xs.flat(Infinity).filter(x => x != null && x !== false));
      await mod.render(pagina, ...m.slice(1), new URLSearchParams(qs || ''));
      if (id !== renderId) return;
      cont.replaceChildren(pagina);
      window.scrollTo(0, 0);
    } catch (e) {
      if (id !== renderId) return;
      console.error(e);
      cont.replaceChildren(h('div', { class: 'pagina' },
        h('div', { class: 'aviso aviso-error' }, e instanceof ErrorRed ? 'Sin conexión a internet.' : `Error: ${e.message}`),
        h('button', { class: 'btn btn-sec', onclick: navegar }, 'Reintentar')));
    }
    return;
  }
  location.hash = '#/inicio';
}
export const recargar = navegar;

function pantallaPendiente() {
  app.replaceChildren(h('div', { class: 'acceso' }, h('div', { class: 'acceso-caja' },
    h('h1', null, 'Cuenta en espera'),
    h('p', null, `Hola ${estado.perfil?.nombre || ''}. Tu cuenta `, h('strong', null, `"${estado.perfil?.usuario || ''}"`),
      ' ya está registrada, pero un administrador todavía no la aprueba ni le asigna un rol.'),
    h('p', { class: 'tenue' }, 'Avísale al administrador y vuelve a revisar.'),
    h('div', { class: 'fila' },
      h('button', { class: 'btn btn-pri', onclick: () => entrar({ nueva: false }) }, 'Volver a revisar'),
      h('button', { class: 'btn btn-sec', onclick: async () => { await salir(); location.reload(); } }, 'Salir')))));
}

function pantallaMensaje(titulo, msg, reintentar = false) {
  app.replaceChildren(h('div', { class: 'acceso' }, h('div', { class: 'acceso-caja' },
    h('h1', null, titulo), h('p', null, msg),
    reintentar ? h('button', { class: 'btn btn-pri', onclick: () => location.reload() }, 'Reintentar') : null)));
}

window.addEventListener('unhandledrejection', e => {
  if (e.reason instanceof ErrorRed) { toast('Sin conexión a internet', 'error'); e.preventDefault(); }
});

void esAdmin;
iniciar();
