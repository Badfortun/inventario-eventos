import { salir } from '../api.js';
import { directo, nombreDispositivo, estadoCola } from '../cola.js';
import { h, modal, toast, campo, ROLES, confirmar } from '../ui.js';
import { estado } from '../estado.js';
import { recordarPin } from './acceso.js';

export async function render(p) {
  const u = estado.perfil;
  const disp = h('input', { class: 'input', value: nombreDispositivo() });
  p.append(
    h('h1', null, 'Mi cuenta'),
    h('dl', { class: 'datos' },
      h('div', { class: 'dato' }, h('dt', null, 'Nombre'), h('dd', null, u.nombre)),
      h('div', { class: 'dato' }, h('dt', null, 'Usuario'), h('dd', null, u.usuario)),
      h('div', { class: 'dato' }, h('dt', null, 'Roles'), h('dd', null, u.roles.map(r => ROLES[r]).join(', ')))),
    h('h2', { class: 'seccion' }, 'Este dispositivo'),
    campo('Nombre del dispositivo (aparece en la bitácora)', disp),
    h('button', { class: 'btn btn-sec', onclick: () => {
      const v = disp.value.trim();
      if (!v) return toast('Escribe un nombre', 'error');
      try { localStorage.setItem('inv.dispositivo', v.slice(0, 60)); toast('Guardado', 'ok'); } catch {}
    } }, 'Guardar nombre'),
    h('h2', { class: 'seccion' }, 'Seguridad'),
    h('div', { class: 'fila acciones' },
      h('button', { class: 'btn btn-sec', onclick: cambiarPin }, 'Cambiar mi PIN'),
      h('button', { class: 'btn btn-peligro', onclick: cerrarSesion }, 'Cerrar sesión')),
    h('h2', { class: 'seccion' }, 'Instalar en el celular'),
    h('p', { class: 'tenue' }, 'Android (Chrome): menú ⋮ → "Agregar a pantalla principal" o "Instalar app". iPhone (Safari): botón Compartir → "Agregar a inicio".'));
}

async function cambiarPin() {
  const actual = h('input', { class: 'input input-pin', type: 'password', inputmode: 'numeric', maxlength: 6 });
  const nuevo = h('input', { class: 'input input-pin', type: 'password', inputmode: 'numeric', maxlength: 6 });
  const nuevo2 = h('input', { class: 'input input-pin', type: 'password', inputmode: 'numeric', maxlength: 6 });
  await modal({
    titulo: 'Cambiar PIN',
    contenido: h('div', { class: 'pila' }, campo('PIN actual', actual), campo('PIN nuevo (4 a 6 dígitos)', nuevo), campo('Repite el PIN nuevo', nuevo2)),
    acciones: [{ texto: 'Cancelar' }, { texto: 'Cambiar', clase: 'btn-pri', alHacer: async () => {
      if (!/^\d{4,6}$/.test(nuevo.value)) { toast('El PIN debe tener de 4 a 6 dígitos', 'error'); return false; }
      if (nuevo.value !== nuevo2.value) { toast('Los PIN nuevos no coinciden', 'error'); return false; }
      const r = await directo('establecer_pin', { pin_actual: actual.value, pin_nuevo: nuevo.value });
      if (!r.ok) { toast(r.error, 'error'); return false; }
      await recordarPin(estado.perfil.id, nuevo.value);
      toast('PIN cambiado', 'ok');
    } }],
  });
}

async function cerrarSesion() {
  const c = await estadoCola();
  const msg = c.pendientes
    ? `Hay ${c.pendientes} operación(es) sin enviar en este celular. Se enviarán cuando vuelvas a entrar con tu usuario. ¿Cerrar sesión?`
    : 'Tendrás que escribir tu usuario y contraseña para volver a entrar.';
  if (!(await confirmar('Cerrar sesión', msg, 'Cerrar sesión', 'btn-peligro'))) return;
  await salir();
  location.hash = '';
  location.reload();
}
