#!/usr/bin/env bash
# Prueba 9: varias sesiones intentan consumir las últimas unidades AL MISMO TIEMPO.
# Prueba 8b: la misma operación (misma clave) llega por varias conexiones a la vez.
set -e
cd "$(dirname "$0")"
PSQL="psql -h ${PGHOST:-/tmp} -U ${PGUSER:-postgres} -X -q -t -A -d inv_pruebas"

echo "▶ 9. Concurrencia: 8 celulares piden 2 unidades cada uno de las últimas 5"

como() { echo "select set_config('request.jwt.claim.sub', (select id::text from pruebas.usuarios where alias='$1'), false); set role authenticated;"; }

read VAR EV < <($PSQL <<SQL | tail -1
$(como admin)
create temp table t as select
  (pruebas.rpc('guardar_variante', '{"nombre":"Bocina","sku":"BOC-01","existencia_inicial":5}')->>'id')::uuid v,
  (pruebas.rpc('guardar_evento', '{"nombre":"Feria","fecha":"2026-12-01"}')->>'id')::uuid e;
select pruebas.rpc('cambiar_estado_evento', jsonb_build_object('evento_id', e, 'estado', 'activo')) from t;
select v || ' ' || e from t;
SQL
)

# Una sesión "bloqueadora" retiene el candado de arranque para que todas salgan juntas
$PSQL -c "select pg_advisory_lock(777); select pg_sleep(2); select pg_advisory_unlock(777);" >/dev/null &
sleep 0.5
for i in $(seq 1 8); do
  $PSQL >"/tmp/conc_$i.out" 2>&1 <<SQL &
$(como sal)
select pg_advisory_lock_shared(777);
select pruebas.rpc('registrar_salida', jsonb_build_object('evento_id', '$EV', 'items',
  jsonb_build_array(jsonb_build_object('variante_id', '$VAR', 'cantidad', 2)), 'dispositivo', 'Celular $i'))->>'ok';
SQL
done
wait
OKS=$(grep -h -x true /tmp/conc_*.out | wc -l)
NOS=$(grep -h -x false /tmp/conc_*.out | wc -l)
EXIST=$($PSQL -c "select existencia from public.variantes where id = '$VAR'")
echo "  Exitosas: $OKS · Rechazadas: $NOS · Existencia final: $EXIST"
[ "$OKS" = "2" ] && [ "$NOS" = "6" ] && [ "$EXIST" = "1" ] \
  && echo "  ✔ Solo 2 salidas pasaron (4 unidades); nadie consumió unidades inexistentes" \
  || { echo "  ✘ FALLÓ la prueba de concurrencia"; exit 1; }

echo "▶ 8b. La misma operación llega 6 veces a la vez (reintentos sin conexión)"
KEY=$(cat /proc/sys/kernel/random/uuid)
$PSQL -c "select pg_advisory_lock(778); select pg_sleep(2); select pg_advisory_unlock(778);" >/dev/null &
sleep 0.5
for i in $(seq 1 6); do
  $PSQL >"/tmp/idem_$i.out" 2>&1 <<SQL &
$(como sal)
select pg_advisory_lock_shared(778);
select pruebas.rpc('registrar_salida', jsonb_build_object('evento_id', '$EV', 'items',
  jsonb_build_array(jsonb_build_object('variante_id', '$VAR', 'cantidad', 1))), '$KEY')->>'ok';
SQL
done
wait
MOVS=$($PSQL -c "select count(*) from public.movimientos where operacion_id = '$KEY'")
EXIST=$($PSQL -c "select existencia from public.variantes where id = '$VAR'")
ERRS=$(grep -l ERROR /tmp/idem_*.out 2>/dev/null | wc -l)
echo "  Movimientos creados: $MOVS · Existencia final: $EXIST · Errores: $ERRS"
[ "$MOVS" = "1" ] && [ "$EXIST" = "0" ] && [ "$ERRS" = "0" ] \
  && echo "  ✔ Una sola salida registrada; los demás envíos devolvieron el mismo resultado" \
  || { echo "  ✘ FALLÓ la prueba de idempotencia concurrente"; cat /tmp/idem_*.out; exit 1; }

BAD=$($PSQL -c "$(como admin) select count(*) from public.verificar_saldos();" | tail -1)
[ "$BAD" = "0" ] && echo "  ✔ Saldos consistentes con el historial después de la concurrencia" || { echo "  ✘ Saldos inconsistentes"; exit 1; }
rm -f /tmp/conc_*.out /tmp/idem_*.out
echo "✅ Pruebas de concurrencia pasaron"
