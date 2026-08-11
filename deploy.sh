#!/bin/bash
set -euo pipefail
# --- CONFIGURACIÓN ---
USER_DOCKER="gonmore14"
SERVER_USER="home"
SERVER_IP="192.168.10.57"
SERVER_PATH="~/app-server/proyectos/farmasnt"
API_PROD="https://farmasnt.supernovatel.com"
VERSION=$(date +%Y%m%d%H%M)

echo "🏗️  1. Iniciando construcción de versión: $VERSION"

# Build & Push Backend
docker build -t $USER_DOCKER/backend-farmasnt:$VERSION ./backend
docker push $USER_DOCKER/backend-farmasnt:$VERSION

# Build & Push Frontend (Inyectando URL de producción)
docker build -t $USER_DOCKER/frontend-farmasnt:$VERSION \
  --build-arg VITE_API_BASE_URL=$API_PROD \
  ./frontend
docker push $USER_DOCKER/frontend-farmasnt:$VERSION

echo "🚀 2. Actualizando servidor remoto..."

ssh "$SERVER_USER@$SERVER_IP" "SERVER_PATH=$SERVER_PATH VERSION=$VERSION bash -s" << 'EOF'
  set -e
  cd "$SERVER_PATH"

  # NO "source" .env: docker env-files permiten espacios sin quotes (ej: SEED_TENANT_NAME=Demo Pharma)
  # que rompen el parser de shell. Solo leemos RUN_SEED_ON_DEPLOY de forma segura.
  RUN_SEED_ON_DEPLOY=0
  if [ -f .env ]; then
    value=$(grep -E '^RUN_SEED_ON_DEPLOY=' .env | tail -n 1 | cut -d= -f2- | tr -d '\r')
    if [ -n "${value:-}" ]; then
      RUN_SEED_ON_DEPLOY="$value"
    fi
  fi
  
  # Creamos o sobreescribimos el archivo de versión
  echo "APP_VERSION=$VERSION" > .env.version
  
  echo "📥 Descargando nuevas imágenes ($VERSION)..."
  # Le decimos a docker compose que use nuestro nuevo archivo de versión
  docker compose --env-file .env --env-file .env.version pull

  echo "🧬 Resolviendo migraciones fallidas conocidas (si las hay)..."
  # Las migraciones que fallan porque los cambios ya fueron aplicados manualmente en la BD.
  # Se marcan como 'applied' para que migrate deploy no intente re-aplicarlas.
  echo "  → 20260727130000_location_in_quote: resolviendo como 'applied' (si está fallida)..."
  docker compose --env-file .env --env-file .env.version --profile tools run --rm backend-migrate </dev/null \
    npx prisma migrate resolve --applied "20260727130000_location_in_quote" || true

  echo "🧬 Aplicando migraciones Prisma (si hay nuevas)..."
  docker compose --env-file .env --env-file .env.version --profile tools run --rm backend-migrate </dev/null
  
  echo "🔄 Reiniciando contenedores..."
  docker compose --env-file .env --env-file .env.version up -d

  if [ "${RUN_SEED_ON_DEPLOY:-0}" = "1" ] || [ "${RUN_SEED_ON_DEPLOY:-0}" = "true" ] || [ "${RUN_SEED_ON_DEPLOY:-0}" = "TRUE" ]; then
    echo "🌱 Ejecutando seed (tools profile)..."
    docker compose --env-file .env --env-file .env.version --profile tools run --rm backend-seed </dev/null
  else
    echo "🌱 Seed omitido (set RUN_SEED_ON_DEPLOY=1 para ejecutarlo)"
  fi
  
  echo "🧹 Limpiando imágenes antiguas..."
  docker image prune -f
EOF

echo "✅ 3. Despliegue exitoso de la versión $VERSION"