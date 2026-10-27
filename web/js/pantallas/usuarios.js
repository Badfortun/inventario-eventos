import { leer } from '../api.js';
import { h, modal, toast, campo, ROLES, fechaHora, vacio } from '../ui.js';
import { estado, esAdmin, ejecutar, informar } from '../estado.js';
import { recargar } from '../app.js';

const QUE_HACE = {
  admin: 'Todo: artículos, eventos, autorizar traslados entre eventos, cerrar eventos, ajustes, bajas y usuarios',
  salidas: 'Sacar material del Almacén a eventos y solicitar traslados entre eventos',
  recogidas: 'Regresar material al Almacén o a Reparación, marcar escaneos pendientes y solicitar traslados entre eventos',
  lectura: 'Solo consultar',
};

export async function render(p) {
  if (!esAdmin()) return p.append(h('div', { class: 'aviso aviso-error' }, 'Solo el administrador gestiona usuarios.'));
  const perfiles = await leer('perfiles', { order: 'activo.asc,nombre.asc' });
  const pend = perfiles.filter(u => !u.activo && !u.roles.length);
  const resto = perfiles.filter(u => !pend.includes(u));
  const fila = u => h('li', null, h('button', { type: 'button', class: `lista-item ${u.activo ? '' : 'inactivo'}`, onclick: () => editar(u) },
    h('div', null, h('strong', null, u.nombre), h('span', { class: 'tenue' }, ` @${u.usuario}`), u.id === estado.perfil.id ? h('span', { class: 'tenue' }, ' (tú)') : null,
      h('div', { class: 'fila chips' }, u.roles.length ? u.roles.map(r => h('span', { class: `chip chip-${r === 'admin' ? 'morado' : r === 'lectura' ? 'gris' : 'azul'}` }, ROLES[r])) : h('span', { class: 'chip chip-ambar' }, 'Sin rol'))),
    h('span', { class: `chip ${u.activo ? 'chip-verde' : 'chip-gris'}` }, u.activo ? 'Activo' : (u.roles.length ? 'Desactivado' : 'Pendiente'))));
  p.append(
    h('h1', null, 'Usuarios y permisos'),
    h('div', { class: 'aviso' }, 'Para dar de alta a alguien: que abra la app y elija "Crear mi cuenta". Aparecerá aquí como pendiente y tú le asignas su rol.'),
    pend.length ? [h('h2', { class: 'seccion' }, `Pendientes de aprobación (${pend.length})`), h('ul', { class: 'lista' }, pend.map(fila))] : null,
    h('h2', { class: 'seccion' }, 'Usuarios'), resto.length ? h('ul', { class: 'lista' }, resto.map(fila)) : vacio('Sin usuarios'),
    h('h2', { class: 'seccion' }, 'Qué puede hacer cada rol'),
    h('dl', { class: 'datos' }, Object.entries(ROLES).map(([k, t]) => h('div', { class: 'dato' }, h('dt', null, t), h('dd', null, QUE_HACE[k])))));
}

async function editar(u) {
  const nombre = h('input', { class: 'input', value: u.nombre });
  const checks = Object.keys(ROLES).map(r => h('input', { type: 'checkbox', value: r, checked: u.roles.includes(r) }));
  const activo = h('input', { type: 'checkbox', checked: u.activo || !u.roles.length });
  const r = await modal({ titulo: `${u.nombre} (@${u.usuario})`,
    contenido: h('div', { class: 'pila' }, campo('Nombre visible', nombre),
      h('fieldset', { class: 'grupo' }, h('legend', null, 'Roles'), checks.map(c => h('label', { class: 'check' }, c,
        h('span', null, h('strong', null, ROLES[c.value]), h('small', { class: 'tenue bloque' }, QUE_HACE[c.value]))))),
      h('label', { class: 'check' }, activo, 'Cuenta activa (puede entrar)'),
      h('p', { class: 'tenue pequeno' }, `Registrado el ${fechaHora(u.created_at)}. Una cuenta no se borra: se desactiva y su historial se conserva.`)),
    acciones: [{ texto: 'Nueva contraseña', valor: 'pass' }, { texto: 'Cancelar', valor: null }, { texto: 'Guardar', clase: 'btn-pri', alHacer: async () => {
      const roles = checks.filter(c => c.checked).map(c => c.value);
      if (activo.checked && !roles.length) { toast('Elige al menos un rol', 'error'); return false; }
      if (!informar(await ejecutar('actualizar_usuario', { usuario_id: u.id, nombre: nombre.value.trim(), roles, activo: activo.checked }), 'Usuario actualizado')) return false;
      recargar(); return 'ok';
    } }] });
  if (r === 'pass') {
    const pass = h('input', { class: 'input', type: 'text', autocomplete: 'off', placeholder: 'Mínimo 8 caracteres' });
    await modal({ titulo: `Nueva contraseña para ${u.nombre}`, contenido: h('div', { class: 'pila' }, campo('Contraseña', pass, 'Entrégasela en persona.')),
      acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', clase: 'btn-pri', alHacer: async () => {
        if (pass.value.length < 8) { toast('Mínimo 8 caracteres', 'error'); return false; }
        return informar(await ejecutar('restablecer_contrasena', { usuario_id: u.id, contrasena: pass.value }), 'Contraseña cambiada') || false;
      } }] });
  }
}
