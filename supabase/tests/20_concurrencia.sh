#!/usr/bin/env bash
# 8 celulares intentan sacar 2 piezas cada uno de las últimas 5 AL MISMO TIEMPO,
# y la misma operación llega 6 veces a la vez.
set -e
cd "$(dirname "$0")"
PSQL="psql -h ${PGHOST:-/tmp} -U ${PGUSER:-postgres} -X -q -t -A -d inv_pruebas"
TMP=$(mktemp -d)
como() { echo "select set_config('request.jwt.claim.sub', (select id::text from pruebas.u where alias='$1'), false); set role authenticated;"; }

echo "▶ Concurrencia: 8 celulares piden 2 piezas de las últimas 5"
read ART EV ALM < <($PSQL <<SQL | tail -1
$(como admin)
create temp table t as select
  (pruebas.rpc('guardar_articulo', '{"codigo":"BOC-01","nombre":"Bocina","cantidad_inicial":5,"escaneo_inicial":"escaneado"}')->>'id')::uuid a,
  (pruebas.rpc('guardar_evento', '{"nombre":"Feria","fecha":"2026-12-01"}')->>'id')::uuid e;
select a || ' ' || e || ' ' || (select id from public.lugares where tipo = 'almacen') from t;
SQL
)
lote() { echo "select pruebas.rpc('registrar_movimiento', jsonb_build_object('origen_id','$ALM','destino_id','$EV','escaneo_salida','escaneado','escaneo_entrada','sin_escaneo','items', jsonb_build_array(jsonb_build_object('articulo_id','$ART','cantidad',$1)))$2)->>'ok';"; }

$PSQL -c "select pg_advisory_lock(901); select pg_sleep(2); select pg_advisory_unlock(901);" >/dev/null &
sleep 0.5
for i in $(seq 1 8); do
  printf '%s\nselect pg_advisory_lock_shared(901);\n%s\n' "$(como sal)" "$(lote 2 '')" | $PSQL >"$TMP/c$i" 2>&1 &
done
wait
OK=$(grep -h -x true "$TMP"/c* | wc -l); NO=$(grep -h -x false "$TMP"/c* | wc -l)
QUEDA=$($PSQL -c "select cantidad from public.existencias where lugar_id='$ALM' and articulo_id='$ART'")
echo "  Exitosas: $OK · Rechazadas: $NO · Quedan en Almacén: $QUEDA"
[ "$OK" = 2 ] && [ "$NO" = 6 ] && [ "$QUEDA" = 1 ] && echo "  ✔ Solo pasaron 2 (4 piezas); nadie tomó piezas inexistentes" || { echo "  ✘ FALLÓ concurrencia"; cat "$TMP"/c*; exit 1; }

echo "▶ La misma operación llega 6 veces a la vez"
KEY=$(cat /proc/sys/kernel/random/uuid)
$PSQL -c "select pg_advisory_lock(902); select pg_sleep(2); select pg_advisory_unlock(902);" >/dev/null &
sleep 0.5
for i in $(seq 1 6); do
  printf '%s\nselect pg_advisory_lock_shared(902);\n%s\n' "$(como sal)" "$(lote 1 ", '$KEY'::uuid")" | $PSQL >"$TMP/i$i" 2>&1 &
done
wait
N=$($PSQL -c "select count(*) from public.movimientos where operacion_id='$KEY'")
QUEDA=$($PSQL -c "select cantidad from public.existencias where lugar_id='$ALM' and articulo_id='$ART'")
ERR=$(grep -l ERROR "$TMP"/i* 2>/dev/null | wc -l)
echo "  Movimientos: $N · Quedan: $QUEDA · Errores: $ERR"
[ "$N" = 1 ] && [ "$QUEDA" = 0 ] && [ "$ERR" = 0 ] && echo "  ✔ Se registró una sola vez" || { echo "  ✘ FALLÓ idempotencia concurrente"; cat "$TMP"/i*; exit 1; }

BAD=$($PSQL -c "$(como admin) select count(*) from public.verificar_saldos();" | tail -1)
[ "$BAD" = 0 ] && echo "  ✔ Existencias cuadran con el historial" || { echo "  ✘ Existencias no cuadran"; exit 1; }
rm -rf "$TMP"
echo "✅ Pruebas de concurrencia pasaron"
