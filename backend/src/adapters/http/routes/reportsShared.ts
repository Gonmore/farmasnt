import { z } from 'zod'
import { Permissions } from '../../../application/security/permissions.js'
import { branchDepartmentsOf, branchDepartmentsOfMissing } from '../../../application/security/branch.js'

export function requireStockReportOrBranchAccess() {
  return async function (request: any): Promise<void> {
    const perms = request.auth?.permissions
    if (!request.auth) {
      const err = new Error('Unauthorized') as Error & { statusCode?: number }
      err.statusCode = 401
      throw err
    }

    const hasReportStockRead = perms?.has(Permissions.ReportStockRead)
    const hasScopeBranch = perms?.has(Permissions.ScopeBranch)
    const hasStockRead = perms?.has(Permissions.StockRead)

    if (!hasReportStockRead && !(hasScopeBranch && hasStockRead)) {
      const err = new Error('Forbidden') as Error & { statusCode?: number }
      err.statusCode = 403
      throw err
    }
  }
}

export const dateRangeQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

export const locationFilterQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
})

export const reportEmailBodySchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).optional(),
  filename: z.string().min(1).optional(),
  pdfBase64: z.string().min(10),
  message: z.string().optional(),
})

export const reportScheduleBodySchema = z.object({
  reportKey: z.string().min(1),
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  hour: z.coerce.number().int().min(0).max(23).default(8),
  minute: z.coerce.number().int().min(0).max(59).default(0),
  dayOfWeek: z.coerce.number().int().min(0).max(6).optional(),
  dayOfMonth: z.coerce.number().int().min(1).max(31).optional(),
  recipients: z.array(z.string().email()).min(1),
  status: z.string().optional(),
  enabled: z.coerce.boolean().optional().default(true),
})

export const reportSchedulePatchBodySchema = reportScheduleBodySchema
  .partial()
  .extend({ reportKey: z.string().min(1).optional(), frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']).optional() })

export const reportScheduleSelect = {
  id: true,
  type: true,
  reportKey: true,
  params: true,
  frequency: true,
  hour: true,
  minute: true,
  dayOfWeek: true,
  dayOfMonth: true,
  recipients: true,
  enabled: true,
  lastRunAt: true,
  nextRunAt: true,
  createdAt: true,
} as const

export const reportScheduleItemSelect = {
  id: true,
  reportKey: true,
  frequency: true,
  hour: true,
  minute: true,
  dayOfWeek: true,
  dayOfMonth: true,
  recipients: true,
  enabled: true,
  nextRunAt: true,
  createdAt: true,
} as const

export function branchOwnWarehouseIdOf(request: any): string | null {
  if (request.auth?.isTenantAdmin) return null
  const scoped = !!request.auth?.permissions?.has(Permissions.ScopeBranch)
  if (!scoped) return null
  const ownId = request.auth?.warehouseId ?? null
  return ownId ? String(ownId) : '__MISSING__'
}

export function resolveBranchWarehouseId(
  request: any,
  requestedWarehouseId: string | undefined,
  opts?: { allowProviderAll?: boolean },
): string | null {
  const ownId = branchOwnWarehouseIdOf(request)
  if (!ownId) return requestedWarehouseId ?? null
  if (ownId === '__MISSING__') return '__MISSING__'
  if (opts?.allowProviderAll && request.auth?.warehouseType === 'PROVIDER') return requestedWarehouseId ?? null
  return ownId
}

export { branchDepartmentsOf, branchDepartmentsOfMissing }
