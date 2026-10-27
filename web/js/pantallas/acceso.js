// Entrar y crear cuenta
import { CONFIG } from '../../config.js';
import { entrar, registrarse, ErrorRed } from '../api.js';
import { h, campo } from '../ui.js';

export function render(app, alEntrar, errorInicial) {
  let modo = 'entrar';
  const usuario = h('input', { class: 'input', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' });
  const nombre = h('input', { class: 'input', autocomplete: 'name' });
  const pass = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const pass2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const error = h('div', { class: 'aviso aviso-error', role: 'alert', hidden: !errorInicial }, errorInicial || '');
  const btn = h('button', { class: 'btn btn-pri btn-grande', type: 'submit' }, 'Entrar');
  const extras = h('div', { class: 'pila', hidden: true }, campo('Tu nombre completo', nombre), campo('Repite la contraseña', pass2));
  const cambiar = h('button', { class: 'btn-link', type: 'button', onclick: () => {
    modo = modo === 'entrar' ? 'registro' : 'entrar';
    extras.hidden = modo === 'entrar';
    btn.textContent = modo === 'entrar' ? 'Entrar' : 'Crear cuenta';
    cambiar.textContent = modo === 'entrar' ? '¿Primera vez? Crear mi cuenta' : 'Ya tengo cuenta';
    error.hidden = true;
  } }, '¿Primera vez? Crear mi cuenta');
  const mostrarError = t => { error.textContent = t; error.hidden = false; };

  const form = h('form', { class: 'pila', onsubmit: async e => {
    e.preventDefault();
    error.hidden = true;
    const u = usuario.value.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(u) && !u.includes('@')) return mostrarError('El usuario debe tener de 3 a 30 letras o números, sin espacios ni acentos.');
    if (modo === 'registro') {
      if (!nombre.value.trim()) return mostrarError('Escribe tu nombre.');
      if (pass.value.length < 8) return mostrarError('La contraseña debe tener al menos 8 caracteres.');
      if (pass.value !== pass2.value) return mostrarError('Las contraseñas no coinciden.');
    }
    btn.disabled = true;
    try {
      if (modo === 'entrar') await entrar(u, pass.value);
      else await registrarse(u, nombre.value, pass.value);
      await alEntrar({ nueva: true });
    } catch (err) {
      mostrarError(err instanceof ErrorRed ? 'Sin conexión a internet.' : err.message);
      btn.disabled = false;
    }
  } }, campo('Usuario', usuario), campo('Contraseña', pass), extras, error, btn, cambiar);

  app.replaceChildren(h('div', { class: 'acceso' }, h('div', { class: 'acceso-caja' },
    h('div', { class: 'acceso-marca', 'aria-hidden': 'true' }, h('img', { src: 'iconos/icono-192.png', alt: '' })),
    h('h1', null, CONFIG.NOMBRE_APP),
    h('p', { class: 'tenue' }, 'Cada persona entra con su propio usuario. Todo lo que registres queda a tu nombre.'),
    form)));
  setTimeout(() => usuario.focus(), 50);
}
