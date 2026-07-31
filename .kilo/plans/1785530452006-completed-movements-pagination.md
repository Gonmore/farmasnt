# Plan: Sort + Paginate "Movimientos Realizados"

## Problem

`GET /api/v1/stock/completed-movements` (`backend/src/adapters/http/routes/stock.ts:3609-4062`) merges 4 sources (movement-request fulfillments, bulk transfers, individual movements, returns), each capped at `take: 100`, sorts the combined list by `completedAt` desc in memory, then hard-slices to the top 100 (`line 4055`). There is no `cursor`/`nextCursor` — once a tenant has more than 100 completed movements total, older ones become permanently invisible.

Secondary bug: the combined sort key is `completedAt`, but the frontend "Fecha" column and detail modal (`frontend/src/pages/stock/CompletedMovementsPage.tsx:203,278`) both render `m.createdAt`. For `FULFILL_REQUEST` rows, `completedAt = fulfilledAt` while `createdAt` is the request's original creation date (`stock.ts:4021,4030-4031`) — these can diverge, so the displayed date does not match the sort order, making the list look unsorted even though it technically is.

## Scope

- Backend: raise the effective visible depth well beyond 100 and add real "load more" pagination.
- Frontend: consistent with `PaginationCursor` pattern already used (e.g. `ProductsListPage.tsx`), add Load more / Back / Start controls.
- Fix the date-column bug so displayed date always matches sort order.

## Design decision: pagination strategy

True per-source keyset cursors are impractical here because `completedAt` for `FULFILL_REQUEST` is a derived value (`fulfilledAt ?? max(createdAt) ?? request.createdAt`), not a persisted column that can be filtered/ordered by Prisma across a join. Rearchitecting this into a single queryable table/view is a much larger change (new denormalized table or SQL view + backfill) and out of scope for this fix.

**Chosen approach:** keep the in-memory merge, but:
1. Raise each source's underlying `take` from `100` to `300` (constant, e.g. `const SOURCE_FETCH_LIMIT = 300`).
2. After merging + sorting by `completedAt` desc, paginate the merged array using an **offset cursor**: `cursor` = stringified integer offset (opaque to the client, just passed back from `nextCursor`), `take` = page size (query param, default `50`, max `100`).
3. `nextCursor = offset + take < allMovements.length ? String(offset + take) : null`.
4. Response: `{ items: allMovements.slice(offset, offset + take), nextCursor }`.

This is a deviation from the strict Prisma `cursor: {id}` keyset pattern used by `products`/`warehouses`, but it reuses the same `take`/`cursor`/`nextCursor` response contract so the frontend pattern (`PaginationCursor`, cursor history stack) works unmodified. This must be called out to the user/reviewer as an intentional simplification, not an oversight.

**Known limitation (explicitly accepted):** with `SOURCE_FETCH_LIMIT = 300` per source (4 sources ⇒ up to 1200 merged records), tenants with more than ~1200 completed movements total will still not be able to page past that point. This is a large improvement over the current hard cap of 100 and is proportionate to the effort of this fix; a proper fix requires a denormalized `CompletedMovement` table/view (flagged as future work, not part of this plan).

## Backend changes (`backend/src/adapters/http/routes/stock.ts`)

1. Add a query schema for this route:
   ```ts
   const completedMovementsQuerySchema = z.object({
     take: z.coerce.number().int().min(1).max(100).default(50),
     cursor: z.string().regex(/^\d+$/).optional(),
   })
   ```
   Parse `request.query` at the top of the handler; return `400` on invalid input (follow existing pattern used by other routes in this file for query validation errors).
2. Replace the 4 hardcoded `take: 100` (lines 3706, 3733, 3816, 3914) with a shared constant `SOURCE_FETCH_LIMIT = 300`.
3. After building `allMovements` (line 4047-4052), compute:
   ```ts
   const offset = cursor ? parseInt(cursor, 10) : 0
   const page = allMovements.slice(offset, offset + take)
   const nextCursor = offset + take < allMovements.length ? String(offset + take) : null
   return reply.send({ items: page, nextCursor })
   ```
4. Update `API_REFERENCE.md` for this endpoint: document `take`/`cursor` query params, the new `nextCursor` field in the response, and note the offset-cursor caveat (not a UUID/keyset cursor like other list endpoints).

## Frontend changes (`frontend/src/pages/stock/CompletedMovementsPage.tsx`)

1. Change `completedMovementsQuery`:
   - Add `take` (default 50) and `cursor` state, plus a `cursorHistory: string[]` stack (mirrors `ProductsListPage.tsx` pattern).
   - `queryKey: ['completed-movements', take, cursor]`.
   - `queryFn` appends `?take=<take>` and `&cursor=<cursor>` when present.
   - Response type becomes `{ items: CompletedMovement[]; nextCursor: string | null }`.
2. Add handlers: `handleLoadMore` (push current cursor to history, set cursor to `nextCursor`), `handleGoBack` (pop history), `handleGoToStart` (clear cursor + history).
3. Render `<PaginationCursor hasMore={!!data?.nextCursor} onLoadMore={...} loading={query.isFetching} canGoBack={cursorHistory.length > 0} onGoBack={...} onGoToStart={...} currentCount={visibleMovements.length} take={take} />` below the table, matching `ProductsListPage.tsx`/`WarehousesPage.tsx` usage.
4. Local client-side `searchQuery` filtering (`visibleMovements`, lines 121-149) only filters within the current page — acceptable since search is meant to narrow the currently loaded page, consistent with other paginated list pages in this codebase. No change needed beyond confirming this behavior, but note it so it isn't mistaken for a bug later.
5. Fix the date-display bug: both the table column (`line 203`) and the detail modal (`line 278`) must render `m.completedAt` / `selected.completedAt` instead of `createdAt`, so the visible date matches the actual sort key. Add `completedAt` handling identical to the existing `createdAt` formatting (same `toLocaleString('es-ES', { timeZone: 'America/La_Paz' })` call).
6. Highlight-by-id effect (`useEffect` at lines 77-83) reads `?highlight=<id>` from the URL to scroll/highlight a row after actions elsewhere in the app navigate here. Since that row may now live on a page other than the first, this plan does **not** attempt to auto-page to find it (out of scope) — confirm this is acceptable (see open question below).

## Validation

- Backend: manually call `GET /api/v1/stock/completed-movements?take=10` then follow with `?take=10&cursor=<nextCursor>`, confirm no overlap/gaps and `nextCursor=null` once exhausted. Confirm total ordering by `completedAt` desc is preserved across pages.
- Confirm existing callers of this endpoint that don't pass `take`/`cursor` still get a valid default page (backwards compatible).
- Frontend: verify Load more / Back / Start buttons behave like `ProductsListPage.tsx`; verify displayed "Fecha" column value now equals `completedAt` and no longer looks out of order relative to neighboring rows.
- Re-check the `?highlight=` deep-link flow (e.g. from wherever it's triggered) still works when the target row is on page 1; document (in code comment or follow-up ticket) that it won't auto-locate rows on later pages.

## Open question

The `?highlight=<id>` flow assumes the target row is always on the first page (default `take=50`, no cursor). Is it acceptable that a highlighted movement outside the first page will simply not be found/highlighted, with no auto-pagination? **Recommended: yes, accept this limitation** — implementing look-ahead pagination to locate an arbitrary row would require additional backend support (e.g. "find page containing id") that is out of scope for this fix.
