import type { Prisma } from '../../generated/prisma/client.js'
import { currentYearUtc, nextSequence } from '../shared/sequence.js'

export type SupplyStockMovementCreateInput = {
  tenantId: string
  userId: string
  type: 'IN' | 'OUT' | 'TRANSFER' | 'ADJUSTMENT'
  supplyId: string
  lotId?: string | null
  fromLocationId?: string | null
  toLocationId?: string | null
  quantity: number
  presentationId?: string | null
  presentationQuantity?: number | null
  referenceType?: string | null
  referenceId?: string | null
  note?: string | null
}

type LockedBalanceRow = {
  id: string
  quantity: string
}

function decimalFromNumber(value: number): string {
  return value.toString()
}

export async function createSupplyStockMovementTx(
  tx: Prisma.TransactionClient,
  input: SupplyStockMovementCreateInput,
): Promise<{ createdMovement: any; fromBalance: any; toBalance: any }> {
  const tenantId = input.tenantId
  const userId = input.userId
  const lotId = input.lotId ?? null

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

  const supply = await tx.supply.findFirst({ where: { id: input.supplyId, tenantId, isActive: true }, select: { id: true } })
  if (!supply) throw Object.assign(new Error('Supply not found'), { statusCode: 404 })

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

  if (fromLocationId) await ensureLocation(fromLocationId, { mustBeActive: false })
  if (toLocationId) await ensureLocation(toLocationId, { mustBeActive: true })

  const lockBalanceSafe = async (locationId: string) => {
    if (lotId === null) {
      const rows = await tx.$queryRaw<LockedBalanceRow[]>`
        SELECT "id", "quantity" FROM "SupplyInventoryBalance"
        WHERE "tenantId" = ${tenantId} AND "locationId" = ${locationId} AND "supplyId" = ${input.supplyId} AND "lotId" IS NULL
        FOR UPDATE
      `
      return rows[0] ?? null
    }

    const rows = await tx.$queryRaw<LockedBalanceRow[]>`
      SELECT "id", "quantity" FROM "SupplyInventoryBalance"
      WHERE "tenantId" = ${tenantId} AND "locationId" = ${locationId} AND "supplyId" = ${input.supplyId} AND "lotId" = ${lotId}
      FOR UPDATE
    `
    return rows[0] ?? null
  }

  if (fromLocationId) await lockBalanceSafe(fromLocationId)
  if (toLocationId && toLocationId !== fromLocationId) await lockBalanceSafe(toLocationId)

  const upsertBalance = async (locationId: string, delta: number) => {
    const current = await tx.supplyInventoryBalance.findFirst({
      where: { tenantId, locationId, supplyId: input.supplyId, lotId },
      select: { id: true, quantity: true },
    })

    const currentQty = current ? Number(current.quantity) : 0
    const nextQty = currentQty + delta

    if (nextQty < 0) throw Object.assign(new Error('Insufficient stock'), { statusCode: 409 })

    if (!current) {
      return tx.supplyInventoryBalance.create({
        data: {
          tenantId,
          locationId,
          supplyId: input.supplyId,
          lotId,
          quantity: decimalFromNumber(nextQty),
          createdBy: userId,
        },
        select: { id: true, quantity: true, locationId: true, supplyId: true, lotId: true, version: true, updatedAt: true },
      })
    }

    return tx.supplyInventoryBalance.update({
      where: { id: current.id },
      data: { quantity: decimalFromNumber(nextQty), version: { increment: 1 }, createdBy: userId },
      select: { id: true, quantity: true, locationId: true, supplyId: true, lotId: true, version: true, updatedAt: true },
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

  const year = currentYearUtc()
  const seq = await nextSequence(tx, { tenantId, year, key: 'SM' })

  const createdMovement = await tx.supplyStockMovement.create({
    data: {
      tenantId,
      number: seq.number,
      numberYear: year,
      type: input.type as any,
      supplyId: input.supplyId,
      lotId,
      fromLocationId,
      toLocationId,
      quantity: decimalFromNumber(input.quantity),
      presentationId: input.presentationId ?? null,
      presentationQuantity:
        input.presentationQuantity === undefined
          ? null
          : input.presentationQuantity === null
            ? null
            : decimalFromNumber(input.presentationQuantity),
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      note: input.note ?? null,
      createdBy: userId,
    },
    select: {
      id: true,
      number: true,
      numberYear: true,
      type: true,
      supplyId: true,
      lotId: true,
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

  return { createdMovement, fromBalance, toBalance }
}
