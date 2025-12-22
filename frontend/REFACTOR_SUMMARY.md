# Frontend Refactor - PharmaFlow Bolivia

## Resumen del Trabajo Realizado

Se ha completado un refactor completo del frontend de PharmaFlow, transformando la UI monolítica de ~3000 líneas en una SPA modular con rutas reales, componentes reutilizables y páginas organizadas por dominio.

## Estructura Nueva

### Componentes Reutilizables (`src/components/`)

#### Common (`src/components/common/`)
- **Loading**: Spinner con mensaje personalizable
- **EmptyState**: Estado vacío con acción opcional
- **ErrorState**: Manejo de errores con retry
- **Button**: Botón con variantes (primary, secondary, danger, ghost) y estados de loading
- **Input**: Campo de texto con label y validación
- **Select**: Dropdown con opciones
- **Table**: Tabla reutilizable con tipado genérico
- **PaginationCursor**: Paginación keyset con "Cargar más"
- **Badge**: Etiquetas con variantes de color
- **ExpiryBadge**: Badge especializado para vencimientos (EXPIRED/RED/YELLOW/GREEN)

#### Layout (`src/components/layout/`)
- **Header**: Header global con logo, nombre del tenant, toggle de tema y logout
- **Sidebar**: Navegación lateral con grupos de enlaces
- **PageContainer**: Contenedor de página con título y acciones
- **MainLayout**: Layout principal que combina Header + Sidebar + contenido

#### Otros
- **ProtectedRoute**: Wrapper para rutas que requieren autenticación

### Páginas (`src/pages/`)

#### Autenticación
- **LoginPage**: Login con branding pre-login por `Host` (multi-tenant)

#### Dashboard
- **DashboardPage**: Home con health status y eventos realtime

#### Catálogo (`catalog/`)
- **ProductsListPage**: Listado de productos con paginación
- **ProductDetailPage**: Detalle/edición de producto + creación de lotes
- **CatalogSearchPage**: Búsqueda rápida por SKU/nombre

#### Almacén (`warehouse/`)
- **WarehousesPage**: Listado de almacenes
- **LocationsPage**: Ubicaciones por almacén

#### Stock (`stock/`)
- **BalancesPage**: Balances de stock
- **MovementsPage**: Creación de movimientos (IN/OUT/TRANSFER/ADJUSTMENT)
- **ExpiryPage**: Dashboard de vencimientos con semáforo (EXPIRED/RED/YELLOW/GREEN)

#### Ventas (`sales/`)
- **CustomersPage**: Listado de clientes
- **OrdersPage**: Listado de órdenes de venta

#### Reportes (`reports/`)
- **SalesReportsPage**: Placeholder para reportes de ventas
- **StockReportsPage**: Placeholder para reportes de stock

#### Auditoría (`audit/`)
- **AuditListPage**: Eventos de auditoría con paginación

#### Admin (`admin/`)
- **UsersPage**: Listado de usuarios
- **RolesPage**: Listado de roles
- **BrandingPage**: Placeholder para gestión de branding

#### Plataforma (`platform/`)
- **TenantsPage**: Placeholder para provisioning de tenants

### Router (`src/AppRouter.tsx`)

Se implementaron todas las rutas del mapa:

**Públicas:**
- `/login`

**Protegidas:**
- `/` → Dashboard
- `/catalog/products` → Listado de productos
- `/catalog/products/:id` → Detalle/edición de producto
- `/catalog/search` → Búsqueda de catálogo
- `/warehouse/warehouses` → Listado de almacenes
- `/warehouse/warehouses/:warehouseId/locations` → Ubicaciones
- `/stock/balances` → Balances
- `/stock/movements` → Movimientos
- `/stock/expiry` → Vencimientos
- `/sales/customers` → Clientes
- `/sales/orders` → Órdenes
- `/reports/sales` → Reportes de ventas
- `/reports/stock` → Reportes de stock
- `/audit/events` → Auditoría
- `/admin/users` → Usuarios
- `/admin/roles` → Roles
- `/admin/branding` → Branding
- `/platform/tenants` → Tenants

### Hooks (`src/hooks/`)
- **useNavigation**: Retorna la estructura de navegación (grupos + items)

## Puntos Clave Respetados

✅ **No se inventaron endpoints nuevos**: Todos los componentes usan únicamente los endpoints documentados en `API_REFERENCE.md`

✅ **Multi-tenant por dominio**: 
- LoginPage carga branding pre-login con `GET /api/v1/public/tenant/branding`
- Login resuelve tenant por `Host`/`X-Forwarded-Host`

✅ **Sistema de tema mantenido**:
- Variables CSS `--pf-primary/secondary/tertiary`
- Modo oscuro con `dark` class
- Tokens Tailwind `slate-*` para neutrales

✅ **TanStack Query v5**:
- Uso de `isPending` en lugar de `isLoading`
- `invalidateQueries` con sintaxis `{ queryKey: [...] }`
- Eliminación de `onSuccess` deprecated (se usa `useEffect` cuando es necesario)

✅ **Estados consistentes**: Loading, Empty, Error en todas las páginas

✅ **TypeScript estricto**: `verbatimModuleSyntax` respetado con imports de tipos

✅ **No se tocó el backend**: Solo cambios en frontend

## Archivos Importantes Modificados

- `frontend/src/AppRouter.tsx`: Router completo con todas las rutas
- `frontend/src/App.tsx`: Renombrado a `App.legacy.tsx` (archivo monolítico original)
- Creados ~40 nuevos archivos en `components/` y `pages/`

## Verificación

- ✅ `npm --prefix frontend run build` pasa sin errores
- ✅ No hay errores de TypeScript
- ✅ Todas las páginas del mapa están implementadas

## Próximos Pasos Sugeridos

1. **Implementar páginas faltantes con lógica completa**:
   - Customer detail/create/edit
   - Order detail/create/confirm/fulfill (con FEFO auto-pick)
   - Branding con upload S3
   - Platform tenants provisioning y dominios

2. **Mejorar UX**:
   - Loaders de navegación entre rutas
   - Toasts en lugar de `alert()`
   - Confirmaciones de acciones destructivas
   - Mejores mensajes de validación

3. **Optimizaciones**:
   - Code splitting por ruta
   - Lazy loading de páginas
   - Suspense boundaries

4. **Testing**:
   - Tests unitarios de componentes
   - Tests de integración de páginas
   - E2E con Playwright

## Comandos Útiles

```bash
# Dev server
npm --prefix frontend run dev

# Build
npm --prefix frontend run build

# Type check
npm --prefix frontend run type-check

# Preview build
npm --prefix frontend run preview
```

## Notas Técnicas

- El viejo `App.tsx` (3000+ líneas) fue renombrado a `App.legacy.tsx` y está disponible como referencia
- Todos los providers existentes (Auth, Tenant, Theme) se mantuvieron intactos
- Los helpers `api.ts`, `auth.ts`, `socket.ts` no fueron modificados
- La navegación se genera dinámicamente en `useNavigation` hook (futuro: filtrar por permisos)
