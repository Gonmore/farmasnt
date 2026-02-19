import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { prisma } from '../../db/prisma.js'
import { AuditService } from '../../../application/audit/auditService.js'
import { requireAuth, requireModuleEnabled, requirePermission } from '../../../application/security/rbac.js'
import { Permissions } from '../../../application/security/permissions.js'
import { getEnv } from '../../../shared/env.js'

const listPaymentsQuerySchema = z.object({
  status: z.enum(['DUE', 'PAID', 'ALL']).default('DUE'),
  take: z.coerce.number().int().min(1).max(200).default(100),
})

const paymentProofPresignSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(100),
})

const markPaidSchema = z.object({
  version: z.number().int().positive(),
  paymentReceiptType: z.enum(['CASH', 'TRANSFER_QR']).optional(),
  paymentReceiptRef: z.string().trim().max(120).optional(),
  paymentReceiptPhotoUrl: z.string().trim().max(2000).optional(),
  paymentReceiptPhotoKey: z.string().trim().max(500).optional(),
})

function addDaysUtc(date: Date, days: number): Date {
  const ms = date.getTime() + Math.max(0, days) * 24 * 60 * 60 * 1000
  return new Date(ms)
}

function toNumber(value: any): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function parseCreditDays(paymentMode: string): number {
  const mode = (paymentMode ?? '').trim().toUpperCase()
  if (mode === 'CASH') return 0
  const m = mode.match(/^CREDIT_(\d{1,3})$/)
  if (!m) return 0
  const days = Number(m[1])
  return Number.isFinite(days) ? Math.max(0, days) : 0
}

function extFromFileName(fileName: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(fileName)
  return (m?.[1] ?? '').toLowerCase()
}

function assertS3Configured(env: ReturnType<typeof getEnv>) {
  const missing: string[] = []
  if (!env.S3_ENDPOINT) missing.push('S3_ENDPOINT')
  if (!env.S3_BUCKET) missing.push('S3_BUCKET')
  if (!env.S3_ACCESS_KEY_ID) missing.push('S3_ACCESS_KEY_ID')
  if (!env.S3_SECRET_ACCESS_KEY) missing.push('S3_SECRET_ACCESS_KEY')
  if (!env.S3_PUBLIC_BASE_URL) missing.push('S3_PUBLIC_BASE_URL')
  if (missing.length > 0) {
    const err = new Error(`S3 not configured: missing ${missing.join(', ')}`) as Error & { statusCode?: number }
    err.statusCode = 500
    throw err
  }
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '')
  const p = path.replace(/^\/+/, '')
  return `${b}/${p}`
}

export function registerSalesPaymentRoutes(app: FastifyInstance) {
  const db = prisma()
  const audit = new AuditService(db)
  const env = getEnv()

  function branchCityOf(request: any): string | null {
    if (request.auth?.isTenantAdmin) return null
    const scoped = !!request.auth?.permissions?.has(Permissions.ScopeBranch)
    if (!scoped) return null
    const city = String(request.auth?.warehouseCity ?? '').trim()
    return city ? city.toUpperCase() : '__MISSING__'
  }

  // Accounts receivable: delivered orders pending payment.
  app.post(
    '/api/v1/sales/payments/proof-upload',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.SalesOrderWrite)],
    },
    async (request, reply) => {
      const parsed = paymentProofPresignSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const allowedContentTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
      if (!allowedContentTypes.has(parsed.data.contentType)) {
        return reply.status(400).send({ message: 'Unsupported contentType' })
      }

      assertS3Configured(env)

      const tenantId = request.auth!.tenantId
      const ext = extFromFileName(parsed.data.fileName)
      const safeExt = ext && ext.length <= 8 ? ext : 'jpg'
      const rand = randomBytes(8).toString('hex')
      const key = `tenants/${tenantId}/sales-payments/proof-${Date.now()}-${rand}.${safeExt}`

      const s3 = new S3Client({
        region: env.S3_REGION ?? 'us-east-1',
        endpoint: env.S3_ENDPOINT!,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY_ID!,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
        },
      })

      const cmd = new PutObjectCommand({
        Bucket: env.S3_BUCKET!,
        Key: key,
        ContentType: parsed.data.contentType,
      })

      const expiresInSeconds = 300
      const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: expiresInSeconds })
      const publicUrl = joinUrl(env.S3_PUBLIC_BASE_URL!, key)

      return reply.send({ uploadUrl, publicUrl, key, expiresInSeconds, method: 'PUT' })
    },
  )

  app.get(
    '/api/v1/sales/payments',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.SalesOrderRead)],
    },
    async (request, reply) => {
      const parsed = listPaymentsQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid query', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const branchCity = branchCityOf(request)

      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      const wherePaid =
        parsed.data.status === 'PAID'
          ? { paidAt: { not: null } }
          : parsed.data.status === 'DUE'
            ? { paidAt: null }
            : {}

      const orders = await db.salesOrder.findMany({
        where: {
          tenantId,
          status: 'FULFILLED',
          ...wherePaid,
          ...(branchCity
            ? {
                OR: [
                  { deliveryCity: { equals: branchCity, mode: 'insensitive' as const } },
                  { AND: [{ OR: [{ deliveryCity: null }, { deliveryCity: '' }] }, { customer: { city: { equals: branchCity, mode: 'insensitive' as const } } }] },
                ],
              }
            : {}),
        },
        take: parsed.data.take,
        orderBy: [{ deliveryDate: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          number: true,
          version: true,
          paymentMode: true,
          deliveryDate: true,
          deliveredAt: true,
          paidAt: true,
          customer: { select: { id: true, name: true } },
          lines: { select: { quantity: true, unitPrice: true } },
        },
      })

      const items = orders.map((o) => {
        const base = o.deliveredAt ?? o.deliveryDate ?? new Date()
        const creditDays = parseCreditDays(o.paymentMode)
        const dueAt = addDaysUtc(base, creditDays)
        const total = o.lines.reduce((sum, l) => sum + toNumber(l.quantity) * toNumber(l.unitPrice), 0)

        return {
          id: o.id,
          number: o.number,
          version: o.version,
          customerId: o.customer.id,
          customerName: o.customer.name,
          paymentMode: o.paymentMode,
          deliveryDate: o.deliveryDate ? o.deliveryDate.toISOString() : null,
          deliveredAt: o.deliveredAt ? o.deliveredAt.toISOString() : null,
          dueAt: dueAt.toISOString(),
          total,
          paidAt: o.paidAt ? o.paidAt.toISOString() : null,
        }
      })

      return reply.send({ items })
    },
  )

  app.post(
    '/api/v1/sales/payments/:id/pay',
    {
      preHandler: [requireAuth(), requireModuleEnabled(db, 'SALES'), requirePermission(Permissions.SalesOrderWrite)],
    },
    async (request, reply) => {
      const id = (request.params as any).id as string
      const parsed = markPaidSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })

      const tenantId = request.auth!.tenantId
      const userId = request.auth!.userId
      const branchCity = branchCityOf(request)

      if (branchCity === '__MISSING__') {
        return reply.status(409).send({ message: 'Seleccione su sucursal antes de continuar' })
      }

      const receiptType = (parsed.data.paymentReceiptType ?? 'CASH').toUpperCase() as 'CASH' | 'TRANSFER_QR'
      const receiptRef = parsed.data.paymentReceiptRef?.trim() || null
      const receiptPhotoUrl = parsed.data.paymentReceiptPhotoUrl ?? null
      const receiptPhotoKey = parsed.data.paymentReceiptPhotoKey ?? null

      if ((receiptPhotoUrl && !receiptPhotoKey) || (!receiptPhotoUrl && receiptPhotoKey)) {
        return reply.status(400).send({ message: 'photoUrl and photoKey must be provided together' })
      }

      if (receiptType === 'TRANSFER_QR' && !receiptRef && !receiptPhotoUrl) {
        return reply.status(400).send({ message: 'Transferencia/QR requiere foto o número de transacción' })
      }

      const order = await db.salesOrder.findFirst({
        where: {
          id,
          tenantId,
          ...(branchCity
            ? {
                OR: [
                  { deliveryCity: { equals: branchCity, mode: 'insensitive' as const } },
                  { AND: [{ OR: [{ deliveryCity: null }, { deliveryCity: '' }] }, { customer: { city: { equals: branchCity, mode: 'insensitive' as const } } }] },
                ],
              }
            : {}),
        },
        select: { id: true, number: true, status: true, version: true, paidAt: true, customerId: true },
      })
      if (!order) return reply.status(404).send({ message: 'Not found' })
      if (order.version !== parsed.data.version) return reply.status(409).send({ message: 'Version conflict' })
      if (order.status !== 'FULFILLED') return reply.status(409).send({ message: 'Only delivered orders can be paid' })
      if (order.paidAt) return reply.status(409).send({ message: 'Order already paid' })

      let updated: { id: string; number: string; status: string; version: number; paidAt: Date | null }
      try {
        updated = await db.salesOrder.update({
          where: { id: order.id },
          data: {
            paidAt: new Date(),
            paidBy: userId,
            version: { increment: 1 },
            createdBy: userId,
            paymentReceiptType: receiptType,
            paymentReceiptRef: receiptRef,
            paymentReceiptPhotoUrl: receiptPhotoUrl,
            paymentReceiptPhotoKey: receiptPhotoKey,
          },
          select: { id: true, number: true, status: true, version: true, paidAt: true },
        })

        await audit.append({
          tenantId,
          actorUserId: userId,
          action: 'sales.order.pay',
          entityType: 'SalesOrder',
          entityId: id,
          before: order,
          after: updated,
          metadata: {
            paymentReceiptType: receiptType,
            paymentReceiptRef: receiptRef,
            paymentReceiptPhotoUrl: receiptPhotoUrl,
          },
        })
      } catch (err: any) {
        console.error('sales.pay error', err)
        return reply.status(500).send({ message: err?.message ?? 'Internal error' })
      }

      const room = `tenant:${tenantId}`
      app.io?.to(room).emit('sales.order.paid', {
        id: updated.id,
        number: updated.number,
        paidAt: updated.paidAt?.toISOString() ?? null,
      })

      return reply.send({ order: updated })
    },
  )
}
