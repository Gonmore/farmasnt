#!/bin/sh
set -e

echo "[backend] Running prisma migrate deploy..."
npm run prisma:migrate

if [ "${RUN_SEED:-}" = "1" ] || [ "${RUN_SEED:-}" = "true" ] || [ "${RUN_SEED:-}" = "TRUE" ]; then
  echo "[backend] Running prisma seed..."
  npm run seed
else
  echo "[backend] Seed skipped (set RUN_SEED=1 to enable)"
fi

echo "[backend] Starting server..."
exec npm run start
