#!/usr/bin/env bash
# =========================================================================
# Prueba de autenticación REAL contra Supabase Auth.
#
# Levanta el mismo servidor de autenticación que usa Supabase en producción
# (GoTrue, https://github.com/supabase/auth) sobre un PostgreSQL local, y
# ejecuta contra él tests/auth-real.test.js con el cliente oficial
# @supabase/supabase-js. No hay mocks: las contraseñas se verifican de
# verdad, con bcrypt y JWT reales.
#
# Después usa el identificador del token emitido por GoTrue para comprobar
# que las políticas de RLS conceden y deniegan lo que deben.
#
# Requisitos: PostgreSQL 16, Go 1.21+, Node 18+.
# Uso:        SCRATCH=/ruta/de/trabajo bash tests/auth-real.sh
# =========================================================================
set -euo pipefail
SCRATCH="${SCRATCH:-/tmp/spartans-auth-real}"
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
PG_PUERTO=5433
GOTRUE_PUERTO=9999
SECRETO="secreto-de-pruebas-local-muy-largo-para-hs256-0123456789"
mkdir -p "$SCRATCH"

echo "▸ 1/5 Dependencias de Node"
cd "$SCRATCH"
[ -d node_modules/@supabase/supabase-js ] || npm install --silent --no-audit --no-fund \
  @supabase/supabase-js@2.45.4 jsonwebtoken

echo "▸ 2/5 PostgreSQL"
export PATH=/usr/lib/postgresql/16/bin:$PATH
id -u postgres >/dev/null 2>&1 || useradd postgres
if [ ! -d "$SCRATCH/pgdata/base" ]; then
  mkdir -p "$SCRATCH/pgdata"; chown postgres "$SCRATCH/pgdata"; chmod 700 "$SCRATCH/pgdata"
  su postgres -c "initdb -D $SCRATCH/pgdata -A trust -U postgres" >/dev/null
fi
su postgres -c "pg_ctl -D $SCRATCH/pgdata -o '-p $PG_PUERTO -k /tmp' -l $SCRATCH/pg.log start" >/dev/null 2>&1 || true
sleep 3

echo "▸ 3/5 GoTrue (Supabase Auth)"
if [ ! -x "$SCRATCH/bin/gotrue" ]; then
  git clone --depth 1 --branch v2.151.0 https://github.com/supabase/auth.git "$SCRATCH/auth-src" >/dev/null 2>&1
  (cd "$SCRATCH/auth-src" && PATH=/usr/local/go/bin:$PATH GOFLAGS=-mod=mod go build -o "$SCRATCH/bin/gotrue" .)
fi
psql -h /tmp -p $PG_PUERTO -U postgres -c "drop database if exists gotrue_test;" >/dev/null
psql -h /tmp -p $PG_PUERTO -U postgres -c "create database gotrue_test;" >/dev/null
psql -h /tmp -p $PG_PUERTO -U postgres -d gotrue_test -c "create schema auth;" >/dev/null

export GOTRUE_DB_DRIVER=postgres GOTRUE_DB_NAMESPACE=auth
export DATABASE_URL="postgres://postgres@127.0.0.1:$PG_PUERTO/gotrue_test?sslmode=disable&search_path=auth"
export GOTRUE_DB_DATABASE_URL="$DATABASE_URL"
export GOTRUE_JWT_SECRET="$SECRETO" GOTRUE_JWT_AUD=authenticated GOTRUE_JWT_EXP=3600
# En Supabase, auth.users.role vale 'authenticated' por omisión; el test lo
# fija tras crear la cuenta para reproducir ese comportamiento.
export GOTRUE_API_HOST=127.0.0.1 PORT=$GOTRUE_PUERTO
export API_EXTERNAL_URL="http://127.0.0.1:$GOTRUE_PUERTO" GOTRUE_SITE_URL=http://127.0.0.1:8000
export GOTRUE_DISABLE_SIGNUP=false GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_LOG_LEVEL=error
"$SCRATCH/bin/gotrue" migrate >/dev/null 2>&1
pkill -f "$SCRATCH/bin/gotrue serve" 2>/dev/null || true
("$SCRATCH/bin/gotrue" serve > "$SCRATCH/gotrue.log" 2>&1 &)
sleep 5
curl -sf "http://127.0.0.1:$GOTRUE_PUERTO/health" >/dev/null && echo "  GoTrue en marcha"

echo "▸ 4/5 Autenticación real (usuario, contraseña, sesiones)"
cd "$RAIZ"
SCRATCH="$SCRATCH" node tests/auth-real.test.js

echo "▸ 5/5 RLS con el identificador real del token"
UID_REAL="$(cat "$SCRATCH/uid-real.txt")"
psql -h /tmp -p $PG_PUERTO -U postgres -d postgres -q \
  -c "drop schema public cascade; create schema public; drop schema if exists auth cascade;" >/dev/null
psql -h /tmp -p $PG_PUERTO -U postgres -d postgres -q <<SQL >/dev/null
create schema auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as \$\$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; \$\$;
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end \$\$;
grant usage on schema auth to anon, authenticated;
SQL
psql -h /tmp -p $PG_PUERTO -U postgres -d postgres -q -f schema.sql >/dev/null
psql -h /tmp -p $PG_PUERTO -U postgres -d postgres -q \
  -c "insert into auth.users (id,email) values ('$UID_REAL','spartans8327@spartans8327.app');"
psql -h /tmp -p $PG_PUERTO -U postgres -d postgres -q -v uid="'$UID_REAL'" \
  -f tests/rls-usuario-real.sql 2>&1 | grep -E "^OK|NOTICE:  OK|FALLO" | sed 's/^psql.*NOTICE:  //'

pkill -f "$SCRATCH/bin/gotrue serve" 2>/dev/null || true
echo "▸ Listo."
