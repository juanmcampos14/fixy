#!/usr/bin/env bash
# Regenera db/supabase-init.sql (migraciones + datos base) usando la base Docker local. Uso: bash scripts/build-supabase-init.sh
set -euo pipefail
docker exec fixy-db psql -U fixy -d postgres -qc "drop database if exists fixy_bundle" -c "create database fixy_bundle owner fixy" >/dev/null
URL=postgres://fixy:fixy_local_only@localhost:54329/fixy_bundle
DATABASE_URL=$URL npx tsx -e 'import("./scripts/migrate.ts").then(m=>m.migrate(process.env.DATABASE_URL,{quiet:true}))'
DATABASE_URL=$URL FILE_SIGNING_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx MOCK_WEBHOOK_SECRET=xxxxxxxxxxxxxxxxxxxx npx tsx -e 'import("./src/server/seed/base.ts").then(async m=>{const c=await import("./src/server/db/client.ts");await m.seedBase(c.sql());await c.sql().end()})'
OUT=db/supabase-init.sql
{
  echo "-- Fixy · Inicialización completa para Supabase (SQL Editor o API; UNA sola vez en un proyecto vacío)."
  echo "BEGIN;"
  echo "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());"
  for f in db/migrations/*.sql; do echo; echo "-- ===== $(basename "$f") ====="; cat "$f"; echo; echo "INSERT INTO schema_migrations (name) VALUES ('$(basename "$f")');"; done
  echo; echo "-- ===== Datos base ====="
  docker exec fixy-db pg_dump -U fixy -d fixy_bundle --data-only --inserts --column-inserts --on-conflict-do-nothing --no-owner \
    -t zones -t credential_types -t categories -t category_required_credentials -t services -t service_questions -t commission_rules -t platform_settings -t policy_documents \
    | grep -vE '^(SET|SELECT pg_catalog|--|\\|$)'
  echo "COMMIT;"
  echo "SELECT (SELECT count(*) FROM categories) AS categorias, (SELECT count(*) FROM zones) AS zonas, (SELECT count(*) FROM schema_migrations) AS migraciones;"
} > "$OUT"
docker exec fixy-db psql -U fixy -d postgres -qc "drop database fixy_bundle" >/dev/null
echo "✔ $OUT regenerado"
