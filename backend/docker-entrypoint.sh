#!/bin/sh
set -e

resolve_and_retry_migrations() {
  # Opt-in only: never auto-resolve unless explicitly configured.
  # Example:
  #   PRISMA_MIGRATE_RESOLVE_ON_FAIL=1
  #   PRISMA_MIGRATE_RESOLVE_ACTION=rolled-back   # or: applied
  #   PRISMA_MIGRATE_RESOLVE_NAMES=20260116063727_pagos
  if [ "${PRISMA_MIGRATE_RESOLVE_ON_FAIL:-}" != "1" ] && [ "${PRISMA_MIGRATE_RESOLVE_ON_FAIL:-}" != "true" ] && [ "${PRISMA_MIGRATE_RESOLVE_ON_FAIL:-}" != "TRUE" ]; then
    return 1
  fi

  if [ -z "${PRISMA_MIGRATE_RESOLVE_NAMES:-}" ]; then
    echo "[backend] PRISMA_MIGRATE_RESOLVE_ON_FAIL está habilitado pero PRISMA_MIGRATE_RESOLVE_NAMES está vacío."
    return 1
  fi

  action="${PRISMA_MIGRATE_RESOLVE_ACTION:-rolled-back}"
  if [ "$action" != "rolled-back" ] && [ "$action" != "applied" ]; then
    echo "[backend] PRISMA_MIGRATE_RESOLVE_ACTION inválido: '$action' (usa 'rolled-back' o 'applied')."
    return 1
  fi

  echo "[backend] Intentando resolver migraciones fallidas (action=$action): ${PRISMA_MIGRATE_RESOLVE_NAMES}"

  # Split by comma or whitespace
  for name in $(echo "${PRISMA_MIGRATE_RESOLVE_NAMES}" | tr ',' ' '); do
    if [ -z "$name" ]; then
      continue
    fi
    echo "[backend] prisma migrate resolve --$action $name"
    npx prisma migrate resolve --schema=prisma/schema.prisma --$action "$name"
  done

  echo "[backend] Reintentando prisma migrate deploy..."
  npm run prisma:migrate
}

echo "[backend] Running prisma migrate deploy..."
set +e
npm run prisma:migrate
migrate_code=$?
set -e

if [ "$migrate_code" -ne 0 ]; then
  echo "[backend] prisma migrate deploy falló (exit=$migrate_code)."
  echo "[backend] Si el error es P3009 (failed migrations), primero debes resolver la migración fallida en la BD."
  echo "[backend] Opción A (recomendado, manual):"
  echo "[backend]   docker compose exec backend-farmasnt npx prisma migrate resolve --rolled-back 20260116063727_pagos"
  echo "[backend]   docker compose restart backend-farmasnt"
  echo "[backend] Opción B (automático, bajo tu responsabilidad):"
  echo "[backend]   set PRISMA_MIGRATE_RESOLVE_ON_FAIL=1"
  echo "[backend]   set PRISMA_MIGRATE_RESOLVE_NAMES=20260116063727_pagos"
  echo "[backend]   set PRISMA_MIGRATE_RESOLVE_ACTION=rolled-back"

  if resolve_and_retry_migrations; then
    migrate_code=0
  else
    exit "$migrate_code"
  fi
fi

if [ "${RUN_SEED:-}" = "1" ] || [ "${RUN_SEED:-}" = "true" ] || [ "${RUN_SEED:-}" = "TRUE" ]; then
  echo "[backend] Running prisma seed..."
  npm run seed
else
  echo "[backend] Seed skipped (set RUN_SEED=1 to enable)"
fi

echo "[backend] Starting server..."
exec npm run start
