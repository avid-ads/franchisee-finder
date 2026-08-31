#!/bin/bash
set -e
pnpm install --frozen-lockfile
for migration in lib/db/migrations/*.sql; do
  psql "$DATABASE_URL" --set ON_ERROR_STOP=on --file "$migration"
done
pnpm --filter @workspace/db run push-force
