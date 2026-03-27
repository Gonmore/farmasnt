# PharmaFlow Bolivia (farmaSNT)

MVP: **Almacén + Ventas B2B** · SaaS **multi-tenant** (row-level `tenantId`) con auditoría (GxP-friendly).

## Versión 2.0

Estado actual de la raíz del proyecto:
- Versión operativa objetivo: `2.0`.
- Incluye soporte **multi-marca / multi-empresa** con grupos de tenants, grants por usuario y cambio de empresa desde el menú de cuenta.
- El flujo de cambio de empresa ya contempla ida y vuelta entre tenant base y tenants cruzados.
- `deploy.sh` queda como mecanismo previsto para actualización manual de producción.

### Ajustes recientes al catálogo y documentos comerciales
- Cada producto ahora permite definir una abreviatura de unidad base configurable (`u`, `lt`, `ml`, `gr`, etc.) desde `/catalog/products`.
- La abreviatura se propaga a catálogo, cotizaciones, entregas y otras vistas operativas donde se renderiza la presentación.
- La exportación PDF de cotizaciones y notas de entrega ahora usa filas autoajustables para evitar solapamientos entre cantidad, descuento y totales.
- La migración Prisma `20260327120000_product_base_unit_abbreviation` ya fue aplicada y validada en Docker local.

### Novedades principales de la 2.0
- `TenantGroup` y `TenantGroupMember` para agrupar empresas relacionadas.
- `UserTenantAccess` para otorgar acceso cruzado por usuario.
- Endpoints platform para crear, listar y administrar grupos de empresas.
- Endpoints admin para asignar empresas disponibles a un usuario del tenant.
- Endpoint auth para `switch-tenant` con refresh de tokens y contexto activo correcto.
- Selector de empresa en frontend con marca activa visible y retorno al tenant principal.

### Checklist antes de desplegar a producción
- Migraciones Prisma incluidas en repositorio y probadas en local.
- Backend resolviendo contexto activo por JWT para multi-empresa.
- Frontend refrescando estado de auth/tenant al cambiar de empresa.
- `deploy.sh` construye imágenes versionadas, publica, corre migraciones y reinicia servicios remotos.
- Despliegue final: manual, ejecutando `bash deploy.sh` desde la raíz del repo.

### Estado para despliegue manual
- Backend y frontend sin errores de editor en los archivos tocados.
- La migración nueva ya quedó probada contra `postgres-local` usando `docker compose -f docker-compose.local.yml --profile tools run --rm backend-migrate`.
- El repositorio queda listo para que el deploy manual publique imágenes, ejecute migraciones remotas y reinicie servicios con `deploy.sh`.

## Funcionalidades clave (stock)
- Almacenes: listado + ubicaciones.
- Ver stock por almacén: lista de existencias (producto + lote + ubicación + cantidad).
- Mover existencias entre almacenes: desde el stock del almacén se genera un movimiento `TRANSFER` (origen por lote/ubicación, destino por ubicación).
- UX: cuando hay una única opción (ej. un solo almacén o un solo producto), se autoselecciona para evitar bloqueos en selects.

## Puertos
- Backend: `http://localhost:6000`
- Frontend: `http://localhost:6001`

## Requisitos
- Node.js (probado con Node 22)
- PostgreSQL local: `farmasnt` en `localhost:5432` (o Docker)

### PostgreSQL con Docker (opcional)
- Levantar Postgres: `docker compose up -d db`
- Parar: `docker compose down`

### S3-compatible (logos públicos) con Docker (opcional)
Para habilitar subida de archivos (Branding y **foto de producto**), el backend emite una URL firmada (presigned PUT) y el frontend sube el archivo directo al storage.

- Levantar MinIO: `docker compose up -d minio minio-init`
- Consola MinIO: `http://localhost:9001` (user/pass: `minioadmin` / `minioadmin`)
- Endpoint S3: `http://localhost:9000`
- Bucket dev creado automáticamente: `farmasnt-assets` (public download)

Ejemplo de env en `backend/.env`:
```dotenv
S3_ENDPOINT=http://127.0.0.1:9000
S3_REGION=us-east-1
S3_BUCKET=farmasnt-assets
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_PUBLIC_BASE_URL=http://127.0.0.1:9000/farmasnt-assets
S3_FORCE_PATH_STYLE=true
```

Notas
- Sin S3 configurado, el sistema funciona igual; solo se deshabilita el upload (logo/foto).

## Backend (Clean/Hex)
Ubicación: `backend/`

### Variables de entorno
- Ver ejemplo: `backend/.env.example`
- Local: `backend/.env` (ya configurado para tu Postgres local)

### Comandos
- Instalar deps: `npm --prefix backend i`
- Generar Prisma Client: `npm --prefix backend run prisma:generate`
- Migrar BD: `npm --prefix backend run prisma:migrate -- --name init`
- Seed demo: `npm --prefix backend run seed`
- Dev server: `npm --prefix backend run dev`

### Credenciales seed (por defecto)
- Email: `admin@demo.local`
- Password: `Admin123!`
- TenantId: `00000000-0000-0000-0000-000000000001`

## Frontend (Vite + React + Tailwind + TanStack Query)
Ubicación: `frontend/`

### Variables de entorno
- Ver ejemplo: `frontend/.env.example`

### Comandos
- Instalar deps: `npm --prefix frontend i`
- Dev server: `npm --prefix frontend run dev`

## Flujo real (Platform → Tenant) para probar

### 1) Migrar y seed
- Migrar: `npm --prefix backend run prisma:migrate:dev`
- Generar Prisma Client: `npm --prefix backend run prisma:generate`
- Seed platform admin: `npm --prefix backend run seed`

Por defecto el seed crea el tenant plataforma `00000000-0000-0000-0000-000000000001` y registra el dominio `farmacia.supernovatel.com` (env: `SEED_PLATFORM_DOMAIN`).

### 2) Probar local con dominios (recomendado)
Como el login ahora resuelve el tenant por `Host` (para soportar emails repetidos entre tenants y dominios por cliente), en local conviene usar el archivo `hosts`.

En Windows (como admin) editar:
`C:\Windows\System32\drivers\etc\hosts`

Agregar (ejemplo):
```
127.0.0.1 farmacia.supernovatel.com
127.0.0.1 farmacia.febsa.com
```

Luego abrir en el navegador:
- `http://farmacia.supernovatel.com:6001`

### 3) Platform provisioning
1) Login con el usuario seed (por defecto `admin@demo.local` / `Admin123!`).
2) Ir a `Administración` → tab `Tenants`.
3) Crear tenant (ej. nombre `Febsa`, sucursales `4`, admin `admin@febsa.com`).

### 4) Entrar como tenant admin
1) Abrir `http://farmacia.febsa.com:6001`
2) Login con `admin@febsa.com` y el password definido.
3) Ir a `Administración` → `Branding` y subir logo/colores (si S3 está configurado).

### 5) Crear usuarios del tenant
En `Administración` → `Usuarios` puedes crear usuarios con emails `@febsa.com` o `@gmail.com`; el aislamiento es por `tenantId` (la unicidad de email es por tenant).

## Endpoints iniciales
- Health: `GET /api/v1/health`
- Auth:
  - `POST /api/v1/auth/login`
  - `POST /api/v1/auth/refresh`
- Catalog (requiere JWT + permisos):
  - `GET /api/v1/catalog/search?q=...`

## Productos: foto + lotes con ingreso inicial
- Foto de producto:
  - `POST /api/v1/products/:id/photo-upload` → retorna `uploadUrl` (PUT) + `publicUrl` + `key`.
  - `PATCH /api/v1/products/:id` para guardar `photoUrl` + `photoKey`.
- Lote con ingreso inicial:
  - `POST /api/v1/products/:id/batches` acepta `initialStock` opcional.
  - Si viene `initialStock`, se crea un `StockMovement IN` y se actualiza `InventoryBalance`.

## Numeración operativa (V2 foundations)
- Los `StockMovement` ahora tienen:
  - `number`: string tipo `MS2025-1`
  - `numberYear`: int
- La secuencia es por tenant+año (tabla `TenantSequence`).

## Contratos / Docs
- Swagger UI: `GET /api/v1/docs`
- OpenAPI JSON: `GET /api/v1/openapi.json`

## Admin (multirol)
- `GET /api/v1/admin/permissions`
- `GET /api/v1/admin/roles`
- `POST /api/v1/admin/roles`
- `PUT /api/v1/admin/roles/:id/permissions`
- `GET /api/v1/admin/users`
- `POST /api/v1/admin/users`
- `PUT /api/v1/admin/users/:id/roles`

## Auditoría (GxP read-side)
- `GET /api/v1/audit/events` (filtros: `from`, `to`, `actorUserId`, `action`, `entityType`, `entityId`, `includePayload`)
- `GET /api/v1/audit/events/:id`

## Notas de cumplimiento
- `AuditEvent` es **append-only**: el backend instala triggers para bloquear `UPDATE`/`DELETE`.
- Esquema con `createdBy`, `updatedAt`, `version` para auditoría/optimistic locking.
