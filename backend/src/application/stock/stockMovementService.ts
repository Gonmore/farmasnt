import type { Prisma } from '../../generated/prisma/client.js'
import { nextSequence } from '../shared/sequence.js'

export type StockMovementCreateInput = {
  tenantId: string
  userId: string
  type: 'IN' | 'OUT' | 'TRANSFER' | 'ADJUSTMENT'
  productId: string
  batchId?: string | null
  fromLocationId?: string | null
  toLocationId?: string | null
  quantity: number
  presentationId?: string | null
  presentationQuantity?: number | null
  referenceType?: string | null
  referenceId?: string | null
  note?: string | null
  createdAt?: Date
}

type LockedBalanceRow = {
  id: string
  quantity: string
}

function decimalFromNumber(value: number): string {
  return value.toString()
}

function startOfTodayUtc(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0))
}

function startOfDayUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0))
}

export async function createStockMovementTx(
  tx: Prisma.TransactionClient,
  input: StockMovementCreateInput,
): Promise<{ createdMovement: any; fromBalance: any; toBalance: any }> {
  const tenantId = input.tenantId
  const userId = input.userId
  const batchId = input.batchId ?? null

  const effectiveCreatedAt = input.createdAt ?? new Date()
  const todayUtc = startOfDayUtc(effectiveCreatedAt)

  // Validate location rules
  if (input.type === 'IN' && !input.toLocationId) throw Object.assign(new Error('toLocationId is required'), { statusCode: 400 })
  if (input.type === 'OUT' && !input.fromLocationId) throw Object.assign(new Error('fromLocationId is required'), { statusCode: 400 })
  if (input.type === 'TRANSFER' && (!input.fromLocationId || !input.toLocationId)) {
    throw Object.assign(new Error('fromLocationId and toLocationId are required'), { statusCode: 400 })
  }
  if (input.type === 'TRANSFER' && input.fromLocationId && input.toLocationId && input.fromLocationId === input.toLocationId) {
    throw Object.assign(new Error('fromLocationId and toLocationId must be different'), { statusCode: 400 })
  }
  if (input.type === 'ADJUSTMENT' && !(input.fromLocationId ?? input.toLocationId)) {
    throw Object.assign(new Error('fromLocationId or toLocationId is required'), { statusCode: 400 })
  }

  // Ensure tenant-bound entities exist
  const product = await tx.product.findFirst({ where: { id: input.productId, tenantId, isActive: true }, select: { id: true } })
  if (!product) throw Object.assign(new Error('Product not found'), { statusCode: 404 })

  // Expiry rule: block moving stock out of an expired batch.
  const decreasesStock = input.type === 'OUT' || input.type === 'TRANSFER' || (input.type === 'ADJUSTMENT' && !input.toLocationId)
  if (decreasesStock && batchId) {
    const batch = await tx.batch.findFirst({
      where: { id: batchId, tenantId, productId: input.productId },
      select: { id: true, expiresAt: true, batchNumber: true, status: true },
    })
    if (!batch) throw Object.assign(new Error('Batch not found'), { statusCode: 404 })

    // Quarantine rule: never allow decreasing stock from non-released batches.
    // This is a safety net in case some read path forgets to filter by status.
    if (batch.status !== 'RELEASED') {
      const err = new Error('Batch is in quarantine') as Error & { statusCode?: number; code?: string; meta?: any }
      err.statusCode = 409
      err.code = 'BATCH_QUARANTINE'
      err.meta = { batchId: batch.id, batchNumber: batch.batchNumber, status: batch.status }
      throw err
    }

    if (batch.expiresAt && batch.expiresAt < todayUtc) {
      const err = new Error('Batch is expired') as Error & { statusCode?: number; code?: string; meta?: any }
      err.statusCode = 409
      err.code = 'BATCH_EXPIRED'
      err.meta = { batchId: batch.id, batchNumber: batch.batchNumber, expiresAt: batch.expiresAt.toISOString() }
      throw err
    }
  }

  const fromLocationId = input.fromLocationId ?? null
  const toLocationId = input.toLocationId ?? null

  const ensureLocation = async (locationId: string, opts?: { mustBeActive?: boolean }) => {
    const mustBeActive = opts?.mustBeActive ?? true
    const loc = await tx.location.findFirst({
      where: { id: locationId, tenantId, ...(mustBeActive ? { isActive: true } : {}) },
      select: { id: true },
    })
    if (!loc) throw Object.assign(new Error('Location not found'), { statusCode: 404 })
  }

  // Allow moving stock OUT of inactive locations (so you can empty them),
  // but require destination locations to be active.
  if (fromLocationId) await ensureLocation(fromLocationId, { mustBeActive: false })
  if (toLocationId) await ensureLocation(toLocationId, { mustBeActive: true })

  const lockBalanceSafe = async (locationId: string) => {
    if (batchId === null) {
      const rows = await tx.$queryRaw<LockedBalanceRow[]>`
        SELECT "id", "quantity" FROM "InventoryBalance"
        WHERE "tenantId" = ${tenantId} AND "locationId" = ${locationId} AND "productId" = ${input.productId} AND "batchId" IS NULL
        FOR UPDATE
      `
      return rows[0] ?? null
    }

    const rows = await tx.$queryRaw<LockedBalanceRow[]>`
      SELECT "id", "quantity" FROM "InventoryBalance"
      WHERE "tenantId" = ${tenantId} AND "locationId" = ${locationId} AND "productId" = ${input.productId} AND "batchId" = ${batchId}
      FOR UPDATE
    `
    return rows[0] ?? null
  }

  if (fromLocationId) await lockBalanceSafe(fromLocationId)
  if (toLocationId && toLocationId !== fromLocationId) await lockBalanceSafe(toLocationId)

  const upsertBalance = async (locationId: string, delta: number) => {
    const current = await tx.inventoryBalance.findFirst({
      where: { tenantId, locationId, productId: input.productId, batchId },
      select: { id: true, quantity: true },
    })

    const currentQty = current ? Number(current.quantity) : 0
    const nextQty = currentQty + delta

    if (nextQty < 0) throw Object.assign(new Error('Insufficient stock'), { statusCode: 409 })

    if (!current) {
      return tx.inventoryBalance.create({
        data: {
          tenantId,
          locationId,
          productId: input.productId,
          batchId,
          quantity: decimalFromNumber(nextQty),
          createdBy: userId,
        },
        select: { id: true, quantity: true, locationId: true, productId: true, batchId: true, version: true, updatedAt: true },
      })
    }

    return tx.inventoryBalance.update({
      where: { id: current.id },
      data: { quantity: decimalFromNumber(nextQty), version: { increment: 1 }, createdBy: userId },
      select: { id: true, quantity: true, locationId: true, productId: true, batchId: true, version: true, updatedAt: true },
    })
  }

  let fromBalance: any = null
  let toBalance: any = null

  if (input.type === 'IN') {
    toBalance = await upsertBalance(toLocationId!, +input.quantity)
  } else if (input.type === 'OUT') {
    fromBalance = await upsertBalance(fromLocationId!, -input.quantity)
  } else if (input.type === 'TRANSFER') {
    fromBalance = await upsertBalance(fromLocationId!, -input.quantity)
    toBalance = await upsertBalance(toLocationId!, +input.quantity)
  } else if (input.type === 'ADJUSTMENT') {
    const locationId = (toLocationId ?? fromLocationId)!
    const delta = toLocationId ? +input.quantity : -input.quantity
    toBalance = await upsertBalance(locationId, delta)
  }

  // Mark batch as opened when stock is moved out (sale/transfer).
  // Business rule: batches start "closed"; once any OUT/TRANSFER occurs, it becomes "opened".
  if ((input.type === 'OUT' || input.type === 'TRANSFER') && batchId) {
    await tx.batch.updateMany({
      where: { tenantId, id: batchId, openedAt: null },
      data: { openedAt: effectiveCreatedAt, openedBy: userId, version: { increment: 1 } },
    })
  }

  const year = effectiveCreatedAt.getUTCFullYear()
  const seq = await nextSequence(tx, { tenantId, year, key: 'MS' })

  const createdMovement = await tx.stockMovement.create({
    data: {
      tenantId,
      number: seq.number,
      numberYear: year,
      type: input.type as any,
      productId: input.productId,
      batchId,
      fromLocationId,
      toLocationId,
      quantity: decimalFromNumber(input.quantity),
      presentationId: input.presentationId ?? null,
      presentationQuantity: input.presentationQuantity === undefined ? null : input.presentationQuantity === null ? null : decimalFromNumber(input.presentationQuantity),
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      note: input.note ?? null,
      createdAt: effectiveCreatedAt,
      createdBy: userId,
    },
    select: {
      id: true,
      number: true,
      numberYear: true,
      type: true,
      productId: true,
      batchId: true,
      fromLocationId: true,
      toLocationId: true,
      quantity: true,
      presentationId: true,
      presentationQuantity: true,
      createdAt: true,
      referenceType: true,
      referenceId: true,
    },
  })

  // Check for pending stock movement requests that can be fulfilled by IN movements
  if (input.type === 'IN' && toLocationId) {
    const location = await tx.location.findFirst({
      where: { id: toLocationId },
      select: { warehouse: { select: { city: true } } },
    })
    if (location?.warehouse?.city) {
      const warehouseCity = location.warehouse.city
      const pendingRequests = await tx.stockMovementRequest.findMany({
        where: {
          tenantId,
          status: 'OPEN',
          requestedCity: warehouseCity,
          items: {
            some: {
              productId: input.productId,
              remainingQuantity: { gt: 0 },
            },
          },
        },
        select: {
          id: true,
          items: {
            where: { productId: input.productId, remainingQuantity: { gt: 0 } },
            select: { id: true, remainingQuantity: true },
          },
        },
      })

      for (const req of pendingRequests) {
        let totalRemaining = req.items.reduce((sum, item) => sum + Number(item.remainingQuantity), 0)
        if (totalRemaining <= input.quantity) {
          // Fulfill the request
          await tx.stockMovementRequest.update({
            where: { id: req.id },
            data: {
              status: 'FULFILLED',
              fulfilledAt: new Date(),
              fulfilledBy: input.userId,
            },
          })
          // Update remaining quantities to 0
          for (const item of req.items) {
            await tx.stockMovementRequestItem.update({
              where: { id: item.id },
              data: { remainingQuantity: 0 },
            })
          }
        }
      }
    }
  }

  return { createdMovement, fromBalance, toBalance }
}
