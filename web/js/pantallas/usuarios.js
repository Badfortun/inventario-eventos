import { leer } from '../api.js';
import { encolar, directo } from '../cola.js';
import { h, modal, toast, campo, ROLES, fechaHora, vacio, pedirAutorizacion } from '../ui.js';
import { estado, esAdmin, informar } from '../estado.js';
import { recargar } from '../app.js';

const DESCRIPCION_ROL = {
  admin: 'Todo: artículos, eventos, aprobar diferencias, ajustes, usuarios',
  salidas: 'Registrar salidas de material a eventos',
  recogidas: 'Registrar recogidas, terminar conteo y anotar diferencias',
  lectura: 'Solo consultar inventario, eventos y reportes',
};

export async function render(p) {
  if (!esAdmin()) { p.append(h('div', { class: 'aviso aviso-error' }, 'Solo el administrador gestiona usuarios.')); return; }
  const perfiles = await leer('perfiles', { order: 'activo.asc,nombre.asc' });
  const pendientes = perfiles.filter(u => !u.activo && !u.roles.length);
  const resto = perfiles.filter(u => !pendientes.includes(u));
  const tarjeta = u => h('li', null, h('button', { class: `lista-item ${u.activo ? '' : 'inactivo'}`, type: 'button', onclick: () => editar(u) },
    h('div', null,
      h('strong', null, u.nombre), h('span', { class: 'tenue' }, ` @${u.usuario}`), u.id === estado.perfil.id ? h('span', { class: 'tenue' }, ' (tú)') : null,
      h('div', { class: 'fila chips' }, u.roles.length ? u.roles.map(r => h('span', { class: `chip chip-${r === 'admin' ? 'morado' : r === 'lectura' ? 'gris' : 'azul'}` }, ROLES[r])) : h('span', { class: 'chip chip-ambar' }, 'Sin rol'))),
    h('span', { class: `chip ${u.activo ? 'chip-verde' : 'chip-gris'}` }, u.activo ? 'Activo' : (u.roles.length ? 'Desactivado' : 'Pendiente'))));

  p.append(
    h('h1', null, 'Usuarios y permisos'),
    h('div', { class: 'aviso' }, 'Para dar de alta a alguien: que abra la app en su celular y elija "Crear mi cuenta". Después aparece aquí como pendiente y tú le asignas su rol.'),
    pendientes.length ? [h('h2', { class: 'seccion' }, `Pendientes de aprobación (${pendientes.length})`), h('ul', { class: 'lista' }, pendientes.map(tarjeta))] : null,
    h('h2', { class: 'seccion' }, 'Usuarios'),
    resto.length ? h('ul', { class: 'lista' }, resto.map(tarjeta)) : vacio('Sin usuarios'),
    h('h2', { class: 'seccion' }, 'Qué puede hacer cada rol'),
    h('dl', { class: 'datos' }, Object.entries(ROLES).map(([k, t]) => h('div', { class: 'dato' }, h('dt', null, t), h('dd', null, DESCRIPCION_ROL[k])))));
}

async function editar(u) {
  const nombre = h('input', { class: 'input', value: u.nombre });
  const checks = Object.keys(ROLES).map(r => h('input', { type: 'checkbox', value: r, checked: u.roles.includes(r) }));
  const activo = h('input', { type: 'checkbox', checked: u.activo || !u.roles.length });
  const r = await modal({
    titulo: `${u.nombre} (@${u.usuario})`,
    contenido: h('div', { class: 'pila' },
      campo('Nombre visible', nombre),
      h('fieldset', { class: 'grupo' }, h('legend', null, 'Roles'),
        checks.map(c => h('label', { class: 'check' }, c, h('span', null, h('strong', null, ROLES[c.value]), h('small', { class: 'tenue bloque' }, DESCRIPCION_ROL[c.value]))))),
      h('label', { class: 'check' }, activo, 'Cuenta activa (puede entrar)'),
      h('p', { class: 'tenue pequeno' }, `Registrado el ${fechaHora(u.created_at)}. Una cuenta nunca se borra: se desactiva y su historial se conserva.`)),
    acciones: [
      { texto: 'Restablecer acceso', valor: 'reset' },
      { texto: 'Cancelar', valor: null },
      { texto: 'Guardar', clase: 'btn-pri', alHacer: async () => {
        const roles = checks.filter(c => c.checked).map(c => c.value);
        if (activo.checked && !roles.length) { toast('Elige al menos un rol', 'error'); return false; }
        const op = await encolar('actualizar_usuario', { usuario_id: u.id, nombre: nombre.value.trim(), roles, activo: activo.checked }, `Usuario ${u.usuario}`);
        if (!informar(op, 'Usuario actualizado')) return false;
        recargar();
        return 'ok';
      } }],
  });
  if (r === 'reset') restablecer(u);
}

async function restablecer(u) {
  const pass = h('input', { class: 'input', type: 'text', autocomplete: 'off', placeholder: 'Mínimo 8 caracteres (opcional)' });
  const borrarPin = h('input', { type: 'checkbox' });
  const datos = await modal({
    titulo: `Restablecer acceso de ${u.nombre}`,
    contenido: h('div', { class: 'pila' },
      campo('Nueva contraseña', pass, 'Déjala vacía si solo quieres borrar el PIN. Entrégasela en persona.'),
      h('label', { class: 'check' }, borrarPin, 'Borrar su PIN (lo creará de nuevo al entrar)')),
    acciones: [{ texto: 'Cancelar', valor: null }, { texto: 'Continuar', clase: 'btn-pri', alHacer: () => {
      if (!pass.value && !borrarPin.checked) { toast('No hay nada que restablecer', 'error'); return false; }
      if (pass.value && pass.value.length < 8) { toast('Mínimo 8 caracteres', 'error'); return false; }
      return { contrasena: pass.value || null, borrar_pin: borrarPin.checked };
    } }],
  });
  if (!datos) return;
  const a = await pedirAutorizacion({ titulo: 'Confirma con tu PIN', conMotivo: false });
  if (!a) return;
  try {
    const r = await directo('restablecer_acceso', { usuario_id: u.id, ...datos, pin: a.pin });
    if (!r.ok) return toast(r.error, 'error');
    toast('Acceso restablecido', 'ok');
  } catch (e) { toast(e.message, 'error'); }
}
