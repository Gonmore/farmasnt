#!/bin/bash
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

ssh $SERVER_USER@$SERVER_IP << EOF
  cd $SERVER_PATH
  set -e

  # Cargamos variables del servidor (para RUN_SEED_ON_DEPLOY y similares)
  if [ -f .env ]; then
    set -a
    . ./.env
    set +a
  fi
  
  # Creamos o sobreescribimos el archivo de versión
  echo "APP_VERSION=$VERSION" > .env.version
  
  echo "📥 Descargando nuevas imágenes ($VERSION)..."
  # Le decimos a docker compose que use nuestro nuevo archivo de versión
  docker compose --env-file .env --env-file .env.version pull

  echo "🧬 Aplicando migraciones Prisma (si hay nuevas)..."
  docker compose --env-file .env --env-file .env.version --profile tools run --rm backend-migrate
  
  echo "🔄 Reiniciando contenedores..."
  docker compose --env-file .env --env-file .env.version up -d

  if [ "${RUN_SEED_ON_DEPLOY:-0}" = "1" ]; then
    echo "🌱 Ejecutando seed (tools profile)..."
    docker compose --env-file .env --env-file .env.version --profile tools run --rm backend-seed
  else
    echo "🌱 Seed omitido (set RUN_SEED_ON_DEPLOY=1 para ejecutarlo)"
  fi
  
  echo "🧹 Limpiando imágenes antiguas..."
  docker image prune -f
EOF

echo "✅ 3. Despliegue exitoso de la versión $VERSION"