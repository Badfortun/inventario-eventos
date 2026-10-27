import { salir } from '../api.js';
import { h, toast, campo, ROLES, confirmar } from '../ui.js';
import { estado, nombreDispositivo } from '../estado.js';

export async function render(p) {
  const u = estado.perfil;
  const disp = h('input', { class: 'input', value: nombreDispositivo() });
  p.append(
    h('h1', null, 'Mi cuenta'),
    h('dl', { class: 'datos' },
      h('div', { class: 'dato' }, h('dt', null, 'Nombre'), h('dd', null, u.nombre)),
      h('div', { class: 'dato' }, h('dt', null, 'Usuario'), h('dd', null, u.usuario)),
      h('div', { class: 'dato' }, h('dt', null, 'Roles'), h('dd', null, u.roles.map(r => ROLES[r]).join(', ')))),
    h('h2', { class: 'seccion' }, 'Este celular'),
    campo('Nombre del dispositivo (aparece en la bitácora)', disp),
    h('button', { class: 'btn btn-sec', onclick: () => { try { localStorage.setItem('inv2.dispositivo', disp.value.trim().slice(0, 60) || nombreDispositivo()); toast('Guardado', 'ok'); } catch {} } }, 'Guardar nombre'),
    h('h2', { class: 'seccion' }, 'Instalar en el celular'),
    h('p', { class: 'tenue' }, 'Android (Chrome): menú ⋮ → "Instalar app" o "Agregar a pantalla principal". iPhone (Safari): Compartir → "Agregar a inicio".'),
    h('h2', { class: 'seccion' }, 'Sesión'),
    h('button', { class: 'btn btn-peligro', onclick: async () => {
      if (!(await confirmar('Cerrar sesión', 'Tendrás que escribir tu usuario y contraseña para volver a entrar.', 'Cerrar sesión', 'btn-peligro'))) return;
      await salir(); location.hash = ''; location.reload();
    } }, 'Cerrar sesión'));
}
