# Inventario de Eventos

App instalable (PWA) para controlar el material de eventos desde varios celulares. Los datos se guardan en Supabase.

**Modelo:** el material siempre está en un **lugar**: Almacén, Reparación o un Evento. Todo cambio es un **movimiento** de un lugar a otro, con quién lo registró, si la salida y la entrada se escanearon y quién entregó al escaneador. Al cerrar un evento, lo que quedó ahí se registra como **pérdida de ese evento**.

👉 **Para instalar, sigue [GUIA_INSTALACION.md](GUIA_INSTALACION.md).**

```
web/                    La app (HTML + JavaScript, sin compilar)
  config.js             ← Lo único que se edita: URL y clave pública de Supabase
supabase/migrations/    Base de datos (ejecutar 1, 2 y 3 en orden)
supabase/tests/         Pruebas automáticas
.github/workflows/      Publicación, mantener Supabase activo, pruebas
dev/                    Servidor local de pruebas (no se publica)
```

## Reglas que garantiza el servidor

- No se mueve más de lo registrado en el origen. Excepción: en un regreso de un evento, lo que exceda se registra como **sobrante**.
- Dos celulares no pueden tomar las mismas piezas al mismo tiempo, porque se bloquea el artículo mientras se registra.
- Un doble toque o un reintento no duplica el movimiento: cada operación lleva su propia clave.
- Los traslados entre eventos quedan **por autorizar** hasta que el administrador los aprueba.
- El historial y la bitácora no se pueden borrar ni editar. Las existencias siempre cuadran con el historial (`verificar_saldos()`).
- Los permisos se revisan en la base de datos; desde la app las tablas solo se pueden leer.

## Pruebas

```
bash supabase/tests/correr_pruebas.sh      # requiere PostgreSQL local
node dev/servidor-pruebas.mjs 8081 inv2_dev # app completa sin Supabase
```
