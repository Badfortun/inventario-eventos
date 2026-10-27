#!/usr/bin/env bash
# Crea una base limpia, aplica migraciones y corre las pruebas.
set -e
cd "$(dirname "$0")"
PSQL="psql -h ${PGHOST:-/tmp} -U ${PGUSER:-postgres} -X -q"
$PSQL -c "drop database if exists inv_pruebas" -c "create database inv_pruebas" >/dev/null 2>&1
for f in 00_shim_supabase.sql ../migrations/*.sql; do
  $PSQL -d inv_pruebas -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || { echo "Error en $f"; $PSQL -d inv_pruebas -v ON_ERROR_STOP=1 -f "$f"; exit 1; }
done
$PSQL -d inv_pruebas -o /dev/null -f 10_pruebas.sql 2>&1 | sed -e 's/^psql:[^:]*:[0-9]*: NOTICE:  //' -e 's/^NOTICE:  //'
bash 20_concurrencia.sh
