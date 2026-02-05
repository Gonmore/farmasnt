import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { requireAuth, requireModuleEnabled, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'
import { currentYearUtc, nextSequence } from '../../../application/shared/sequence.js'
import { createSupplyStockMovementTx } from '../../../application/laboratory/supplyStockMovementService.js'
import { createStockMovementTx } from '../../../application/stock/stockMovementService.js'

const listQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
})

const updateLaboratorySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  city: z.string().trim().min(1).max(120).optional().nullable(),
  isActive: z.boolean().optional(),
  defaultLocationId: z.string().uuid().optional().nullable(),
  rawMaterialsLocationId: z.string().uuid().optional().nullable(),
  wipLocationId: z.string().uuid().optional().nullable(),
  maintenanceLocationId: z.string().uuid().optional().nullable(),
  outputWarehouseId: z.string().uuid().optional().nullable(),
  quarantineLocationId: z.string().uuid().optional().nullable(),
})

const createLaboratorySchema = z.object({
  warehouseId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  city: z.string().trim().min(1).max(120).optional().nullable(),
  outputWarehouseId: z.string().uuid().optional().nullable(),
  quarantineLocationId: z.string().uuid().optional().nullable(),
})

const supplyCategorySchema = z.enum(['RAW_MATERIAL', 'MAINTENANCE'])
const supplyListQuerySchema = listQuerySchema.extend({
  category: supplyCategorySchema.optional(),
})

const createSupplySchema = z.object({
  code: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(200),
  category: supplyCategorySchema.optional(),
  baseUnit: z.string().trim().min(1).max(32),
})

const updateSupplySchema = z.object({
  code: z.string().trim().min(1).max(64).optional().nullable(),
  name: z.string().trim().min(1).max(200).optional(),
  baseUnit: z.string().trim().min(1).max(32).optional(),
  isActive: z.boolean().optional(),
})

const supplyBalancesQuerySchema = z.object({
  supplyId: z.string().uuid(),
  locationId: z.string().uuid().optional(),
})

const qcQuarantineBatchesQuerySchema = listQuerySchema.extend({
  productId: z.string().uuid().optional(),
})

const productionRunStatusSchema = z.enum(['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
const productionRunListQuerySchema = listQuerySchema.extend({
  status: productionRunStatusSchema.optional(),
})

const createPurchaseListSchema = z.object({
  laboratoryId: z.string().uuid().optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
  lines: z
    .array(
      z.object({
        supplyId: z.string().uuid(),
        requestedQuantity: z.coerce.number().positive(),
        unit: z.string().trim().min(1).max(32),
        vendorName: z.string().trim().max(200).optional().nullable(),
        sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
        note: z.string().trim().max(2000).optional().nullable(),
      }),
    )
    .min(1),
})

const createReceiptSchema = z.object({
  laboratoryId: z.string().uuid().optional().nullable(),
  purchaseListId: z.string().uuid().optional().nullable(),
  vendorName: z.string().trim().max(200).optional().nullable(),
  vendorDocument: z.string().trim().max(120).optional().nullable(),
  receivedAt: z.coerce.date().optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
  lines: z
    .array(
      z.object({
        supplyId: z.string().uuid(),
        purchaseListLineId: z.string().uuid().optional().nullable(),
        quantity: z.coerce.number().positive(),
        unit: z.string().trim().min(1).max(32),
        presentationId: z.string().uuid().optional().nullable(),
        presentationQuantity: z.coerce.number().optional().nullable(),
        lotNumber: z.string().trim().max(120).optional().nullable(),
        expiresAt: z.coerce.date().optional().nullable(),
        note: z.string().trim().max(2000).optional().nullable(),
      }),
    )
    .min(1),
})

const createRecipeSchema = z.object({
  productId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  outputQuantity: z.coerce.number().positive().optional().nullable(),
  outputUnit: z.string().trim().min(1).max(32).optional().nullable(),
  estimatedDurationHours: z.coerce.number().int().min(1).max(24 * 365).optional().nullable(),
  items: z
    .array(
      z.object({
        supplyId: z.string().uuid(),
        quantity: z.coerce.number().positive(),
        unit: z.string().trim().min(1).max(32),
        sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
        note: z.string().trim().max(2000).optional().nullable(),
      }),
    )
    .min(1),
})

const updateRecipeSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  outputQuantity: z.coerce.number().positive().optional().nullable(),
  outputUnit: z.string().trim().min(1).max(32).optional().nullable(),
  estimatedDurationHours: z.coerce.number().int().min(1).max(24 * 365).optional().nullable(),
  isActive: z.boolean().optional(),
  items: z
    .array(
      z.object({
        supplyId: z.string().uuid(),
        quantity: z.coerce.number().positive(),
        unit: z.string().trim().min(1).max(32),
        sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
        note: z.string().trim().max(2000).optional().nullable(),
      }),
    )
    .min(1)
    .optional(),
})

const createProductionRequestSchema = z.object({
  laboratoryId: z.string().uuid(),
  productId: z.string().uuid(),
  recipeId: z.string().uuid(),
  requestedOutputQuantity: z.coerce.number().positive(),
  outputUnit: z.string().trim().min(1).max(32),
  neededBy: z.coerce.date().optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
})

const cancelRequestSchema = z.object({
  note: z.string().trim().max(2000).optional().nullable(),
})

const createProductionRunSchema = z.object({
  requestId: z.string().uuid().optional().nullable(),
  laboratoryId: z.string().uuid().optional().nullable(),
  productId: z.string().uuid().optional().nullable(),
  recipeId: z.string().uuid().optional().nullable(),
  plannedOutputQuantity: z.coerce.number().positive().optional().nullable(),
  outputUnit: z.string().trim().min(1).max(32).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
})

const completeRunSchema = z.object({
  note: z.string().trim().max(2000).optional().nullable(),
  inputs: z
    .array(
      z.object({
        supplyId: z.string().uuid(),
        lotId: z.string().uuid().optional().nullable(),
        fromLocationId: z.string().uuid().optional().nullable(),
        quantity: z.coerce.number().positive(),
        unit: z.string().trim().min(1).max(32),
        note: z.string().trim().max(2000).optional().nullable(),
      }),
    )
    .optional(),
  waste: z
    .array(
      z.object({
        supplyId: z.string().uuid().optional().nullable(),
        lotId: z.string().uuid().optional().nullable(),
        fromLocationId: z.string().uuid().optional().nullable(),
        quantity: z.coerce.number().positive(),
        unit: z.string().trim().min(1).max(32),
        reason: z.string().trim().max(500).optional().nullable(),
      }),
    )
    .optional(),
  outputs: z
    .array(
      z.object({
        batchNumber: z.string().trim().min(1).max(120),
        quantity: z.coerce.number().positive(),
        unit: z.string().trim().min(1).max(32),
        manufacturingDate: z.coerce.date().optional().nullable(),
        expiresAt: z.coerce.date().optional().nullable(),
        presentationId: z.string().uuid().optional().nullable(),
      }),
    )
    .min(1),
})

const releaseBatchSchema = z.object({
  qcNote: z.string().trim().max(2000).optional().nullable(),
})

const updateProductionRunSchema = z.object({
  note: z.string().trim().max(2000).optional().nullable(),
  estimatedCompleteAt: z.coerce.date().optional().nullable(),
})

async function ensureLocationByCode(
  tx: any,
  args: { tenantId: string; userId: string; warehouseId: string; code: string },
) {
  const existing = await tx.location.findFirst({
    where: { tenantId: args.tenantId, warehouseId: args.warehouseId, code: args.code },
    select: { id: true },
  })
  if (existing) return existing
  return tx.location.create({
    data: { tenantId: args.tenantId, warehouseId: args.warehouseId, code: args.code, type: 'BIN', createdBy: args.userId },
    select: { id: true },
  })
}

export async function registerLaboratoryRoutes(app: FastifyInstance): Promise<void> {
  const db = prisma()
  const readGuard = [requireAuth(), requireModuleEnabled(db, 'LABORATORY'), requirePermission(Permissions.StockRead)]
  const writeGuard = [requireAuth(), requireModuleEnabled(db, 'LABORATORY'), requirePermission(Permissions.StockManage)]

  // Laboratories
  app.get('/api/v1/laboratories', { preHandler: readGuard }, async (request, reply) => {
    const tenantId = request.auth!.tenantId

    const items = await db.laboratory.findMany({
      where: { tenantId },
      take: 200,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        city: true,
        isActive: true,
        warehouseId: true,
        defaultLocationId: true,
        rawMaterialsLocationId: true,
        wipLocationId: true,
        maintenanceLocationId: true,
        outputWarehouseId: true,
        quarantineLocationId: true,
        updatedAt: true,
        warehouse: { select: { id: true, code: true, name: true, city: true } },
        defaultLocation: { select: { id: true, code: true, warehouseId: true } },
        rawMaterialsLocation: { select: { id: true, code: true, warehouseId: true } },
        wipLocation: { select: { id: true, code: true, warehouseId: true } },
        maintenanceLocation: { select: { id: true, code: true, warehouseId: true } },
        outputWarehouse: { select: { id: true, code: true, name: true, city: true } },
        quarantineLocation: { select: { id: true, code: true, warehouseId: true } },
      },
    })

    return reply.send({ items })
  })

  app.post('/api/v1/laboratories', { preHandler: writeGuard }, async (request, reply) => {
    const parsed = createLaboratorySchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId
    const userId = request.auth!.userId

    const created = await db.$transaction(async (tx) => {
      const warehouse = await tx.warehouse.findFirst({
        where: { tenantId, id: parsed.data.warehouseId, isActive: true },
        select: { id: true },
      })
      if (!warehouse) throw Object.assign(new Error('Warehouse not found'), { statusCode: 404 })

      if (parsed.data.outputWarehouseId) {
        const out = await tx.warehouse.findFirst({ where: { tenantId, id: parsed.data.outputWarehouseId, isActive: true }, select: { id: true } })
        if (!out) throw Object.assign(new Error('Output warehouse not found'), { statusCode: 404 })
      }

      if (parsed.data.quarantineLocationId) {
        const q = await tx.location.findFirst({ where: { tenantId, id: parsed.data.quarantineLocationId, isActive: true }, select: { id: true } })
        if (!q) throw Object.assign(new Error('Quarantine location not found'), { statusCode: 404 })
      }

      const rawLoc = await ensureLocationByCode(tx, { tenantId, userId, warehouseId: warehouse.id, code: 'MP-01' })
      const wipLoc = await ensureLocationByCode(tx, { tenantId, userId, warehouseId: warehouse.id, code: 'PROC-01' })
      const maintLoc = await ensureLocationByCode(tx, { tenantId, userId, warehouseId: warehouse.id, code: 'REP-01' })

      try {
        const lab = await tx.laboratory.create({
          data: {
            tenantId,
            warehouseId: warehouse.id,
            name: parsed.data.name,
            city: parsed.data.city ?? null,
            isActive: true,
            defaultLocationId: rawLoc.id,
            rawMaterialsLocationId: rawLoc.id,
            wipLocationId: wipLoc.id,
            maintenanceLocationId: maintLoc.id,
            outputWarehouseId: parsed.data.outputWarehouseId ?? null,
            quarantineLocationId: parsed.data.quarantineLocationId ?? null,
            createdBy: userId,
          },
          select: { id: true },
        })
        return lab
      } catch (e: any) {
        if (typeof e?.code === 'string' && e.code === 'P2002') {
          throw Object.assign(new Error('Laboratory already exists for this warehouse or city'), { statusCode: 409 })
        }
        throw e
      }
    })

    return reply.status(201).send({ id: created.id })
  })

  app.patch('/api/v1/laboratories/:id', { preHandler: writeGuard }, async (request, reply) => {
    const id = (request.params as any).id as string
    const parsed = updateLaboratorySchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId

    const updated = await db.laboratory.updateMany({
      where: { tenantId, id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.city !== undefined ? { city: parsed.data.city } : {}),
        ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
        ...(parsed.data.defaultLocationId !== undefined ? { defaultLocationId: parsed.data.defaultLocationId } : {}),
        ...(parsed.data.rawMaterialsLocationId !== undefined ? { rawMaterialsLocationId: parsed.data.rawMaterialsLocationId } : {}),
        ...(parsed.data.wipLocationId !== undefined ? { wipLocationId: parsed.data.wipLocationId } : {}),
        ...(parsed.data.maintenanceLocationId !== undefined ? { maintenanceLocationId: parsed.data.maintenanceLocationId } : {}),
        ...(parsed.data.outputWarehouseId !== undefined ? { outputWarehouseId: parsed.data.outputWarehouseId } : {}),
        ...(parsed.data.quarantineLocationId !== undefined ? { quarantineLocationId: parsed.data.quarantineLocationId } : {}),
        version: { increment: 1 },
        createdBy: request.auth!.userId,
      },
    })

    if (!updated.count) return reply.status(404).send({ message: 'Not found' })
    return reply.send({ ok: true })
  })

  // Supplies
  app.get('/api/v1/laboratory/supplies', { preHandler: readGuard }, async (request, reply) => {
    const parsed = supplyListQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId
    const category = parsed.data.category

    const items = await db.supply.findMany({
      where: { tenantId, ...(category ? { category } : {}) },
      take: parsed.data.take,
      ...(parsed.data.cursor
        ? {
            skip: 1,
            cursor: { id: parsed.data.cursor },
          }
        : {}),
      orderBy: { id: 'asc' },
      select: { id: true, code: true, name: true, category: true, baseUnit: true, isActive: true, version: true, updatedAt: true },
    })

    const nextCursor = items.length === parsed.data.take ? items[items.length - 1]!.id : null
    return reply.send({ items, nextCursor })
  })

  // Supply balances (for lot selection / consumption)
  app.get('/api/v1/laboratory/supply-balances', { preHandler: readGuard }, async (request, reply) => {
    const parsed = supplyBalancesQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId

    const items = await db.supplyInventoryBalance.findMany({
      where: {
        tenantId,
        supplyId: parsed.data.supplyId,
        quantity: { gt: 0 },
        ...(parsed.data.locationId ? { locationId: parsed.data.locationId } : {}),
      },
      orderBy: [{ locationId: 'asc' }, { lotId: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        quantity: true,
        locationId: true,
        lotId: true,
        location: { select: { id: true, code: true } },
        lot: { select: { id: true, lotNumber: true, expiresAt: true } },
      },
    })

    return reply.send({ items })
  })

  app.post('/api/v1/laboratory/supplies', { preHandler: writeGuard }, async (request, reply) => {
    const parsed = createSupplySchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId
    const category = parsed.data.category ?? 'RAW_MATERIAL'

    const created = await db.supply.create({
      data: {
        tenantId,
        code: parsed.data.code ?? null,
        name: parsed.data.name,
        category,
        baseUnit: parsed.data.baseUnit,
        createdBy: request.auth!.userId,
      },
      select: { id: true },
    })

    return reply.status(201).send({ id: created.id })
  })

  app.get('/api/v1/laboratory/supplies/:id', { preHandler: readGuard }, async (request, reply) => {
    const id = (request.params as any).id as string
    const tenantId = request.auth!.tenantId

    const item = await db.supply.findFirst({
      where: { tenantId, id },
      select: {
        id: true,
        code: true,
        name: true,
        baseUnit: true,
        isActive: true,
        updatedAt: true,
        presentations: { where: { tenantId }, orderBy: { name: 'asc' }, select: { id: true, name: true, multiplier: true, isActive: true } },
      },
    })

    if (!item) return reply.status(404).send({ message: 'Not found' })
    return reply.send({ item })
  })

  app.patch('/api/v1/laboratory/supplies/:id', { preHandler: writeGuard }, async (request, reply) => {
    const id = (request.params as any).id as string
    const parsed = updateSupplySchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId

    const updated = await db.supply.updateMany({
      where: { tenantId, id },
      data: {
        ...(parsed.data.code !== undefined ? { code: parsed.data.code } : {}),
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.baseUnit !== undefined ? { baseUnit: parsed.data.baseUnit } : {}),
        ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
        version: { increment: 1 },
        createdBy: request.auth!.userId,
      },
    })

    if (!updated.count) return reply.status(404).send({ message: 'Not found' })
    return reply.send({ ok: true })
  })

  // Purchase lists
  app.get('/api/v1/laboratory/purchase-lists', { preHandler: readGuard }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId

    const items = await db.supplyPurchaseList.findMany({
      where: { tenantId },
      take: parsed.data.take,
      ...(parsed.data.cursor
        ? {
            skip: 1,
            cursor: { id: parsed.data.cursor },
          }
        : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        number: true,
        numberYear: true,
        status: true,
        city: true,
        laboratoryId: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    const nextCursor = items.length === parsed.data.take ? items[items.length - 1]!.id : null
    return reply.send({ items, nextCursor })
  })

  app.post('/api/v1/laboratory/purchase-lists', { preHandler: writeGuard }, async (request, reply) => {
    const parsed = createPurchaseListSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId
    const userId = request.auth!.userId
    const year = currentYearUtc()

    const created = await db.$transaction(async (tx) => {
      const seq = await nextSequence(tx, { tenantId, year, key: 'SPL' })

      let city: string | null = null
      if (parsed.data.laboratoryId) {
        const lab = await tx.laboratory.findFirst({
          where: { tenantId, id: parsed.data.laboratoryId },
          select: { id: true, city: true, warehouse: { select: { city: true } } },
        })
        if (!lab) throw Object.assign(new Error('Laboratory not found'), { statusCode: 404 })
        city = lab.city ?? lab.warehouse.city ?? null
      }

      const purchaseList = await tx.supplyPurchaseList.create({
        data: {
          tenantId,
          laboratoryId: parsed.data.laboratoryId ?? null,
          city,
          number: seq.number,
          numberYear: year,
          note: parsed.data.note ?? null,
          createdBy: userId,
          lines: {
            create: parsed.data.lines.map((l, idx) => ({
              tenantId,
              supplyId: l.supplyId,
              requestedQuantity: String(l.requestedQuantity),
              unit: l.unit,
              vendorName: l.vendorName ?? null,
              sortOrder: l.sortOrder ?? idx,
              note: l.note ?? null,
              createdBy: userId,
            })),
          },
        },
        select: { id: true },
      })

      return purchaseList
    })

    return reply.status(201).send({ id: created.id })
  })

  app.get('/api/v1/laboratory/purchase-lists/:id', { preHandler: readGuard }, async (request, reply) => {
    const id = (request.params as any).id as string
    const tenantId = request.auth!.tenantId

    const item = await db.supplyPurchaseList.findFirst({
      where: { tenantId, id },
      select: {
        id: true,
        number: true,
        numberYear: true,
        status: true,
        city: true,
        laboratoryId: true,
        note: true,
        createdAt: true,
        updatedAt: true,
        lines: {
          where: { tenantId },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { id: true, supplyId: true, requestedQuantity: true, unit: true, vendorName: true, note: true, sortOrder: true, supply: { select: { name: true, baseUnit: true } } },
        },
      },
    })

    if (!item) return reply.status(404).send({ message: 'Not found' })

    const lineIds = item.lines.map((l) => l.id)
    const receivedByLine = lineIds.length
      ? await db.supplyReceiptLine.groupBy({
          by: ['purchaseListLineId'],
          where: {
            tenantId,
            purchaseListLineId: { in: lineIds },
            receipt: { status: 'POSTED' },
          } as any,
          _sum: { quantity: true },
        })
      : []

    const receivedMap = new Map(
      receivedByLine
        .filter((r) => r.purchaseListLineId)
        .map((r) => [r.purchaseListLineId as string, String(r._sum.quantity ?? '0')]),
    )

    const lines = item.lines.map((l) => ({
      ...l,
      requestedQuantity: String(l.requestedQuantity),
      receivedQuantity: receivedMap.get(l.id) ?? '0',
    }))

    return reply.send({ item: { ...item, lines } })
  })

  // Receipts
  app.get('/api/v1/laboratory/receipts', { preHandler: readGuard }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId

    const items = await db.supplyReceipt.findMany({
      where: { tenantId },
      take: parsed.data.take,
      ...(parsed.data.cursor
        ? {
            skip: 1,
            cursor: { id: parsed.data.cursor },
          }
        : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        number: true,
        numberYear: true,
        status: true,
        laboratoryId: true,
        purchaseListId: true,
        vendorName: true,
        receivedAt: true,
        postedAt: true,
        createdAt: true,
      },
    })

    const nextCursor = items.length === parsed.data.take ? items[items.length - 1]!.id : null
    return reply.send({ items, nextCursor })
  })

  app.post('/api/v1/laboratory/receipts', { preHandler: writeGuard }, async (request, reply) => {
    const parsed = createReceiptSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId
    const userId = request.auth!.userId
    const year = currentYearUtc()

    const created = await db.$transaction(async (tx) => {
      const seq = await nextSequence(tx, { tenantId, year, key: 'SRC' })

      const receipt = await tx.supplyReceipt.create({
        data: {
          tenantId,
          laboratoryId: parsed.data.laboratoryId ?? null,
          purchaseListId: parsed.data.purchaseListId ?? null,
          number: seq.number,
          numberYear: year,
          vendorName: parsed.data.vendorName ?? null,
          vendorDocument: parsed.data.vendorDocument ?? null,
          receivedAt: parsed.data.receivedAt ?? null,
          note: parsed.data.note ?? null,
          createdBy: userId,
          lines: {
            create: parsed.data.lines.map((l) => ({
              tenantId,
              supplyId: l.supplyId,
              purchaseListLineId: l.purchaseListLineId ?? null,
              quantity: String(l.quantity),
              unit: l.unit,
              presentationId: l.presentationId ?? null,
              presentationQuantity: l.presentationQuantity == null ? null : String(l.presentationQuantity),
              lotNumber: l.lotNumber ?? null,
              expiresAt: l.expiresAt ?? null,
              note: l.note ?? null,
              createdBy: userId,
            })),
          },
        },
        select: { id: true },
      })

      return receipt
    })

    return reply.status(201).send({ id: created.id })
  })

  app.get('/api/v1/laboratory/receipts/:id', { preHandler: readGuard }, async (request, reply) => {
    const id = (request.params as any).id as string
    const tenantId = request.auth!.tenantId

    const item = await db.supplyReceipt.findFirst({
      where: { tenantId, id },
      select: {
        id: true,
        number: true,
        numberYear: true,
        status: true,
        vendorName: true,
        vendorDocument: true,
        receivedAt: true,
        postedAt: true,
        note: true,
        laboratoryId: true,
        purchaseListId: true,
        createdAt: true,
        updatedAt: true,
        lines: {
          where: { tenantId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            supplyId: true,
            purchaseListLineId: true,
            lotId: true,
            lotNumber: true,
            expiresAt: true,
            quantity: true,
            unit: true,
            note: true,
            supply: { select: { name: true, baseUnit: true } },
          },
        },
      },
    })

    if (!item) return reply.status(404).send({ message: 'Not found' })
    return reply.send({ item })
  })

  app.post('/api/v1/laboratory/receipts/:id/post', { preHandler: writeGuard }, async (request, reply) => {
    const id = (request.params as any).id as string
    const tenantId = request.auth!.tenantId
    const userId = request.auth!.userId

    const result = await db.$transaction(async (tx) => {
      const receipt = await tx.supplyReceipt.findFirst({
        where: { tenantId, id },
        select: {
          id: true,
          status: true,
          laboratoryId: true,
          vendorName: true,
          receivedAt: true,
          postedAt: true,
          lines: {
            where: { tenantId },
            select: {
              id: true,
              supplyId: true,
              lotId: true,
              lotNumber: true,
              expiresAt: true,
              quantity: true,
              unit: true,
              presentationId: true,
              presentationQuantity: true,
            },
          },
        },
      })

      if (!receipt) throw Object.assign(new Error('Not found'), { statusCode: 404 })
      if (receipt.status !== 'DRAFT') throw Object.assign(new Error('Receipt is not in DRAFT status'), { statusCode: 409 })
      if (!receipt.laboratoryId) throw Object.assign(new Error('laboratoryId is required to post a receipt'), { statusCode: 400 })

      const lab = await tx.laboratory.findFirst({
        where: { tenantId, id: receipt.laboratoryId },
        select: { id: true, defaultLocationId: true },
      })
      if (!lab) throw Object.assign(new Error('Laboratory not found'), { statusCode: 404 })
      if (!lab.defaultLocationId) throw Object.assign(new Error('Laboratory defaultLocationId is not configured'), { statusCode: 409 })

      const createdMovements: any[] = []

      for (const line of receipt.lines) {
        let lotId = line.lotId ?? null

        if (!lotId && line.lotNumber) {
          const lot = await tx.supplyLot.upsert({
            where: { tenantId_supplyId_lotNumber: { tenantId, supplyId: line.supplyId, lotNumber: line.lotNumber } },
            create: {
              tenantId,
              supplyId: line.supplyId,
              lotNumber: line.lotNumber,
              expiresAt: line.expiresAt ?? null,
              receivedAt: receipt.receivedAt ?? new Date(),
              vendorName: receipt.vendorName ?? null,
              createdBy: userId,
            },
            update: {
              ...(line.expiresAt ? { expiresAt: line.expiresAt } : {}),
              ...(receipt.receivedAt ? { receivedAt: receipt.receivedAt } : {}),
              ...(receipt.vendorName ? { vendorName: receipt.vendorName } : {}),
              version: { increment: 1 },
              createdBy: userId,
            },
            select: { id: true },
          })
          lotId = lot.id

          await tx.supplyReceiptLine.update({
            where: { id: line.id },
            data: { lotId },
          })
        }

        const qty = Number(line.quantity)
        const created = await createSupplyStockMovementTx(tx as any, {
          tenantId,
          userId,
          type: 'IN',
          supplyId: line.supplyId,
          lotId,
          toLocationId: lab.defaultLocationId,
          quantity: qty,
          presentationId: line.presentationId ?? null,
          presentationQuantity: line.presentationQuantity == null ? null : Number(line.presentationQuantity),
          referenceType: 'SUPPLY_RECEIPT',
          referenceId: receipt.id,
          note: null,
        })

        createdMovements.push(created.createdMovement)
      }

      await tx.supplyReceipt.update({
        where: { id: receipt.id },
        data: {
          status: 'POSTED',
          postedAt: new Date(),
          receivedAt: receipt.receivedAt ?? new Date(),
          version: { increment: 1 },
          createdBy: userId,
        },
        select: { id: true },
      })

      return { receiptId: receipt.id, movements: createdMovements }
    })

    return reply.send(result)
  })

  // Recipes
  app.get('/api/v1/laboratory/recipes', { preHandler: readGuard }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId

    const items = await db.labRecipe.findMany({
      where: { tenantId },
      take: parsed.data.take,
      ...(parsed.data.cursor
        ? {
            skip: 1,
            cursor: { id: parsed.data.cursor },
          }
        : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        productId: true,
        name: true,
        outputQuantity: true,
        outputUnit: true,
        isActive: true,
        updatedAt: true,
        product: { select: { sku: true, name: true } },
      },
    })

    const nextCursor = items.length === parsed.data.take ? items[items.length - 1]!.id : null
    return reply.send({ items, nextCursor })
  })

  app.post('/api/v1/laboratory/recipes', { preHandler: writeGuard }, async (request, reply) => {
    const parsed = createRecipeSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId
    const userId = request.auth!.userId

    try {
      const created = await db.$transaction(async (tx) => {
        const product = await tx.product.findFirst({ where: { tenantId, id: parsed.data.productId, isActive: true }, select: { id: true } })
        if (!product) throw Object.assign(new Error('Product not found'), { statusCode: 404 })

        // Unique: one recipe per product
        const existing = await tx.labRecipe.findFirst({ where: { tenantId, productId: parsed.data.productId }, select: { id: true } })
        if (existing) throw Object.assign(new Error('Recipe already exists for product'), { statusCode: 409 })

        const recipe = await tx.labRecipe.create({
          data: {
            tenantId,
            productId: parsed.data.productId,
            name: parsed.data.name,
            outputQuantity: parsed.data.outputQuantity == null ? null : String(parsed.data.outputQuantity),
            outputUnit: parsed.data.outputUnit ?? null,
            createdBy: userId,
            items: {
              create: parsed.data.items.map((it, idx) => ({
                tenantId,
                supplyId: it.supplyId,
                quantity: String(it.quantity),
                unit: it.unit,
                sortOrder: it.sortOrder ?? idx,
                note: it.note ?? null,
                createdBy: userId,
              })),
            },
          },
          select: { id: true },
        })

        return recipe
      })

      return reply.status(201).send({ id: created.id })
    } catch (e: any) {
      if (e?.statusCode) return reply.status(e.statusCode).send({ message: e.message })
      throw e
    }
  })

  app.get('/api/v1/laboratory/recipes/:id', { preHandler: readGuard }, async (request, reply) => {
    const id = (request.params as any).id as string
    const tenantId = request.auth!.tenantId

    const item = await db.labRecipe.findFirst({
      where: { tenantId, id },
      select: {
        id: true,
        productId: true,
        name: true,
        outputQuantity: true,
        outputUnit: true,
        isActive: true,
        updatedAt: true,
        product: { select: { sku: true, name: true } },
        items: {
          where: { tenantId },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { id: true, supplyId: true, quantity: true, unit: true, sortOrder: true, note: true, supply: { select: { name: true, baseUnit: true } } },
        },
      },
    })

    if (!item) return reply.status(404).send({ message: 'Not found' })
    return reply.send({ item })
  })

  app.patch('/api/v1/laboratory/recipes/:id', { preHandler: writeGuard }, async (request, reply) => {
    const id = (request.params as any).id as string
    const parsed = updateRecipeSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId
    const userId = request.auth!.userId

    const updated = await db.$transaction(async (tx) => {
      const existing = await tx.labRecipe.findFirst({ where: { tenantId, id }, select: { id: true } })
      if (!existing) throw Object.assign(new Error('Not found'), { statusCode: 404 })

      const recipe = await tx.labRecipe.update({
        where: { id },
        data: {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.outputQuantity !== undefined
            ? { outputQuantity: parsed.data.outputQuantity == null ? null : String(parsed.data.outputQuantity) }
            : {}),
          ...(parsed.data.outputUnit !== undefined ? { outputUnit: parsed.data.outputUnit } : {}),
          ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
          version: { increment: 1 },
          createdBy: userId,
        },
        select: { id: true },
      })

      if (parsed.data.items) {
        await tx.labRecipeItem.deleteMany({ where: { tenantId, recipeId: id } })
        await tx.labRecipeItem.createMany({
          data: parsed.data.items.map((it, idx) => ({
            tenantId,
            recipeId: id,
            supplyId: it.supplyId,
            quantity: String(it.quantity),
            unit: it.unit,
            sortOrder: it.sortOrder ?? idx,
            note: it.note ?? null,
            createdBy: userId,
            version: 1,
            updatedAt: new Date(),
          } as any)),
        })
      }

      return recipe
    })

    return reply.send({ ok: true, id: updated.id })
  })

  // Production requests
  app.get('/api/v1/laboratory/production-requests', { preHandler: readGuard }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId

    const items = await db.labProductionRequest.findMany({
      where: { tenantId },
      take: parsed.data.take,
      ...(parsed.data.cursor
        ? {
            skip: 1,
            cursor: { id: parsed.data.cursor },
          }
        : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        laboratoryId: true,
        productId: true,
        recipeId: true,
        requestedOutputQuantity: true,
        outputUnit: true,
        status: true,
        neededBy: true,
        createdAt: true,
        updatedAt: true,
        laboratory: { select: { id: true, name: true, city: true } },
        product: { select: { sku: true, name: true } },
        recipe: { select: { name: true } },
      },
    })

    const nextCursor = items.length === parsed.data.take ? items[items.length - 1]!.id : null
    return reply.send({ items, nextCursor })
  })

  app.post('/api/v1/laboratory/production-requests', { preHandler: writeGuard }, async (request, reply) => {
    const parsed = createProductionRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId
    const userId = request.auth!.userId

    const created = await db.$transaction(async (tx) => {
      const lab = await tx.laboratory.findFirst({ where: { tenantId, id: parsed.data.laboratoryId, isActive: true }, select: { id: true } })
      if (!lab) throw Object.assign(new Error('Laboratory not found'), { statusCode: 404 })

      const product = await tx.product.findFirst({ where: { tenantId, id: parsed.data.productId, isActive: true }, select: { id: true } })
      if (!product) throw Object.assign(new Error('Product not found'), { statusCode: 404 })

      const recipe = await tx.labRecipe.findFirst({
        where: { tenantId, id: parsed.data.recipeId, productId: parsed.data.productId, isActive: true },
        select: { id: true },
      })
      if (!recipe) throw Object.assign(new Error('Recipe not found or inactive for product'), { statusCode: 404 })

      const req = await tx.labProductionRequest.create({
        data: {
          tenantId,
          laboratoryId: parsed.data.laboratoryId,
          productId: parsed.data.productId,
          recipeId: parsed.data.recipeId,
          requestedOutputQuantity: String(parsed.data.requestedOutputQuantity),
          outputUnit: parsed.data.outputUnit,
          neededBy: parsed.data.neededBy ?? null,
          note: parsed.data.note ?? null,
          createdBy: userId,
        },
        select: { id: true },
      })
      return req
    })

    return reply.status(201).send({ id: created.id })
  })

  app.get('/api/v1/laboratory/production-requests/:id', { preHandler: readGuard }, async (request, reply) => {
    const id = (request.params as any).id as string
    const tenantId = request.auth!.tenantId

    const item = await db.labProductionRequest.findFirst({
      where: { tenantId, id },
      select: {
        id: true,
        laboratoryId: true,
        productId: true,
        recipeId: true,
        requestedOutputQuantity: true,
        outputUnit: true,
        status: true,
        neededBy: true,
        note: true,
        cancelledAt: true,
        cancelledBy: true,
        createdAt: true,
        updatedAt: true,
        laboratory: { select: { id: true, name: true, city: true } },
        product: { select: { sku: true, name: true } },
        recipe: { select: { id: true, name: true, items: { where: { tenantId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, supplyId: true, quantity: true, unit: true } } } },
        runs: { where: { tenantId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, status: true, createdAt: true, startedAt: true, completedAt: true } },
      },
    })

    if (!item) return reply.status(404).send({ message: 'Not found' })
    return reply.send({ item })
  })

  app.post('/api/v1/laboratory/production-requests/:id/approve', { preHandler: writeGuard }, async (request, reply) => {
    const id = (request.params as any).id as string
    const tenantId = request.auth!.tenantId
    const userId = request.auth!.userId

    const updated = await db.$transaction(async (tx) => {
      const req = await tx.labProductionRequest.findFirst({ where: { tenantId, id }, select: { id: true, status: true } })
      if (!req) throw Object.assign(new Error('Not found'), { statusCode: 404 })
      if (req.status !== 'DRAFT') throw Object.assign(new Error('Only DRAFT requests can be approved'), { statusCode: 409 })

      await tx.labProductionRequest.update({
        where: { id },
        data: { status: 'APPROVED', version: { increment: 1 }, createdBy: userId },
        select: { id: true },
      })

      return { id }
    })

    return reply.send({ ok: true, id: updated.id })
  })

  app.post('/api/v1/laboratory/production-requests/:id/cancel', { preHandler: writeGuard }, async (request, reply) => {
    const id = (request.params as any).id as string
    const parsed = cancelRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId
    const userId = request.auth!.userId

    const updated = await db.$transaction(async (tx) => {
      const req = await tx.labProductionRequest.findFirst({ where: { tenantId, id }, select: { id: true, status: true } })
      if (!req) throw Object.assign(new Error('Not found'), { statusCode: 404 })
      if (req.status === 'COMPLETED' || req.status === 'CANCELLED') throw Object.assign(new Error('Request cannot be cancelled'), { statusCode: 409 })

      await tx.labProductionRequest.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledBy: userId,
          ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
          version: { increment: 1 },
          createdBy: userId,
        },
        select: { id: true },
      })

      return { id }
    })

    return reply.send({ ok: true, id: updated.id })
  })

  // Production runs
  app.get('/api/v1/laboratory/production-runs', { preHandler: readGuard }, async (request, reply) => {
    const parsed = productionRunListQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId

    const items = await db.labProductionRun.findMany({
      where: { tenantId, ...(parsed.data.status ? { status: parsed.data.status } : {}) },
      take: parsed.data.take,
      ...(parsed.data.cursor
        ? {
            skip: 1,
            cursor: { id: parsed.data.cursor },
          }
        : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        laboratoryId: true,
        requestId: true,
        recipeId: true,
        productId: true,
        plannedOutputQuantity: true,
        outputUnit: true,
        actualOutputQuantity: true,
        status: true,
        startedAt: true,
        estimatedCompleteAt: true,
        completedAt: true,
        note: true,
        createdAt: true,
        laboratory: { select: { id: true, name: true, city: true } },
        product: { select: { sku: true, name: true } },
        recipe: { select: { name: true } },
      },
    })

    const nextCursor = items.length === parsed.data.take ? items[items.length - 1]!.id : null
    return reply.send({ items, nextCursor })
  })

  app.post('/api/v1/laboratory/production-runs', { preHandler: writeGuard }, async (request, reply) => {
    const parsed = createProductionRunSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId
    const userId = request.auth!.userId

    const created = await db.$transaction(async (tx) => {
      if (parsed.data.requestId) {
        const req = await tx.labProductionRequest.findFirst({
          where: { tenantId, id: parsed.data.requestId },
          select: { id: true, status: true, laboratoryId: true, recipeId: true, productId: true, outputUnit: true, requestedOutputQuantity: true },
        })
        if (!req) throw Object.assign(new Error('Request not found'), { statusCode: 404 })
        if (req.status !== 'APPROVED') throw Object.assign(new Error('Only APPROVED requests can create runs'), { statusCode: 409 })

        const run = await tx.labProductionRun.create({
          data: {
            tenantId,
            laboratoryId: req.laboratoryId,
            requestId: req.id,
            recipeId: req.recipeId,
            productId: req.productId,
            plannedOutputQuantity: String(parsed.data.plannedOutputQuantity ?? Number(req.requestedOutputQuantity)),
            outputUnit: parsed.data.outputUnit ?? req.outputUnit,
            note: parsed.data.note ?? null,
            createdBy: userId,
          },
          select: { id: true },
        })

        await tx.labProductionRequest.update({
          where: { id: req.id },
          data: { status: 'IN_PROGRESS', version: { increment: 1 }, createdBy: userId },
          select: { id: true },
        })

        return run
      }

      if (!parsed.data.laboratoryId || !parsed.data.recipeId || !parsed.data.productId) {
        throw Object.assign(new Error('Either requestId or (laboratoryId, recipeId, productId) are required'), { statusCode: 400 })
      }

      const lab = await tx.laboratory.findFirst({ where: { tenantId, id: parsed.data.laboratoryId, isActive: true }, select: { id: true } })
      if (!lab) throw Object.assign(new Error('Laboratory not found'), { statusCode: 404 })

      const recipe = await tx.labRecipe.findFirst({
        where: { tenantId, id: parsed.data.recipeId, productId: parsed.data.productId, isActive: true },
        select: { id: true },
      })
      if (!recipe) throw Object.assign(new Error('Recipe not found or inactive for product'), { statusCode: 404 })

      const run = await tx.labProductionRun.create({
        data: {
          tenantId,
          laboratoryId: parsed.data.laboratoryId,
          requestId: null,
          recipeId: parsed.data.recipeId,
          productId: parsed.data.productId,
          plannedOutputQuantity: parsed.data.plannedOutputQuantity == null ? null : String(parsed.data.plannedOutputQuantity),
          outputUnit: parsed.data.outputUnit ?? null,
          note: parsed.data.note ?? null,
          createdBy: userId,
        },
        select: { id: true },
      })

      return run
    })

    return reply.status(201).send({ id: created.id })
  })

  app.get('/api/v1/laboratory/production-runs/:id', { preHandler: readGuard }, async (request, reply) => {
    const id = (request.params as any).id as string
    const tenantId = request.auth!.tenantId

    const item = await db.labProductionRun.findFirst({
      where: { tenantId, id },
      select: {
        id: true,
        laboratoryId: true,
        requestId: true,
        recipeId: true,
        productId: true,
        plannedOutputQuantity: true,
        outputUnit: true,
        actualOutputQuantity: true,
        status: true,
        startedAt: true,
        estimatedCompleteAt: true,
        completedAt: true,
        note: true,
        createdAt: true,
        updatedAt: true,
        laboratory: { select: { id: true, name: true, city: true, defaultLocationId: true, quarantineLocationId: true, outputWarehouseId: true } },
        product: { select: { sku: true, name: true } },
        recipe: { select: { id: true, name: true } },
        inputs: { where: { tenantId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, supplyId: true, lotId: true, quantity: true, unit: true, note: true, supply: { select: { name: true, baseUnit: true } }, lot: { select: { lotNumber: true } } } },
        outputs: { where: { tenantId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, batchId: true, quantity: true, unit: true, batch: { select: { batchNumber: true, status: true, expiresAt: true, manufacturingDate: true } } } },
        waste: { where: { tenantId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, supplyId: true, lotId: true, quantity: true, unit: true, reason: true, supply: { select: { name: true } }, lot: { select: { lotNumber: true } } } },
      },
    })

    if (!item) return reply.status(404).send({ message: 'Not found' })
    return reply.send({ item })
  })

  app.patch('/api/v1/laboratory/production-runs/:id', { preHandler: writeGuard }, async (request, reply) => {
    const id = (request.params as any).id as string
    const parsed = updateProductionRunSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId
    const userId = request.auth!.userId

    const updated = await db.$transaction(async (tx) => {
      const run = await tx.labProductionRun.findFirst({ where: { tenantId, id }, select: { id: true, status: true } })
      if (!run) throw Object.assign(new Error('Not found'), { statusCode: 404 })
      if (run.status === 'COMPLETED' || run.status === 'CANCELLED') {
        throw Object.assign(new Error('Run cannot be updated'), { statusCode: 409 })
      }

      await tx.labProductionRun.update({
        where: { id },
        data: {
          ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
          ...(parsed.data.estimatedCompleteAt !== undefined ? { estimatedCompleteAt: parsed.data.estimatedCompleteAt } : {}),
          version: { increment: 1 },
          createdBy: userId,
        },
        select: { id: true },
      })

      return { id }
    })

    return reply.send({ ok: true, id: updated.id })
  })

  app.post('/api/v1/laboratory/production-runs/:id/start', { preHandler: writeGuard }, async (request, reply) => {
    const id = (request.params as any).id as string
    const tenantId = request.auth!.tenantId
    const userId = request.auth!.userId

    const updated = await db.$transaction(async (tx) => {
      const run = await tx.labProductionRun.findFirst({ where: { tenantId, id }, select: { id: true, status: true, recipeId: true, estimatedCompleteAt: true } })
      if (!run) throw Object.assign(new Error('Not found'), { statusCode: 404 })
      if (run.status !== 'DRAFT') throw Object.assign(new Error('Only DRAFT runs can be started'), { statusCode: 409 })

      const now = new Date()
      let estimatedCompleteAt: Date | null | undefined = undefined
      if (!run.estimatedCompleteAt) {
        const recipe = await tx.labRecipe.findFirst({ where: { tenantId, id: run.recipeId }, select: { estimatedDurationHours: true } })
        const hours = recipe?.estimatedDurationHours ?? null
        if (hours && hours > 0) {
          estimatedCompleteAt = new Date(now.getTime() + hours * 3600_000)
        }
      }

      await tx.labProductionRun.update({
        where: { id },
        data: {
          status: 'IN_PROGRESS',
          startedAt: now,
          ...(estimatedCompleteAt !== undefined ? { estimatedCompleteAt } : {}),
          version: { increment: 1 },
          createdBy: userId,
        },
        select: { id: true },
      })

      return { id }
    })

    return reply.send({ ok: true, id: updated.id })
  })

  app.post('/api/v1/laboratory/production-runs/:id/complete', { preHandler: writeGuard }, async (request, reply) => {
    const id = (request.params as any).id as string
    const parsed = completeRunSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId
    const userId = request.auth!.userId

    try {
      const result = await db.$transaction(async (tx) => {
        const run = await tx.labProductionRun.findFirst({
          where: { tenantId, id },
          select: { id: true, status: true, laboratoryId: true, requestId: true, productId: true, recipeId: true },
        })
        if (!run) throw Object.assign(new Error('Not found'), { statusCode: 404 })
        if (run.status !== 'IN_PROGRESS') throw Object.assign(new Error('Only IN_PROGRESS runs can be completed'), { statusCode: 409 })

        const lab = await tx.laboratory.findFirst({
          where: { tenantId, id: run.laboratoryId },
          select: { id: true, defaultLocationId: true, quarantineLocationId: true },
        })
        if (!lab) throw Object.assign(new Error('Laboratory not found'), { statusCode: 404 })
        if (!lab.quarantineLocationId) throw Object.assign(new Error('Laboratory quarantineLocationId is not configured'), { statusCode: 409 })

        const actualOutputQuantity = parsed.data.outputs.reduce((sum, o) => sum + o.quantity, 0)
        const createdBatches: any[] = []
        const createdProductMovements: any[] = []
        const createdSupplyMovements: any[] = []

        // Create supply OUT movements and persist inputs/waste
        if (parsed.data.inputs?.length) {
          for (const input of parsed.data.inputs) {
            const fromLocationId = input.fromLocationId ?? lab.defaultLocationId
            if (!fromLocationId) throw Object.assign(new Error('Laboratory defaultLocationId is not configured (input)'), { statusCode: 409 })

            await tx.labProductionRunInput.create({
              data: {
                tenantId,
                runId: run.id,
                supplyId: input.supplyId,
                lotId: input.lotId ?? null,
                quantity: String(input.quantity),
                unit: input.unit,
                note: input.note ?? null,
                createdBy: userId,
              },
              select: { id: true },
            })

            const created = await createSupplyStockMovementTx(tx as any, {
              tenantId,
              userId,
              type: 'OUT',
              supplyId: input.supplyId,
              lotId: input.lotId ?? null,
              fromLocationId,
              quantity: input.quantity,
              referenceType: 'LAB_PRODUCTION_RUN_INPUT',
              referenceId: run.id,
              note: input.note ?? null,
            })

            createdSupplyMovements.push(created.createdMovement)
          }
        }

        if (parsed.data.waste?.length) {
          for (const w of parsed.data.waste) {
            await tx.labProductionRunWaste.create({
              data: {
                tenantId,
                runId: run.id,
                supplyId: w.supplyId ?? null,
                lotId: w.lotId ?? null,
                quantity: String(w.quantity),
                unit: w.unit,
                reason: w.reason ?? null,
                createdBy: userId,
              },
              select: { id: true },
            })

            if (w.supplyId) {
              const fromLocationId = w.fromLocationId ?? lab.defaultLocationId
              if (!fromLocationId) throw Object.assign(new Error('Laboratory defaultLocationId is not configured (waste)'), { statusCode: 409 })

              const created = await createSupplyStockMovementTx(tx as any, {
                tenantId,
                userId,
                type: 'OUT',
                supplyId: w.supplyId,
                lotId: w.lotId ?? null,
                fromLocationId,
                quantity: w.quantity,
                referenceType: 'LAB_PRODUCTION_RUN_WASTE',
                referenceId: run.id,
                note: w.reason ?? null,
              })

              createdSupplyMovements.push(created.createdMovement)
            }
          }
        }

        // Create output batches in QUARANTINE and stock them into quarantine location.
        for (const out of parsed.data.outputs) {
          const batch = await tx.batch.create({
            data: {
              tenantId,
              productId: run.productId,
              batchNumber: out.batchNumber,
              manufacturingDate: out.manufacturingDate ?? new Date(),
              expiresAt: out.expiresAt ?? null,
              presentationId: out.presentationId ?? null,
              status: 'QUARANTINE',
              qcNote: null,
              sourceType: 'LAB_PRODUCTION_RUN',
              sourceId: run.id,
              createdBy: userId,
            },
            select: { id: true, batchNumber: true, status: true },
          })

          createdBatches.push(batch)

          await tx.labProductionRunOutput.create({
            data: {
              tenantId,
              runId: run.id,
              batchId: batch.id,
              quantity: String(out.quantity),
              unit: out.unit,
              createdBy: userId,
            },
            select: { id: true },
          })

          const movement = await createStockMovementTx(tx as any, {
            tenantId,
            userId,
            type: 'IN',
            productId: run.productId,
            batchId: batch.id,
            toLocationId: lab.quarantineLocationId,
            quantity: out.quantity,
            presentationId: out.presentationId ?? null,
            presentationQuantity: null,
            referenceType: 'LAB_PRODUCTION_RUN',
            referenceId: run.id,
            note: null,
          })

          createdProductMovements.push(movement.createdMovement)
        }

        await tx.labProductionRun.update({
          where: { id: run.id },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            actualOutputQuantity: String(actualOutputQuantity),
            ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
            version: { increment: 1 },
            createdBy: userId,
          },
          select: { id: true },
        })

        if (run.requestId) {
          await tx.labProductionRequest.updateMany({
            where: { tenantId, id: run.requestId, status: { in: ['IN_PROGRESS', 'APPROVED', 'DRAFT'] } as any },
            data: { status: 'COMPLETED', version: { increment: 1 }, createdBy: userId },
          })
        }

        return { runId: run.id, batches: createdBatches, productMovements: createdProductMovements, supplyMovements: createdSupplyMovements }
      })

      return reply.send(result)
    } catch (e: any) {
      if (typeof e?.code === 'string' && e.code === 'P2002') {
        return reply.status(409).send({ message: 'Batch number already exists for product' })
      }
      if (e?.statusCode) return reply.status(e.statusCode).send({ message: e.message })
      throw e
    }
  })

  // QC: release batches created by lab runs
  app.get('/api/v1/laboratory/qc/quarantine-batches', { preHandler: readGuard }, async (request, reply) => {
    const parsed = qcQuarantineBatchesQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId

    const items = await db.batch.findMany({
      where: {
        tenantId,
        status: 'QUARANTINE',
        sourceType: 'LAB_PRODUCTION_RUN',
        ...(parsed.data.productId ? { productId: parsed.data.productId } : {}),
      },
      take: parsed.data.take,
      ...(parsed.data.cursor
        ? {
            skip: 1,
            cursor: { id: parsed.data.cursor },
          }
        : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        productId: true,
        batchNumber: true,
        manufacturingDate: true,
        expiresAt: true,
        status: true,
        qcNote: true,
        qcReleasedAt: true,
        qcReleasedBy: true,
        sourceType: true,
        sourceId: true,
        createdAt: true,
        product: { select: { sku: true, name: true } },
      },
    })

    const nextCursor = items.length === parsed.data.take ? items[items.length - 1]!.id : null
    return reply.send({ items, nextCursor })
  })

  app.post('/api/v1/laboratory/batches/:batchId/release', { preHandler: writeGuard }, async (request, reply) => {
    const batchId = (request.params as any).batchId as string
    const parsed = releaseBatchSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

    const tenantId = request.auth!.tenantId
    const userId = request.auth!.userId

    const updated = await db.$transaction(async (tx) => {
      const batch = await tx.batch.findFirst({ where: { tenantId, id: batchId }, select: { id: true, status: true } })
      if (!batch) throw Object.assign(new Error('Batch not found'), { statusCode: 404 })
      if (batch.status !== 'QUARANTINE') throw Object.assign(new Error('Batch is not in QUARANTINE'), { statusCode: 409 })

      return tx.batch.update({
        where: { id: batchId },
        data: {
          status: 'RELEASED',
          qcReleasedAt: new Date(),
          qcReleasedBy: userId,
          qcRejectedAt: null,
          qcRejectedBy: null,
          quarantineUntil: null,
          qcNote: parsed.data.qcNote ?? null,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
        select: { id: true, status: true, qcReleasedAt: true, qcReleasedBy: true, qcNote: true, updatedAt: true },
      })
    })

    return reply.send({ item: updated })
  })
}
