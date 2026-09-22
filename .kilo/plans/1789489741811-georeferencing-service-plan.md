# Plan: Georeferencing Service Implementation for FarmaSNT

## Problem Statement
The current implementation has **hardcoded georeferencing data** with serious issues:
- **Frontend** (`lib/department.ts`): Contains invalid Bolivian departments (CÓRDOBA, CHIPAS, PARAS - these are Argentine/Mexican)
- **Frontend** (`lib/geo.ts`): Hardcoded country/city lists for 7 countries, not extensible
- **Backend** (`shared/geo.ts`): Only Bolivia mapping, no real georeferencing service
- **No proper workflow**: Country → Department/State → City → Map for exact location
- **Currency hardcoded** to BOB instead of derived from country

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    GEOREFERENCING SERVICE                       │
├─────────────────────────────────────────────────────────────────┤
│  Frontend Components                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │CountrySelector│──│DeptSelector  │──│ CitySelector │          │
│  │  (search)    │  │  (search)    │  │  (search)    │          │
│  └──────────────┘  └──────────────┘  └──────┬───────┘          │
│                                             │                  │
│                          ┌──────────────────┘                  │
│                          ▼                                     │
│                   ┌─────────────┐                              │
│                   │  MapSelector│ ◄── Precise location picking │
│                   │ (Leaflet)   │                              │
│                   └─────────────┘                              │
│                          │                                     │
│                          ▼                                     │
│                   ┌─────────────┐                              │
│                   │ GeoService  │ ◄── Central API client       │
│                   │  (client)   │                              │
│                   └──────┬──────┘                              │
└──────────────────────────│─────────────────────────────────────┘
                           │ HTTP/REST
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Backend Service                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ GeoService (server)                                       │  │
│  │  - Wraps Nominatim / OpenStreetMap / GeoNames / etc.     │  │
│  │  - Caching (Redis/in-memory)                             │  │
│  │  - Rate limiting                                         │  │
│  │  - Country → Admin levels (departments/states/provinces) │  │
│  │  - Admin level → Cities                                  │  │
│  │  - Reverse geocoding (lat/lng → address)                 │  │
│  │  - Currency lookup by country                            │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Backend GeoService (Core)

#### 1.1 Create `backend/src/application/geo/geoService.ts`
```typescript
// Features:
// - searchCountries(query): Country[]
// - getCountryByCode(code): Country | null
// - searchAdminLevel1(countryCode, query): AdminLevel1[]  // departments/states/provinces
// - searchCities(countryCode, adminLevel1Code?, query): City[]
// - reverseGeocode(lat, lng): Address
// - getCurrencyByCountry(countryCode): string (ISO 4217)
// - Caching with TTL (countries: 24h, admin1: 12h, cities: 6h)
// - Rate limiting per tenant
// - Fallback to static data if external API fails
```

#### 1.2 Create `backend/src/application/geo/types.ts`
```typescript
interface Country {
  code: string;        // ISO 3166-1 alpha-2 (bo, pe, ar, cl, br, py, uy, etc.)
  code3: string;       // ISO 3166-1 alpha-3
  name: string;        // Localized name
  currency: string;    // ISO 4217 (BOB, PEN, ARS, CLP, BRL, PYG, UYU)
  phoneCode: string;   // +591, +51, +54, etc.
}

interface AdminLevel1 {
  code: string;        // ISO 3166-2 or internal code
  name: string;
  countryCode: string;
  type: 'department' | 'state' | 'province' | 'region';
}

interface City {
  id: string;
  name: string;
  adminLevel1Code: string;
  countryCode: string;
  lat: number;
  lng: number;
  population?: number;
  featureType: 'city' | 'town' | 'village' | 'municipality';
}

interface Address {
  formatted: string;
  country: Country;
  adminLevel1?: AdminLevel1;
  city?: City;
  lat: number;
  lng: number;
}
```

#### 1.3 Create `backend/src/adapters/http/routes/geo.ts`
- `GET /api/v1/geo/countries?q=` - Search countries
- `GET /api/v1/geo/countries/:code` - Get country details (currency, phone code)
- `GET /api/v1/geo/admin-level1?countryCode=&q=` - Search departments/states
- `GET /api/v1/geo/cities?countryCode=&adminLevel1Code=&q=` - Search cities
- `GET /api/v1/geo/reverse?lat=&lng=` - Reverse geocoding
- All endpoints: JWT required, `catalog:read` permission

#### 1.4 Update `backend/src/shared/geo.ts` → Deprecate/Remove
- Remove hardcoded `BOLIVIAN_DEPARTMENTS` and `CITY_TO_DEPARTMENT`
- Replace with calls to `GeoService`
- Keep `cityToDepartment()` for backward compat but delegate to service

---

### Phase 2: Frontend GeoService Client

#### 2.1 Create `frontend/src/lib/geoService.ts`
```typescript
// Thin wrapper around API endpoints
export const geoApi = {
  searchCountries: (query: string) => apiFetch('/api/v1/geo/countries?q=' + encodeURIComponent(query)),
  getCountry: (code: string) => apiFetch('/api/v1/geo/countries/' + code),
  searchAdminLevel1: (countryCode: string, query: string) => apiFetch('/api/v1/geo/admin-level1?countryCode=' + countryCode + '&q=' + encodeURIComponent(query)),
  searchCities: (countryCode: string, adminLevel1Code: string | undefined, query: string) => apiFetch(...),
  reverseGeocode: (lat: number, lng: number) => apiFetch(...),
}
```

#### 2.2 Create `frontend/src/components/geo/CountrySelector.tsx`
- Searchable dropdown using `geoApi.searchCountries`
- Shows flag emoji + name
- On select: fetches country details (currency, phone code) → updates Tenant context
- **Replaces** hardcoded `COUNTRY_OPTIONS` in `lib/geo.ts`

#### 2.3 Create `frontend/src/components/geo/AdminLevel1Selector.tsx` (Department/State/Province)
- Searchable dropdown using `geoApi.searchAdminLevel1(countryCode, query)`
- Label adapts to country: "Departamento" (BO), "Estado" (AR/BR/MX), "Provincia" (CL/PE/CO), "Región" (others)
- **Replaces** `DepartmentSelector.tsx` and hardcoded `BOLIVIAN_DEPARTMENTS`

#### 2.4 Update `frontend/src/components/CitySelector.tsx`
- Use `geoApi.searchCities(countryCode, adminLevel1Code, query)`
- Pass `countryCode` and `adminLevel1Code` from parent context
- **Removes** hardcoded `CITIES_BY_COUNTRY`

#### 2.5 Update `frontend/src/components/MapSelector.tsx`
- Accept `countryCode`, `adminLevel1Code`, `city` as context
- Center map on selected city/adminLevel1/country
- Reverse geocode on click → returns `mapsUrl` + formatted address
- **Already exists** - enhance with context awareness

---

### Phase 3: Integration Points

#### 3.1 Tenant Branding / System Config (`pages/admin/BrandingPage.tsx`)
- Add **CountrySelector** at top of branding form
- On country change: fetch currency → update `tenant.currency` field
- Phone code → update placeholder in contact forms
- **This replaces** hardcoded `'BOLIVIA'` default in `WarehousesPage.tsx:103`

#### 3.2 Warehouse Creation/Edit (`pages/warehouse/WarehousesPage.tsx`)
- Flow: **CountrySelector** (read-only from tenant) → **AdminLevel1Selector** → **CitySelector**
- `department` field on warehouse = selected AdminLevel1
- `city` field on warehouse = selected City
- Backend `cityToDepartment()` → now uses GeoService to validate
- **Removes** hardcoded `tenantCountry = 'BOLIVIA'`

#### 3.3 Customer Creation/Edit (`pages/sales/CustomerDetailPage.tsx`)
- Flow: **CountrySelector** (read-only from tenant) → **AdminLevel1Selector** → **CitySelector** → **MapSelector**
- On city select: auto-populate `department` from city's adminLevel1
- **MapSelector** for precise location → `mapsUrl` + `address`
- **Branch assignment**: When customer created, find warehouse where `servedDepartments` includes customer's department → auto-assign or validate

#### 3.4 Quote/Order Processing (`pages/sales/QuoteDetailPage.tsx`, `OrdersPage.tsx`)
- Customer's city/department → filter available batches by location's warehouse department
- Sub-warehouse selector: filter by user's warehouse + customer's department (existing logic enhanced)

---

### Phase 4: Data Migration & Cleanup

#### 4.1 Fix Invalid Bolivian Departments
```sql
-- Current invalid in frontend/lib/department.ts:
-- 'CÓRDOBA', 'CHIPAS', 'PARAS' ← REMOVE

-- Valid Bolivian departments (9):
-- CHUQUISACA, COCHABAMBA, LA PAZ, ORURO, PANDO, POTOSÍ, SANTA CRUZ, TARIJA, BENI
```

#### 4.2 Backfill Tenant Country
```sql
-- All existing tenants default to 'BOLIVIA' (code: 'BO')
UPDATE "Tenant" SET country = 'BOLIVIA' WHERE country IS NULL;
```

#### 4.3 Backfill Warehouse Department
```sql
-- For warehouses with city but no department:
UPDATE "Warehouse" w
SET department = geo.city_to_department(w.city)  -- via new function
WHERE w.department IS NULL AND w.city IS NOT NULL;
```

---

### Phase 5: Validation & Testing

#### 5.1 Unit Tests
- GeoService: searchCountries, searchAdminLevel1, searchCities, reverseGeocode
- Currency mapping for all supported countries
- Caching behavior

#### 5.2 Integration Tests
- Tenant branding: country change → currency update
- Warehouse create: country → department → city flow
- Customer create: department auto-assignment to branch
- Map selector: click → mapsUrl + address

#### 5.3 Manual Test Scenarios
1. **New tenant (Argentina)**: Select Argentina → currency ARS → provinces (Buenos Aires, Córdoba, etc.) → cities → map
2. **Existing tenant (Bolivia)**: Create warehouse in La Paz → department auto La Paz → cities (La Paz, El Alto, etc.)
3. **Customer in Cochabamba**: Select Cochabamba department → cities → map pick → auto-assigned to warehouse serving Cochabamba
4. **Cross-border**: Tenant in Chile serves customers in Argentina (multi-country support)

---

## Affected Files

### Backend (New)
- `backend/src/application/geo/types.ts` - Type definitions
- `backend/src/application/geo/geoService.ts` - Core service
- `backend/src/adapters/http/routes/geo.ts` - HTTP endpoints
- `backend/src/adapters/http/routes/index.ts` - Register routes

### Backend (Modified)
- `backend/src/shared/geo.ts` - Deprecate, delegate to GeoService
- `backend/src/adapters/http/routes/warehouses.ts` - Use GeoService for validation
- `backend/src/adapters/http/routes/customers.ts` - Use GeoService for validation
- `backend/prisma/schema.prisma` - Add `countryCode` to Warehouse? (already has `department`)

### Frontend (New)
- `frontend/src/lib/geoService.ts` - API client
- `frontend/src/components/geo/CountrySelector.tsx`
- `frontend/src/components/geo/AdminLevel1Selector.tsx`
- `frontend/src/components/geo/index.ts` - Barrel exports

### Frontend (Modified)
- `frontend/src/lib/geo.ts` - **Remove** hardcoded data, keep only `searchCities` as wrapper
- `frontend/src/lib/department.ts` - **Delete** (replaced by AdminLevel1Selector)
- `frontend/src/components/CitySelector.tsx` - Use geoService
- `frontend/src/components/DepartmentSelector.tsx` - **Delete** (replaced by AdminLevel1Selector)
- `frontend/src/components/MapSelector.tsx` - Enhance with context
- `frontend/src/pages/admin/BrandingPage.tsx` - Add CountrySelector
- `frontend/src/pages/warehouse/WarehousesPage.tsx` - Use new selectors
- `frontend/src/pages/sales/CustomerDetailPage.tsx` - Use new selectors + map
- `frontend/src/pages/sales/CustomersPage.tsx` - Filter by dynamic departments

---

## Open Questions

1. **External API Choice**: Nominatim (OSM) is free but has rate limits. Do we need a paid provider (GeoNames, Google Places) for production?
   - *Recommendation*: Start with Nominatim + caching, add provider abstraction for future swap

2. **Admin Level Naming**: Should we normalize to "department/state/province" per country or use generic "Region Level 1"?
   - *Recommendation*: Map per country (BO=department, AR=province, BR=state, CL=region, PE=department, etc.)

3. **Offline/Fallback**: Static fallback data for Bolivia (current 9 departments + major cities) bundled in service?
   - *Recommendation*: Yes, bundle minimal Bolivia data as fallback

4. **Currency Source**: ISO 4217 from country code, or allow tenant override?
   - *Recommendation*: Default from country, allow override in Tenant branding

5. **Multi-country Tenant**: Can one tenant operate in multiple countries?
   - *Current schema*: Tenant has single `country` field. Keep single-country per tenant for MVP.

---

## Rollout Strategy

1. **Deploy Backend GeoService** behind feature flag
2. **Deploy Frontend selectors** behind same flag
3. **Enable for new tenants** first (onboarding flow)
4. **Migrate existing tenants** via admin action
5. **Remove hardcoded data** after full migration

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Nominatim rate limits | In-memory cache + Redis; configurable provider |
| Invalid city/department combos | Backend validation via GeoService |
| Existing data with invalid departments | Migration script + UI validation |
| Multi-language country names | Use `name` from Nominatim (supports `accept-language`) |
| MapSelector UX on mobile | Test touch events; fallback to manual URL |

---

## Success Criteria

- [ ] No hardcoded country/department/city lists in codebase
- [ ] Country selection drives currency, phone code, admin level labels
- [ ] Warehouse creation: Country → Department → City flow works
- [ ] Customer creation: Department auto-assigns to correct branch
- [ ] Map picker returns precise `mapsUrl` + address
- [ ] All existing tests pass + new geo tests added
- [ ] Bolivia departments corrected (9 valid, 0 invalid)