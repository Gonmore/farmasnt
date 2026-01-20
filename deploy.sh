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
  
  # Reemplazo robusto: busca cualquier línea que contenga 'image:' y el nombre del repo
  # y reemplaza TODA la línea por la nueva imagen con la versión.
  sed -i "s|.*image:.*backend-farmasnt:.*|    image: $USER_DOCKER/backend-farmasnt:$VERSION|" docker-compose.yml
  sed -i "s|.*image:.*frontend-farmasnt:.*|    image: $USER_DOCKER/frontend-farmasnt:$VERSION|" docker-compose.yml
  
  echo "📥 Descargando nuevas imágenes ($VERSION)..."
  docker compose pull
  
  echo "🔄 Reiniciando contenedores..."
  docker compose up -d
  
  echo "🧹 Limpiando imágenes antiguas para liberar espacio..."
  docker image prune -f
EOF

echo "✅ 3. Despliegue exitoso de la versión $VERSION"