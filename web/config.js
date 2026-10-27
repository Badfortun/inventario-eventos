// =====================================================================
// CONFIGURACIÓN — lo único que hay que editar al instalar.
// Los valores están en Supabase → Project Settings → API.
// La "anon public key" es pública por diseño: sola no da acceso a nada;
// los permisos los aplica la base de datos. NUNCA pongas aquí la
// "service_role key".
// =====================================================================
export const CONFIG = {
  SUPABASE_URL: 'https://quybufbpcvrvtqrahush.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_NZg5m_ORtGcaGTPTflFxKA_h3vN-0b2',

  // Los usuarios entran con un nombre de usuario (ej. "pedro"). Por dentro
  // Supabase necesita un correo, así que se forma como pedro@<dominio>.
  // No se envían correos a esta dirección.
  DOMINIO_USUARIOS: 'inventario-eventos.app',

  // Minutos sin uso antes de pedir el PIN otra vez
  MINUTOS_BLOQUEO: 10,

  NOMBRE_APP: 'Inventario de Eventos',
};
