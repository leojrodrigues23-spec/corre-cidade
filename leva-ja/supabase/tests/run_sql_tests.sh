#!/usr/bin/env bash
# Sobe um Postgres 16 temporário, aplica as migrações e roda os testes de regras/RLS.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/.."
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
DATA="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
cleanup() { "${RUN[@]}" "$PGBIN/pg_ctl -D $DATA -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT
if [ "$(id -u)" = "0" ]; then
  chown -R postgres "$DATA"
  RUN=(su postgres -c)
else
  RUN=(bash -c)
fi
"${RUN[@]}" "$PGBIN/initdb -D $DATA -U postgres --auth=trust >/dev/null"
"${RUN[@]}" "$PGBIN/pg_ctl -D $DATA -o '-p $PORT -k /tmp -c listen_addresses=' -l $DATA/log.txt start >/dev/null"
sleep 1
PSQL=(psql -h /tmp -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -c "create database levaja"
"${PSQL[@]}" -d levaja -f "$HERE/auth_stub.sql"
for f in "$ROOT"/migrations/*.sql; do
  echo "→ aplicando $(basename "$f")"
  "${PSQL[@]}" -d levaja -f "$f"
done
echo "→ executando testes"
"${PSQL[@]}" -d levaja -f "$HERE/rules_test.sql" >/dev/null


echo "→ teste de concorrência: dois motoristas aceitando a MESMA corrida simultaneamente"
RACE_SQL="set role authenticated; select tests.login('%s'); select pg_sleep_until(date_trunc('second', now()) + interval '2 seconds'); select public.accept_ride((select v::uuid from tests.ctx where k='race_ride')) ->> 'accepted';"
OUT1="$(mktemp)"; OUT2="$(mktemp)"
"${PSQL[@]}" -d levaja -At -c "$(printf "$RACE_SQL" 00000000-0000-0000-0000-0000000000d1)" > "$OUT1" &
P1=$!
"${PSQL[@]}" -d levaja -At -c "$(printf "$RACE_SQL" 00000000-0000-0000-0000-0000000000d2)" > "$OUT2" &
P2=$!
wait $P1 $P2
R1="$(grep -E '^(true|false)$' "$OUT1" | tail -1)"; R2="$(grep -E '^(true|false)$' "$OUT2" | tail -1)"
echo "   D1 aceitou: $R1 | D2 aceitou: $R2"
ACCEPTED=$("${PSQL[@]}" -d levaja -At -c "select count(*) from public.ride_assignments where ride_id = (select v::uuid from tests.ctx where k='race_ride') and outcome='aceita'")
if [ "$ACCEPTED" != "1" ] || [ "$R1" = "$R2" ]; then echo "✘ concorrência: $ACCEPTED aceites"; exit 1; fi
echo "✔ exatamente um motorista ficou com a corrida"
echo "✔ testes SQL concluídos"
