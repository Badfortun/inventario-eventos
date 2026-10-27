# Guía de instalación: Inventario de Eventos

Tiempo estimado: **unos 30 minutos**, una sola vez. Costo: **$0**.

La app se instala en los celulares desde Chrome, con su propio ícono, y todos comparten la misma información a través de Supabase.

> **Regla de oro:** en Supabase hay dos claves. La **anon/publishable** es pública y va en `config.js`. La **service_role/secret** NUNCA se pone en la app ni en GitHub.

---

## 1. Crear el proyecto en Supabase

Usa un proyecto **nuevo**. No reutilices `inventario-pruebas`, porque sus tablas son de la versión anterior. El plan gratis permite 2 proyectos: si ya tienes 2, borra `inventario-pruebas` en *Project Settings → General → Delete project* (solo tenía datos de prueba).

1. Entra a <https://supabase.com> → **New project**.
2. Nombre: `inventario`. Database password: genera una y **guárdala**. Región: la más cercana (por ejemplo, *East US*).
3. Espera 1 o 2 minutos a que termine de crearse.

## 2. Crear la base de datos

1. **SQL Editor → New query**.
2. Copia **todo** el contenido de `supabase/migrations/20261027000001_esquema.sql`, pégalo y presiona **Run**. Debe decir *Success*.
3. Repite con `20261027000002_funciones.sql`.
4. Repite con `20261027000003_seguridad_y_vistas.sql`.

Siempre en ese orden: 1, 2, 3.

## 3. Configurar el acceso de usuarios

En **Authentication → Sign In / Providers → Email**:
- **Confirm email: DESACTIVADO.** Los usuarios no usan correo real; tú los apruebas dentro de la app.
- *Allow new users to sign up*: **activado**. Quien se registra queda pendiente y no ve nada hasta que lo apruebas.

## 4. Copiar las claves públicas

En **Project Settings → API Keys** copia:
- **Project URL** (algo como `https://abcd.supabase.co`)
- **anon public** o **publishable key**

## 5. Subir el código a GitHub

1. En tu repositorio `inventario-eventos`, sube **todo el contenido** de esta carpeta, incluida la carpeta oculta `.github`. Puedes reemplazar lo que había: la versión anterior queda en el historial de GitHub.
   - Si tu computadora no muestra `.github`, usa **GitHub Desktop**.
2. Abre `web/config.js` en GitHub, toca el lápiz ✏️ y reemplaza la URL y la clave por las del Paso 4. Luego **Commit changes**.

## 6. Publicar

1. **Settings → Pages → Source: GitHub Actions**.
2. En la pestaña **Actions** espera a que "Publicar app web" quede en verde. Si no arranca sola, ábrela y presiona **Run workflow**.
3. Tu app queda en **`https://TU-USUARIO.github.io/inventario-eventos/`**.

## 7. Crear al administrador (¡de inmediato!)

**La primera cuenta que se registra queda como administrador.**

1. Abre la dirección de tu app → **¿Primera vez? Crear mi cuenta**.
2. Luego cada trabajador crea su cuenta desde su celular.
3. Tú entras a **Más → Usuarios y permisos**, los apruebas y les asignas un rol:

| Rol | Qué puede hacer |
|---|---|
| **Administrador** | Todo: artículos, eventos, autorizar traslados entre eventos, cerrar eventos, ajustes, bajas y usuarios |
| **Salidas** | Sacar material del Almacén a eventos y solicitar traslados entre eventos |
| **Recogidas** | Regresar material al Almacén o a Reparación, marcar escaneos pendientes y solicitar traslados entre eventos |
| **Solo lectura** | Consultar |

Una persona puede tener más de un rol (por ejemplo, Salidas y Recogidas).

## 8. Mantener Supabase activo (recomendado)

El plan gratis **pausa el proyecto si pasa una semana sin uso**, y entonces la app deja de funcionar hasta que lo reactives. Para evitarlo:

1. En GitHub: **Settings → Secrets and variables → Actions → New repository secret**. Crea dos:
   - `SUPABASE_URL` → tu Project URL
   - `SUPABASE_ANON_KEY` → tu clave anon/publishable
2. **Actions → Mantener Supabase activo → Run workflow** para probarlo. Debe quedar en verde y desde ahí corre sola cada día.

Si alguna vez se pausa, entra a Supabase y presiona **Restore project**.

## 9. Instalar en los celulares

- **Android (Chrome):** abre la dirección → menú ⋮ → **Instalar app** o **Agregar a pantalla principal**.
- **iPhone (Safari):** botón Compartir → **Agregar a inicio**.

## 10. Prueba con datos ficticios

Antes de cargar tu inventario real, prueba con 2 o 3 celulares:

1. Da de alta un artículo de prueba (por ejemplo, "PRUEBA-01", 20 piezas).
2. Crea dos eventos de prueba.
3. Saca 20 al Evento A, solicita mover 5 al Evento B y autoriza desde el administrador.
4. Regresa 15 del A y 4 del B (1 dañada).
5. Cierra el Evento B y verifica que aparezca 1 pieza perdida en ese evento.
6. Marca el material pendiente de escanear.
7. Exporta los reportes.

Lo que registres queda en la bitácora para siempre. Si quieres empezar limpio, crea otro proyecto de Supabase para el uso real y repite los pasos 2 a 4 y el 5.2.

---

## Cómo se usa (resumen)

- **Mover** (botón central): elige *Desde* y *Hacia*, las cantidades, y si la salida y la entrada se escanearon (y quién entregó al escaneador).
  - Almacén → Evento: **salida**.
  - Evento → Almacén: **regreso**. Las piezas dañadas van solas a Reparación.
  - Evento → Evento: **traslado**. Queda **por autorizar** hasta que el administrador lo aprueba.
- **Pendiente de escanear:** material que llegó al Almacén sin escanear. Cuando el escaneador termina, se marca aquí.
- **¿Dónde está?:** cuánto hay en cada evento, en Reparación y en el Almacén.
- **Cerrar evento:** lo que siga registrado en el evento se confirma como **pérdida de ese evento**.
- **Corregir:** cada movimiento tiene un botón **Corregir** (para quien lo registró o el administrador). No se borra nada; se agrega una corrección.

## Actualizar la app

Al cambiar archivos de `web/`, sube el número de `VERSION` en `web/sw.js` (`inv2-v2`, `inv2-v3`…). GitHub publica solo, y los celulares toman la versión nueva al abrir la app.

## Si aparece que una política ya existe

Si Supabase muestra `policy "perfiles_leer" for table "perfiles" already exists`, la migración de seguridad ya se ejecutó al menos parcialmente en ese proyecto. No vuelvas a ejecutar la migración 1 (esquema) sobre una base ya creada, porque contiene `CREATE TABLE` e índices que no están preparados para repetirse. La migración 2 usa `CREATE OR REPLACE FUNCTION` y puede volver a definir funciones, pero normalmente no hace falta repetirla.

La migración 3 de esta versión revisada elimina cada política con `DROP POLICY IF EXISTS` antes de crearla de nuevo. Si las tablas y funciones ya existen, puedes ejecutar **solo** `20261027000003_seguridad_y_vistas.sql` revisado para reconstruir las políticas y vistas. Hazlo únicamente en la base de datos de esta aplicación y revisa que no haya errores posteriores.

## Problemas comunes

| Síntoma | Solución |
|---|---|
| "Falta configurar" | Corrige `web/config.js` (Paso 5.2). |
| Al registrarse pide confirmar el correo | Desactiva **Confirm email** (Paso 3). |
| "Supabase rechazó el correo interno" | En `config.js` cambia `DOMINIO_USUARIOS` por otro dominio, por ejemplo `miempresa.com`. |
| Dice "Sin conexión" pero sí hay internet | El proyecto se pausó: en Supabase presiona **Restore project** y revisa el Paso 8. |
| Alguien olvidó su contraseña | Administrador → Usuarios → la persona → **Nueva contraseña**. |
| Los celulares no ven un cambio de la app | Sube `VERSION` en `web/sw.js`, y cierra y abre la app. |

## Límites de esta versión

- Se necesita **internet** para registrar y consultar.
- La app **no escanea**: el escaneo lo hace el escaneador externo con su programa, y la app registra si se escaneó y quién entregó el material.
- Los códigos son **por tipo de artículo**, no por pieza individual.
- No hay respaldo automático todavía. Supabase gratis guarda la información, pero conviene exportar el inventario a Excel de vez en cuando.
