#!/bin/sh
set -e

ensure_dev_dependencies() {
  # In docker-compose.local.yml we bind-mount ./backend -> /app and use an anonymous volume for /app/node_modules.
  # That volume can be empty on first run, so we need to install dependencies (including dev deps for tsx/prisma).
  if [ "${NODE_ENV:-}" = "development" ] || [ "${APP_START_SCRIPT:-}" = "dev" ]; then
    if [ ! -d node_modules ] || [ ! -f node_modules/.bin/prisma ] || [ ! -f node_modules/.bin/tsx ]; then
      echo "[backend] Installing npm dependencies (dev mode)..."
      npm ci --include=dev
    fi

    # If code is bind-mounted, generated Prisma client can be stale when schema changes.
    # Regenerate when the schema hash changes (keeps dev containers consistent without manual steps).
    schema_hash_file="node_modules/.prisma_schema.sha1"
    current_schema_hash=""
    if [ -f prisma/schema.prisma ]; then
      current_schema_hash="$(node -e "const fs=require('fs');const crypto=require('crypto');const p='prisma/schema.prisma';const b=fs.readFileSync(p);process.stdout.write(crypto.createHash('sha1').update(b).digest('hex'));" 2>/dev/null || true)"
    fi

    previous_schema_hash=""
    if [ -f "$schema_hash_file" ]; then
      previous_schema_hash="$(cat "$schema_hash_file" 2>/dev/null || true)"
    fi

    if [ -n "$current_schema_hash" ] && [ "$current_schema_hash" != "$previous_schema_hash" ]; then
      echo "[backend] Prisma schema changed; generating client..."
      npm run prisma:generate
      echo "$current_schema_hash" > "$schema_hash_file"
    elif [ ! -d src/generated/prisma ]; then
      echo "[backend] Prisma client missing; generating..."
      npm run prisma:generate
      if [ -n "$current_schema_hash" ]; then
        echo "$current_schema_hash" > "$schema_hash_file"
      fi
    fi
  fi
}

resolve_and_retry_migrations() {
  # Opt-in only: never auto-resolve unless explicitly configured.
  # Example:
  #   PRISMA_MIGRATE_RESOLVE_ON_FAIL=1
  #   PRISMA_MIGRATE_RESOLVE_ROLLED_BACK_NAMES=20260116063727_pagos
  #   PRISMA_MIGRATE_RESOLVE_APPLIED_NAMES=20260127140000_product_presentations
  # Legacy (single action for all names):
  #   PRISMA_MIGRATE_RESOLVE_ACTION=rolled-back   # or: applied
  #   PRISMA_MIGRATE_RESOLVE_NAMES=20260116063727_pagos
  if [ "${PRISMA_MIGRATE_RESOLVE_ON_FAIL:-}" != "1" ] && [ "${PRISMA_MIGRATE_RESOLVE_ON_FAIL:-}" != "true" ] && [ "${PRISMA_MIGRATE_RESOLVE_ON_FAIL:-}" != "TRUE" ]; then
    return 1
  fi

  applied_names="${PRISMA_MIGRATE_RESOLVE_APPLIED_NAMES:-}"
  rolled_back_names="${PRISMA_MIGRATE_RESOLVE_ROLLED_BACK_NAMES:-}"

  # Legacy fallback
  legacy_names="${PRISMA_MIGRATE_RESOLVE_NAMES:-}"
  legacy_action="${PRISMA_MIGRATE_RESOLVE_ACTION:-rolled-back}"

  if [ -z "$applied_names" ] && [ -z "$rolled_back_names" ] && [ -z "$legacy_names" ]; then
    echo "[backend] PRISMA_MIGRATE_RESOLVE_ON_FAIL está habilitado pero no hay nombres configurados."
    echo "[backend] Usa PRISMA_MIGRATE_RESOLVE_APPLIED_NAMES y/o PRISMA_MIGRATE_RESOLVE_ROLLED_BACK_NAMES (o el legacy PRISMA_MIGRATE_RESOLVE_NAMES)."
    return 1
  fi

  # Resolve applied list
  if [ -n "$applied_names" ]; then
    echo "[backend] Intentando resolver migraciones fallidas (action=applied): ${applied_names}"
    for name in $(echo "$applied_names" | tr ',' ' '); do
      [ -z "$name" ] && continue
      echo "[backend] prisma migrate resolve --applied $name"
      npx prisma migrate resolve --schema=prisma/schema.prisma --applied "$name"
    done
  fi

  # Resolve rolled-back list
  if [ -n "$rolled_back_names" ]; then
    echo "[backend] Intentando resolver migraciones fallidas (action=rolled-back): ${rolled_back_names}"
    for name in $(echo "$rolled_back_names" | tr ',' ' '); do
      [ -z "$name" ] && continue
      echo "[backend] prisma migrate resolve --rolled-back $name"
      npx prisma migrate resolve --schema=prisma/schema.prisma --rolled-back "$name"
    done
  fi

  # Legacy single-action list
  if [ -n "$legacy_names" ]; then
    if [ "$legacy_action" != "rolled-back" ] && [ "$legacy_action" != "applied" ]; then
      echo "[backend] PRISMA_MIGRATE_RESOLVE_ACTION inválido: '$legacy_action' (usa 'rolled-back' o 'applied')."
      return 1
    fi
    echo "[backend] Intentando resolver migraciones fallidas (legacy action=$legacy_action): ${legacy_names}"
    for name in $(echo "$legacy_names" | tr ',' ' '); do
      [ -z "$name" ] && continue
      echo "[backend] prisma migrate resolve --$legacy_action $name"
      npx prisma migrate resolve --schema=prisma/schema.prisma --$legacy_action "$name"
    done
  fi

  echo "[backend] Reintentando prisma migrate deploy..."
  npm run prisma:migrate
}

echo "[backend] Running prisma migrate deploy..."
ensure_dev_dependencies
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
  echo "[backend]   set PRISMA_MIGRATE_RESOLVE_ROLLED_BACK_NAMES=20260116063727_pagos"
  echo "[backend]   set PRISMA_MIGRATE_RESOLVE_APPLIED_NAMES=20260127140000_product_presentations"

  if resolve_and_retry_migrations; then
    migrate_code=0
  else
    exit "$migrate_code"
  fi
fi

if [ "${MIGRATE_ONLY:-}" = "1" ] || [ "${MIGRATE_ONLY:-}" = "true" ] || [ "${MIGRATE_ONLY:-}" = "TRUE" ]; then
  echo "[backend] MIGRATE_ONLY=1: exiting after migrations."
  exit 0
fi

if [ "${RUN_SEED:-}" = "1" ] || [ "${RUN_SEED:-}" = "true" ] || [ "${RUN_SEED:-}" = "TRUE" ]; then
  echo "[backend] Running prisma seed..."
  npm run seed
else
  echo "[backend] Seed skipped (set RUN_SEED=1 to enable)"
fi

echo "[backend] Starting server..."
start_script="${APP_START_SCRIPT:-start}"
echo "[backend] Starting server (npm run $start_script)..."
exec npm run "$start_script"
