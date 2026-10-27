// Entrar, registrarse, crear PIN y desbloquear
import { CONFIG } from '../../config.js';
import { entrar, registrarse, rpc, sesionActual, ErrorRed } from '../api.js';
import { directo } from '../cola.js';
import { h, toast, campo } from '../ui.js';

async function hashLocal(uid, pin) {
  const datos = new TextEncoder().encode(`${uid}:${pin}:inventario`);
  const d = await crypto.subtle.digest('SHA-256', datos);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function recordarPin(uid, pin) {
  try { localStorage.setItem(`inv.pin.${uid}`, await hashLocal(uid, pin)); } catch {}
}

export function render(app, alEntrar, errorInicial) {
  let modo = 'entrar';
  const usuario = h('input', { class: 'input', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true });
  const nombre = h('input', { class: 'input', autocomplete: 'name' });
  const pass = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
  const pass2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const error = h('div', { class: 'aviso aviso-error', role: 'alert', hidden: !errorInicial }, errorInicial || '');
  const btn = h('button', { class: 'btn btn-pri btn-grande', type: 'submit' }, 'Entrar');
  const cambiar = h('button', { class: 'btn-link', type: 'button' }, '¿Primera vez? Crear mi cuenta');
  const extras = h('div', { class: 'pila', hidden: true },
    campo('Tu nombre completo', nombre),
    campo('Repite la contraseña', pass2));

  cambiar.onclick = () => {
    modo = modo === 'entrar' ? 'registro' : 'entrar';
    extras.hidden = modo === 'entrar';
    btn.textContent = modo === 'entrar' ? 'Entrar' : 'Crear cuenta';
    cambiar.textContent = modo === 'entrar' ? '¿Primera vez? Crear mi cuenta' : 'Ya tengo cuenta';
    pass.autocomplete = modo === 'entrar' ? 'current-password' : 'new-password';
    error.hidden = true;
  };

  const form = h('form', { class: 'pila', onsubmit: async e => {
    e.preventDefault();
    error.hidden = true;
    const u = usuario.value.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(u) && !u.includes('@')) {
      error.textContent = 'El usuario debe tener de 3 a 30 letras o números, sin espacios ni acentos.';
      error.hidden = false; return;
    }
    if (modo === 'registro') {
      if (!nombre.value.trim()) { error.textContent = 'Escribe tu nombre.'; error.hidden = false; return; }
      if (pass.value.length < 8) { error.textContent = 'La contraseña debe tener al menos 8 caracteres.'; error.hidden = false; return; }
      if (pass.value !== pass2.value) { error.textContent = 'Las contraseñas no coinciden.'; error.hidden = false; return; }
    }
    btn.disabled = true;
    try {
      if (modo === 'entrar') await entrar(u, pass.value);
      else await registrarse(u, nombre.value, pass.value);
      await alEntrar({ nuevaSesion: true });
    } catch (err) {
      error.textContent = err instanceof ErrorRed ? 'Sin conexión. Para entrar se necesita internet.' : err.message;
      error.hidden = false;
      btn.disabled = false;
    }
  } },
    campo('Usuario', usuario),
    campo('Contraseña', pass),
    extras, error, btn, cambiar);

  app.replaceChildren(h('div', { class: 'acceso' }, h('div', { class: 'acceso-caja' },
    h('div', { class: 'acceso-marca', 'aria-hidden': 'true' }, h('img', { src: 'iconos/icono-192.png', alt: '' })),
    h('h1', null, CONFIG.NOMBRE_APP),
    h('p', { class: 'tenue' }, 'Cada persona entra con su propio usuario. Todo lo que registres queda a tu nombre.'),
    form)));
  setTimeout(() => usuario.focus(), 50);
}

function tecladoPin(alCompletar, { titulo, subtitulo }) {
  let valor = '';
  const puntos = h('div', { class: 'pin-puntos', 'aria-live': 'polite' });
  const pintar = () => {
    puntos.replaceChildren(...[0, 1, 2, 3, 4, 5].map(i => h('span', { class: `pin-punto ${i < valor.length ? 'lleno' : ''} ${i >= 4 ? 'opcional' : ''}` })));
    puntos.setAttribute('aria-label', `${valor.length} dígitos`);
  };
  const tecla = (t, accion, etiqueta) => h('button', { type: 'button', class: 'pin-tecla', 'aria-label': etiqueta || t, onclick: accion }, t);
  const ok = h('button', { type: 'button', class: 'pin-tecla pin-ok', disabled: true, onclick: () => listo() }, 'OK');
  const actualizar = () => { pintar(); ok.disabled = valor.length < 4; };
  const listo = () => { const v = valor; valor = ''; actualizar(); alCompletar(v); };
  const digito = d => () => { if (valor.length < 6) { valor += d; actualizar(); } };
  pintar();
  const caja = h('div', { class: 'pin' },
    h('h1', null, titulo), subtitulo ? h('p', { class: 'tenue' }, subtitulo) : null, puntos,
    h('div', { class: 'pin-teclado' },
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => tecla(String(n), digito(String(n)))),
      tecla('⌫', () => { valor = valor.slice(0, -1); actualizar(); }, 'Borrar'),
      tecla('0', digito('0')),
      ok));
  const teclas = e => {
    if (!caja.isConnected) return document.removeEventListener('keydown', teclas);
    if (/^\d$/.test(e.key)) digito(e.key)();
    else if (e.key === 'Backspace') { valor = valor.slice(0, -1); actualizar(); }
    else if (e.key === 'Enter' && valor.length >= 4) listo();
  };
  document.addEventListener('keydown', teclas);
  return caja;
}

export function crearPin(app, perfil, alListo) {
  let primero = null;
  const contenedor = h('div', { class: 'acceso-caja' });
  const paso1 = () => contenedor.replaceChildren(tecladoPin(v => { primero = v; paso2(); }, {
    titulo: 'Crea tu PIN', subtitulo: 'De 4 a 6 dígitos. Sirve para desbloquear la app y autorizar operaciones.' }));
  const paso2 = () => contenedor.replaceChildren(tecladoPin(async v => {
    if (v !== primero) { toast('Los PIN no coinciden, intenta de nuevo', 'error'); return paso1(); }
    try {
      const r = await directo('establecer_pin', { pin_nuevo: v });
      if (!r.ok) { toast(r.error, 'error'); return paso1(); }
      await recordarPin(perfil.id, v);
      toast('PIN guardado', 'ok');
      alListo();
    } catch (e) {
      toast(e instanceof ErrorRed ? 'Se necesita conexión para crear el PIN' : e.message, 'error');
      paso1();
    }
  }, { titulo: 'Confirma tu PIN' }));
  paso1();
  app.replaceChildren(h('div', { class: 'acceso' }, contenedor));
}

export function desbloquear(capa, perfil, alOk, alSalir) {
  let fallos = 0;
  const caja = h('div', { class: 'acceso-caja' });
  const intentar = async pin => {
    let ok = false;
    try {
      const r = await rpc('verificar_pin', { p_args: { pin } });
      ok = r.ok;
      if (ok) await recordarPin(perfil.id, pin);
    } catch (e) {
      if (!(e instanceof ErrorRed)) { toast(e.message, 'error'); return; }
      const guardado = localStorage.getItem(`inv.pin.${perfil.id}`);
      ok = !!guardado && guardado === await hashLocal(perfil.id, pin);
    }
    if (ok) return alOk();
    fallos++;
    if (fallos >= 5) { toast('Demasiados intentos. Vuelve a entrar con tu contraseña.', 'error'); return alSalir(); }
    toast(`PIN incorrecto (${fallos}/5)`, 'error');
  };
  caja.append(tecladoPin(intentar, { titulo: `Hola, ${perfil.nombre.split(' ')[0]}`, subtitulo: 'Escribe tu PIN para continuar' }),
    h('button', { class: 'btn-link', type: 'button', onclick: alSalir }, 'No soy yo · cambiar de usuario'));
  capa.replaceChildren(h('div', { class: 'acceso' }, caja));
  void sesionActual;
}
