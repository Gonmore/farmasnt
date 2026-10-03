# Plan: Reporte Mensual de Sucursal

## Objetivo
Nuevo tab `SUCURSAL` dentro de `SalesReportsPage` que muestre un reporte mensual por sucursal con KPIs, desglose de clientes (órdenes y facturación) y desglose de productos/presentaciones vendidas. Exportable a PDF y Excel. Presentado a gerencia.

## Decisiones del usuario
- **Ubicación**: Nuevo tab `SUCURSAL` dentro de `SalesReportsPage` (no ruta separada).
- **"Total de productos vendidos"**: Unidades totales vendidas (suma de `quantity`), no SKUs distintos.
- **"A cuántos clientes"**: Tabla de clientes con `ordersCount` y `amount` por cliente.
- **Presentaciones**: Mostrar producto + presentación + unidades vendidas.

## Backend — Endpoint

### Archivo: `backend/src/adapters/http/routes/salesReports.ts`
1. Agregar al final de `registerSalesReportRoutes`:
   - **Ruta**: `GET /api/v1/reports/sales/branch-monthly-summary`
   - **Permisos**: `requireAuth()`, `requireModuleEnabled(db, 'SALES')`, `requirePermission(Permissions.ReportSalesRead)` — mismo que todos los reportes de ventas.
   - **Query**: `salesBranchMonthlySummaryQuerySchema` = `dateRangeQuerySchema.extend({ status: SalesOrderStatus.optional() }).merge(locationFilterQuerySchema)` — reutiliza `warehouseId`/`locationId` para branch-scoping existente.
   - **Response**: `{ summary, customers, products }` con tres queries SQL:

   **Summary query** (un solo row):
   ```sql
   SELECT
     sum(sol.quantity * sol.unitPrice)::text as "totalRevenue",
     count(distinct so.id)::text as "totalOrders",
     sum(sol.quantity)::text as "totalUnits",
     count(distinct so.customerId)::text as "distinctCustomers",
     count(distinct sol.productId)::text as "distinctProducts"
   ```

   **Customers query**: `GROUP BY c.id, c.name, c.city, c.department`
   - `customerId`, `customerName`, `city`, `department`, `ordersCount` (count distinct so.id), `quantity`, `amount`
   - Reutiliza el patrón `loc_match` del endpoint existente para respetar `warehouseId`/`locationId`.

   **Products query**: `GROUP BY p.id, p.sku, p.name, pp.id, COALESCE(pp.name, 'Unidad')`
   - `productId`, `sku`, `productName`, `presentationId`, `presentationName`, `quantity` (sum de `sol.quantity`), `amount` (sum de `sol.quantity * sol.unitPrice`)
   - Reutiliza el patrón `loc_match` del endpoint existente.

2. **Tipos TS** (en `salesReports.ts`):
   - `SalesBranchSummaryRow`, `SalesBranchCustomerRow`, `SalesBranchProductRow`
   - `SalesBranchSummaryItem`, `SalesBranchCustomerItem`, `SalesBranchProductItem`

3. **Response mapping**: Convertir `bigint`/`string` a `number` con `Number()` (igual que `summaryQuery`).

### Archivo: `backend/src/db/prisma.ts` — sin cambios necesarios
El schema no necesita migraciones; todos los campos (`quantity`, `unitPrice`, `presentationId`, `customerId`) ya existen.

## Frontend

### 1. API fetch function — `frontend/src/pages/reports/SalesReportsPage.tsx`
Agregar:
```ts
async function fetchSalesBranchMonthlySummary(token: string, q: {...}): Promise<{
  summary: { totalRevenue: string; totalOrders: number; totalUnits: string; distinctCustomers: number; distinctProducts: number }
  customers: SalesBranchCustomerItem[]
  products: SalesBranchProductItem[]
}>
```

### 2. Tipos
```ts
type SalesBranchCustomerItem = {
  customerId: string; customerName: string; city: string | null; department: string | null
  ordersCount: number; quantity: string; amount: string
}
type SalesBranchProductItem = {
  productId: string; sku: string | null; productName: string
  presentationId: string | null; presentationName: string; quantity: string; amount: string
}
```

### 3. Tab enum
- Agregar `'BRANCH'` a `ReportTab` type.
- Agregar a la validación de query string (`['MONTH', 'CUSTOMERS', 'DEPARTMENTS', 'TOP_PRODUCTS', 'FUNNEL', 'COMPARISON', 'MARGINS', 'BRANCH']`).

### 4. Query
```ts
const branchMonthlyQuery = useQuery({
  queryKey: ['reports', 'sales', 'branchMonthly', { from, to, status, warehouseId, locationId }],
  queryFn: () => fetchSalesBranchMonthlySummary(auth.accessToken!, { from, to, status, warehouseId: warehouseId || undefined, locationId: locationId || undefined }),
  enabled: !!auth.accessToken && tab === 'BRANCH',
})
```

### 5. Título
Agregar en el `useMemo` del `title`:
```ts
if (tab === 'BRANCH') return warehouseName
  ? `Reporte mensual sucursal - ${warehouseName} (${period})`
  : `Reporte mensual general (${period})`
```

### 6. Tab button (en el JSX)
```tsx
<Button size="sm" variant={tab === 'BRANCH' ? 'primary' : 'outline'} onClick={() => setTab('BRANCH')}>
  🏪 Sucursal
</Button>
```

### 7. Render del tab BRANCH
Dentro del `<div ref={reportRef} className="space-y-6">`:
```tsx
{tab === 'BRANCH' && (
  <ReportSection title="📊 Reporte Mensual de Sucursal" ...>
    {branchMonthlyQuery.isLoading && <Loading />}
    {branchMonthlyQuery.isError && <ErrorState .../>}
    {!branchMonthlyQuery.isLoading && !branchMonthlyQuery.isError && (
      <>
        {/* KPIs */}
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-5">
          <KPICard icon="💰" label="Facturación Total" value={`${money(toNumber(branchMonthlyQuery.data?.summary.totalRevenue))} ${currency}`} color="success" />
          <KPICard icon="🧾" label="Órdenes" value={branchMonthlyQuery.data?.summary.totalOrders ?? 0} color="primary" />
          <KPICard icon="📦" label="Unidades Vendidas" value={formatInteger(toNumber(branchMonthlyQuery.data?.summary.totalUnits))} color="info" />
          <KPICard icon="👥" label="Clientes" value={branchMonthlyQuery.data?.summary.distinctCustomers ?? 0} color="warning" />
          <KPICard icon="🧪" label="Productos" value={branchMonthlyQuery.data?.summary.distinctProducts ?? 0} color="secondary" />
        </div>

        {/* Tabla de clientes */}
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white px-4 py-5">
          <div className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-600">Ventas por cliente</div>
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>...</thead>
            <tbody>
              {branchMonthlyQuery.data?.customers.sort((a,b) => toNumber(b.amount) - toNumber(a.amount)).map(c => (
                <tr key={c.customerId}>
                  <td>{c.customerName}</td>
                  <td>{c.city ?? '-'}</td>
                  <td>{c.department ?? '-'}</td>
                  <td className="text-right">{formatInteger(c.ordersCount)}</td>
                  <td className="text-right">{formatInteger(toNumber(c.quantity))}</td>
                  <td className="text-right font-semibold text-emerald-700">{money(toNumber(c.amount))} {currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Tabla de productos/presentaciones */}
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5">
          <div className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-600">Productos y presentaciones vendidos</div>
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>...</thead>
            <tbody>
              {branchMonthlyQuery.data?.products.sort((a,b) => toNumber(b.amount) - toNumber(a.amount)).map(p => (
                <tr key={`${p.productId}-${p.presentationId ?? 'unidad'}`}>
                  <td>{p.sku ?? '-'}</td>
                  <td>{p.productName}</td>
                  <td>{p.presentationName}</td>
                  <td className="text-right">{formatInteger(toNumber(p.quantity))}</td>
                  <td className="text-right font-semibold text-emerald-700">{money(toNumber(p.amount))} {currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    )}
  </ReportSection>
)}
```

### 8. Exportaciones (PDF, Excel, Email)

#### 8.1 Nuevo documento: `frontend/src/components/reports/SalesBranchDocument.tsx`
- Props: `{ title, from, to, currency, statusLabel, warehouseName, summary, customers, products }`
- Layout: header con título + período + sucursal + estado; KPIs grid (5 cards); tabla clientes; tabla productos/presentaciones.
- Reutiliza la estructura de `SalesMonthDocument` y `SalesByCustomerDocument`.

#### 8.2 Exportar a `index.ts`
```ts
export { SalesBranchDocument } from './SalesBranchDocument'
export type { SalesBranchDocumentProps } from './SalesBranchDocument'
```

#### 8.3 PDF export (`handleExportPdf`)
```ts
if (tab === 'BRANCH') {
  const data = branchMonthlyQuery.data
  if (!data) { window.alert('No hay datos para exportar'); return }
  await exportReactNodeToPdf(
    <SalesBranchDocument title={title} from={to} currency={currency} statusLabel={statusLabel(status)} warehouseName={warehouseName} summary={data.summary} customers={data.customers} products={data.products} />,
    { filename: exportFilename, title, subtitle: `Período: ${from} a ${to}${warehouseName ? ` | Sucursal: ${warehouseName}` : ''} | Moneda: ${currency}`, ... }
  )
  return
}
```

#### 8.4 Excel export (`handleExportExcel`)
- Hoja `Resumen`: KPIs (facturación, órdenes, unidades, clientes, productos).
- Hoja `Clientes`: ranking de clientes.
- Hoja `Productos`: productos/presentaciones.
- Hoja `Meta`: período, sucursal, estado, moneda, fecha generación.

#### 8.5 Email export (`emailMutation`)
- Caso `tab === 'BRANCH'` que genera el blob de `SalesBranchDocument` y lo envía.

### 9. Branch-scoped default
El tab `BRANCH` respeta el mismo patrón que el tab `MONTH`:
- `isBranchScoped` → fuerza `warehouseId` al almacén propio del usuario.
- `<Select>` sucursal disabled para branch-scoped.
- Título muestra nombre de sucursal propia.

## Documentación

### `API_REFERENCE.md`
- Documentar `GET /api/v1/reports/sales/branch-monthly-summary` con query params y response schema.

### `ARCHITECTURE.md`
- Agregar el endpoint al registro de reportes de ventas.
- Agregar el tab `BRANCH` a las reglas de negocio (autonomía de sucursal en reportes).

### `bitacora.md`
- Nueva entrada changelog con el nuevo reporte.

## Validación
1. Backend: `npx tsc --noEmit` en `backend/`.
2. Frontend: `npx tsc --noEmit` en `frontend/`.
3. Frontend: `npm run build` en `frontend/`.
4. Probar con `docker compose up -d --build` y Swagger UI (`GET /api/v1/docs`).
5. Navegar a `/reports/sales`, seleccionar tab `SUCURSAL`, verificar:
   - KPIs se muestran correctamente.
   - Tabla de clientes muestra datos.
   - Tabla de productos/presentaciones muestra datos.
   - Exportar a PDF y Excel funciona.
   - Usuario `scope:branch` ve solo su sucursal y el selector está disabled.