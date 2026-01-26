# PharmaFlow Backend

Backend de PharmaFlow Bolivia - SaaS multi-tenant para gestión farmacéutica.

## Desarrollo Local

### Prerrequisitos
- Node.js 18+
- PostgreSQL 15+
- Docker (opcional)

### Instalación
```bash
npm install
```

### Base de datos
```bash
# Crear base de datos
createdb pharmaflow_dev

# Ejecutar migraciones
npx prisma migrate dev

# Poblar con datos de prueba
npx prisma db seed
```

### Ejecutar
```bash
# Desarrollo
npm run dev

# Producción
npm run build
npm start
```

## Docker - Desarrollo Local

```bash
# Desde raíz del proyecto
docker-compose -f docker-compose.local.yml up --build

# Ejecutar seed dentro del contenedor
docker-compose -f docker-compose.local.yml exec backend npx prisma db seed
```

## Docker - Producción

### Construir imagen
```bash
docker build -f Dockerfile -t pharmaflow-backend:latest .
```

### Ejecutar seed en producción
```bash
docker run --rm \
  --env-file ../.env.production \
  --network pharmaflow_network \
  pharmaflow-backend:latest \
  npx prisma db seed
```

## Variables de entorno para Seed

El seed puede configurarse con estas variables:

- `SEED_TENANT_NAME`: Nombre del tenant demo (default: "Demo Pharma")
- `SEED_ADMIN_EMAIL`: Email del admin (default: "admin@demo.local")
- `SEED_ADMIN_PASSWORD`: Password del admin (default: "Admin123!")
- `SEED_PLATFORM_DOMAIN`: Dominio de la plataforma (default: "farmacia.supernovatel.com")

## Datos generados por el Seed

- **Platform Tenant**: Supernovatel con admin platform
- **Demo Tenant**: Tenant de prueba con datos completos
- **43 productos** con precios, costos y stock
- **315 órdenes de venta** históricas (Bs 169,169 total)
- **Movimientos de stock** completos
- **3 clientes, 3 almacenes**
- **Productos con stock bajo y próximos a vencer**

## API Documentation

- Swagger UI: `GET /api/v1/docs`
- OpenAPI JSON: `GET /api/v1/openapi.json`

Ver `../API_REFERENCE.md` para documentación completa.