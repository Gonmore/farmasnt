# Multi-department Service for Sales Branches

## Goal
Allow a sales warehouse (branch) to serve customers from multiple cities/departments, not just its own city. Example: SUC-LPZ (primary city: LA PAZ) can be configured to also serve ORURO and POTOSÍ. All quote, order, customer, and stock flows are scoped to the user's warehouse, and batch/lot selection only shows stock from that warehouse.

## Context

### Current architecture
- `branchCityOf(request)` in each route file returns a **single** city string (the user's `warehouse.city`).
- All queries (customers, quotes, orders, payments, reports) filter by `city = branchCity` (single equality).
- Quote creation validates `customer.city === branchCity`.
- `available-batches` endpoint filters inventory by `warehouse.city = customer.city`.
- Sub-warehouse selection (`GET /api/v1/sales/quotes/sub-warehouses`) already filters by `warehouseId` — correct, no change needed.

### Key files
- **Schema**: `backend/prisma/schema.prisma` (Warehouse model, line ~502)
- **Auth**: `backend/src/adapters/http/server.ts:152-160` (populates `request.auth`)
- **RBAC**: `backend/src/application/security/rbac.ts` (AuthContext type, line 7-15)
- **Routes using `branchCityOf`**: `customers.ts`, `salesQuotes.ts`, `salesOrders.ts`, `salesPayments.ts`, `stock.ts`, `notifications.ts`, `reports.ts`
- **Frontend**: `frontend/src/hooks/usePermissions.ts`, `frontend/src/pages/warehouse/WarehattendsPage.tsx`, `frontend/src/pages/sales/QuotesPage.tsx`, `frontend/src/pages/sales/QuoteDetailPage.tsx`, `frontend/src/pages/catalog/SellerCatalogPage.tsx`, `frontend/src/pages/sales/OrdersPage.tsx`
- **OpenAPI**: `backend/src/adapters/http/openapi.ts` (if API docs need updating)

## Design Decisions

### D1: Data model — new join table
Add `WarehouseServedCity` model with a unique constraint preventing the same city from being assigned to multiple warehouses in the same tenant.

```prisma
model WarehouseServedCity {
  id          String   @id @default(uuid())
  tenantId    String
  warehouse   Warehouse @relation(fields: [warehouseId], references: [id], onDelete: Cascade)
  warehouseId String
  city        String
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([tenantId, warehouseId, city])
  @@unique([tenantId, city])          // A city can only be served by ONE warehouse per tenant
  @@index([tenantId, city])
}
```
Also add the inverse relation `servedCities WarehouseServedCity[]` on the `Warehouse` model.

### D2: Auth context — array of cities
Add `warehouseCities: string[]` to `AuthContext` (rbac.ts). Populated in `server.ts` by querying `WarehouseServedCity` for the user's warehouse. The user's warehouse primary `city` is always included in this array (it's the warehouse's own city). PROVIDER users get `null` (no city filter, same as today).

### D3: Shared helper — `branchCitiesOf(request)`
Instead of duplicating `branchCityOf` in 7 route files, create a shared helper in a new file `backend/src/application/security/branch.ts` that returns `string[] | null`. Each route file replaces its local `branchCityOf` with an import + wrapper that returns the array. The `'__MISSING__'` sentinel pattern is replaced: if a branch-scoped user has no cities loaded, return `null` and the endpoint checks separately.

### D4: Query filter changes
All `city: { equals: branchCity }` patterns become `city: { in: branchCities }` (array IN). The `OR` filters using `deliveryCity` and `customer.city` need the `in` operator.

### D5: Customer/quote creation validation
Instead of `custCity !== branchCity`, check `custCity not in branchCities`. If the customer is from a city NOT served by the user's warehouse, return 403.

### D6: Available-batches endpoint
Change from filtering by `warehouse.city = customer.city` to filtering by `warehouse.id = request.auth.warehouseId` (or the quote's `locationId`'s warehouse, if it belongs to the user's warehouse). This ensures batches are always from the user's warehouse.

### D7: Frontend `usePermissions`
Add `warehouseCities: string[]` to the `UserInfo`/`AuthMeResponse` types. The `/api/v1/auth/me` endpoint returns this array.

### D8: Frontend WarehousesPage
Add a "Departamentos atendidos" column to the warehouse table (comma-separated list of served cities). Add inline editing or a modal to manage served cities per warehouse. Use `CitySelector` for adding cities (autocomplete). Include validation: city must not already be served by another warehouse.

### D9: Frontend sales pages
- `QuotesPage`, `QuoteDetailPage`, `SellerCatalogPage`: the `customerCity` filter in queries should send `warehouseCities` array instead of a single city. The sub-locations query already uses `userWarehouseId`, so it's fine. FEFO suggestions are already location-scoped.
- `OrdersPage`: similarly, the branch-city filter in the orders query should use the array.

## Task List (ordered)

### Phase 1: Schema & auth foundation
1. **Prisma schema** (`backend/prisma/schema.prisma`): Add `WarehouseServedCity` model + inverse relation on `Warehouse`.
2. **Migration**: Create `prisma/migrations/<timestamp>_warehouse_served_city/migration.sql`.
3. **`AuthContext`** (`rbac.ts`): Add `warehouseCities?: string[] | null`.
4. **Server auth** (`server.ts`): Load `warehouseCities` from DB for branch-scoped SALES users (query `WarehouseServedCity` where `warehouseId = user.warehouseId`). Include the warehouse's own `city` + served cities. PROVIDER/TenantAdmin → `null`.
5. **`AuthMeResponse`** (`usePermissions.ts`): Add `warehouseCities` to `UserInfo`.
6. **`auth.ts` `/me`**: Return `warehouseCities` in the user response.

### Phase 2: Shared helper & backend migration
7. **New file** `backend/src/application/security/branch.ts`: Export `branchCitiesOf(request): string[] | null` and `branchCitiesOfOrMissing(request): string[]` (throws 'Seleccione su sucursal antes de continuar' pattern). Also helper `branchCitiesOfMissing(request): boolean`.
8. **Migration script** (run once): For every existing SALES warehouse, seed `WarehouseServedCity` entries with `city = warehouse.city` (each warehouse serves its own city by default — backward compatible).
9. **`npm run prisma:generate`** to update the Prisma client.

### Phase 3: Backend route updates
10. **`customers.ts`**: Replace `branchCityOf` with `branchCitiesOf`. Change all `city: { equals: branchCity }` to `city: { in: branchCities }`. Update customer creation validation to check `custCity in branchCities`.
11. **`salesQuotes.ts`**: Replace `branchCityOf` with `branchCitiesOf`. Update quotes list filter to `in`. Update quote creation validation. Update `available-batches` to filter by `warehouseId = userWarehouseId` (or verify the quote's location belongs to the user's warehouse).
12. **`salesOrders.ts`**: Replace `branchCityOf` with `branchCitiesOf`. Update orders list, deliveries, order detail, cancel, etc. to use `in` filter.
13. **`salesPayments.ts`**: Replace `branchCityOf` with `branchCitiesOf`. Update payments filter.
14. **`notifications.ts`**: Replace `branchCityOf` with `branchCitiesOf`. Update notifications filter.
15. **`reports.ts`**: Replace `branchCityOf` with `branchCitiesOf`. Update all report filters. Also update `branchOwnWarehouseIdOf`/`resolveBranchWarehouseId` if they reference city.
16. **`stock.ts`**: Replace `branchCityOf` with `branchCitiesOf`. Update movement-requests, returns, etc.

### Phase 4: Admin CRUD for served cities
17. **`WAREHOUSES routes** (`warehouses.ts`): Add endpoints:
    - `GET /api/v1/warehouses/:id/served-cities` — list served cities for a warehouse
    - `POST /api/v1/warehouses/:id/served-cities` — add a city (validates no overlap with other warehouses)
    - `DELETE /api/v1/warehouses/:id/served-cities/:city` — remove a city
    - `PATCH /api/v1/warehouses/:id/served-cities` — bulk update
    Validation: reject adding a city that's already served by another active warehouse of type SALES.

### Phase 5: Frontend updates
18. **WarehousesPage** (`warehouse/WarehousesPage.tsx`): Add "Departamentos atendidos" column showing served cities. Add edit modal/inline editor using `CitySelector`. Call new API endpoints for CRUD.
19. **usePermissions** (`hooks/usePermissions.ts`): Expose `warehouseCities` array.
20. **QuotesPage**: Update `subLocationsQuery` — it already uses `userWarehouseId`. Update any query that uses `customerCity` for scoping to use `warehouseCities` array. Remove the `customerCity` dependency in `fetchSubLocations` (since warehouseId already filters correctly).
21. **QuoteDetailPage**: Same updates — ensure quote creation validates customer city against `warehouseCities`.
22. **SellerCatalogPage**: Already fixed for warehouseId-based sub-location filtering. Verify customer city validation is updated.
23. **OrdersPage**: Update any city-based query filters to use `warehouseCities`.
24. **CustomersPage** (if exists): Update customer listing to filter by `warehouseCities` array.
25. **Reports pages**: Update any city-based filters.

### Phase 6: Validation & testing
26. **`npx tsc --noEmit`** — backend + frontend
27. **`npm run build`** — backend + frontend
28. **`docker build`** — verify Docker images compile
29. **Manual test scenarios**:
   - Branch user can see customers from all served cities (not just own city)
   - Branch user cannot create quotes for customers from unserved cities
   - Available batches only show stock from the branch's warehouse
   - New customer creation validates city against served cities
   - Two warehouses cannot serve the same city (validation error)
   - PROVIDER users unaffected (still see all cities)
   - Tenant admin sees all warehouses/customers (unaffected)

## Data flow (example scenario)

1. Tenant admin configures SUC-LPZ to serve [LA PAZ, ORURO, POTOSÍ].
2. User (`warehouseId = SUC-LPZ`) logs in → `request.auth.warehouseCities = ['LA PAZ', 'ORURO', 'POTOSÍ']`.
3. User browses customers → `GET /api/v1/customers?city=...` returns customers from LA PAZ, ORURO, and POTOSÍ (filtered by `city IN [... ]`).
4. User selects a customer from ORURO → customer city (ORURO) is in `warehouseCities` → OK.
5. User creates a quote → validates `customer.city IN warehouseCities` → passes.
6. User processes the quote → `GET /api/v1/sales/quotes/sub-warehouses` returns SUC-LPZ's locations (already warehouseId-scoped).
7. User views available batches → `GET /api/v1/sales/quotes/:id/available-batches` filters by `warehouse.id = SUC-LPZ` → only shows batches from SUC-LPZ's locations.
8. Order is created → `deliveryCity = ORURO` (customer's city), stock deducted from SUC-LPZ.

## Risks & Mitigations

- **Duplicate city assignment**: The `@@unique([tenantId, city])` constraint on `WarehouseServedCity` prevents two warehouses from serving the same city at the DB level. API-level validation provides a friendly error message before hitting the DB.
- **Backward compatibility**: The migration seeds each warehouse with its own city as a served city. Existing behavior is preserved for warehouses that serve only their primary city.
- **PROVIDER warehouses**: Unaffected — they don't use `branchCitiesOf`, they see all cities.
- **Reports**: The `branchCityOf` functions in reports.ts currently return `null` for PROVIDER and tenant admins. The new `branchCitiesOf` should follow the same pattern.
- **Performance**: The `available-batches` query changes from city-based to warehouseId-based filtering, which is actually more efficient (direct FK index vs. city match).

## Out of scope
- Changing the `Warehouse.city` primary field (it stays as the warehouse's home city).
- Cross-warehouse transfers (stock movement between warehouses) — unaffected by this change.
- Department-level reporting (vs. city-level) — the feature works at the city level, which in Bolivia corresponds to departments for most use cases.
- Backfill on production — requires running the migration in `deploy.sh` via `prisma migrate deploy`.

## Migration SQL (generated by Prisma)

```sql
-- Auto-generated by prisma migrate
CREATE TABLE "WarehouseServedCity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WarehouseServedCity_tenantId_warehouseId_city_key" ON "WarehouseServedCity"("tenantId","warehouseId","city");
CREATE UNIQUE INDEX "WarehouseServedCity_tenantId_city_key" ON "WarehouseServedCity"("tenantId","city");
CREATE INDEX "WarehouseServedCity_tenantId_city_idx" ON "WarehouseServedCity"("tenantId","city");

-- Backfill: each warehouse serves its own city
INSERT INTO "WarehouseServedCity" (id, tenantId, warehouseId, city)
SELECT gen_random_uuid(), w."tenantId", w.id, UPPER(TRIM(w.city))
FROM "Warehouse" w
WHERE w.city IS NOT NULL AND w.type = 'SALES';
```
