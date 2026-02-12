import type { Prisma, PrismaClient } from '../../generated/prisma/client.js'
import { Permissions } from './permissions.js'

type PermissionSpec = { code: string; module: 'WAREHOUSE' | 'SALES' }

const SYSTEM_PERMISSION_SPECS: PermissionSpec[] = [
  { code: Permissions.ScopeBranch, module: 'SALES' },
  { code: Permissions.CatalogRead, module: 'WAREHOUSE' },
  { code: Permissions.CatalogWrite, module: 'WAREHOUSE' },
  { code: Permissions.StockRead, module: 'WAREHOUSE' },
  { code: Permissions.StockManage, module: 'WAREHOUSE' },
  { code: Permissions.StockMove, module: 'WAREHOUSE' },
  { code: Permissions.StockDeliver, module: 'WAREHOUSE' },
  { code: Permissions.AuditRead, module: 'WAREHOUSE' },
  { code: Permissions.SalesOrderRead, module: 'SALES' },
  { code: Permissions.SalesOrderWrite, module: 'SALES' },
  { code: Permissions.SalesDeliveryRead, module: 'SALES' },
  { code: Permissions.SalesDeliveryWrite, module: 'SALES' },
  { code: Permissions.ReportSalesRead, module: 'SALES' },
  { code: Permissions.ReportStockRead, module: 'WAREHOUSE' },
  { code: Permissions.AdminUsersManage, module: 'SALES' },
  { code: Permissions.PlatformTenantsManage, module: 'SALES' },
]

type DbClient = PrismaClient | Prisma.TransactionClient

async function ensurePermissionCatalog(db: DbClient): Promise<Map<string, string>> {
  // Ensure permission catalog is up-to-date (idempotent)
  for (const p of SYSTEM_PERMISSION_SPECS) {
    await db.permission.upsert({
      where: { code: p.code },
      update: { module: p.module },
      create: { code: p.code, module: p.module, description: p.code, isSystem: true },
    })
  }

  const permRows = await db.permission.findMany({
    where: { code: { in: SYSTEM_PERMISSION_SPECS.map((x) => x.code) } },
    select: { id: true, code: true },
  })
  return new Map(permRows.map((p: { id: string; code: string }) => [p.code, p.id] as const))
}

async function ensureSystemRolesForTenantInternal(db: DbClient, tenantId: string, permIdByCode: Map<string, string>) {
  // Ensure modules used by current app exist (idempotent)
  for (const module of ['WAREHOUSE', 'SALES', 'LABORATORY'] as const) {
    await db.tenantModule.upsert({
      where: { tenantId_module: { tenantId, module } },
      update: { enabled: true },
      create: { tenantId, module, enabled: true, createdBy: null },
      select: { id: true },
    })
  }

  // Ensure required tenant roles exist.
  const ventasRole = await db.role.upsert({
    where: { tenantId_code: { tenantId, code: 'VENTAS' } },
    update: { name: 'Ventas' },
    create: { tenantId, code: 'VENTAS', name: 'Ventas', isSystem: true, createdBy: null },
    select: { id: true },
  })

  const logisticaRole = await db.role.upsert({
    where: { tenantId_code: { tenantId, code: 'LOGISTICA' } },
    update: { name: 'Logística' },
    create: { tenantId, code: 'LOGISTICA', name: 'Logística', isSystem: true, createdBy: null },
    select: { id: true },
  })

  const branchAdminRole = await db.role.upsert({
    where: { tenantId_code: { tenantId, code: 'BRANCH_ADMIN' } },
    update: { name: 'Administrador de Sucursal' },
    create: { tenantId, code: 'BRANCH_ADMIN', name: 'Administrador de Sucursal', isSystem: true, createdBy: null },
    select: { id: true },
  })

  const branchSellerRole = await db.role.upsert({
    where: { tenantId_code: { tenantId, code: 'BRANCH_SELLER' } },
    update: { name: 'Vendedor de Sucursal' },
    create: { tenantId, code: 'BRANCH_SELLER', name: 'Vendedor de Sucursal', isSystem: true, createdBy: null },
    select: { id: true },
  })

  const laboratorioRole = await db.role.upsert({
    where: { tenantId_code: { tenantId, code: 'LABORATORIO' } },
    update: { name: 'Laboratorio' },
    create: { tenantId, code: 'LABORATORIO', name: 'Laboratorio', isSystem: true, createdBy: null },
    select: { id: true },
  })

  // TENANT_ADMIN: keep in sync with full-permissions set (except platform permission is allowed only for platform tenant).
  const tenantAdminRole = await db.role.findUnique({
    where: { tenantId_code: { tenantId, code: 'TENANT_ADMIN' } },
    select: { id: true },
  })

  const ventasPerms: string[] = [
    Permissions.CatalogRead,
    Permissions.StockRead,
    Permissions.SalesOrderRead,
    Permissions.SalesOrderWrite,
    Permissions.SalesDeliveryRead,
    Permissions.ReportSalesRead,
  ]

  const logisticaPerms: string[] = [
    Permissions.StockRead,
    Permissions.StockMove,
    Permissions.StockDeliver,
    Permissions.SalesOrderRead,
    Permissions.SalesDeliveryRead,
    Permissions.SalesDeliveryWrite,
    Permissions.ReportStockRead,
  ]

  // BRANCH_SELLER: copy of the current BRANCH_ADMIN permissions (kept stable for now).
  const branchSellerPerms: string[] = [
    Permissions.ScopeBranch,
    Permissions.CatalogRead,
    Permissions.StockRead,
    Permissions.StockDeliver,
    Permissions.SalesOrderRead,
    Permissions.SalesOrderWrite,
    Permissions.SalesDeliveryRead,
    Permissions.SalesDeliveryWrite,
    Permissions.ReportSalesRead,
  ]

  // BRANCH_ADMIN: must be able to request/ship/receive stock movements for its own branch.
  const branchAdminPerms: string[] = [...branchSellerPerms, Permissions.StockMove]

  const laboratorioPerms: string[] = [Permissions.CatalogRead, Permissions.StockRead, Permissions.StockManage]

  const tenantAdminPerms: string[] = [
    Permissions.CatalogRead,
    Permissions.CatalogWrite,
    Permissions.StockRead,
    Permissions.StockManage,
    Permissions.StockMove,
    Permissions.StockDeliver,
    Permissions.SalesOrderRead,
    Permissions.SalesOrderWrite,
    Permissions.SalesDeliveryRead,
    Permissions.SalesDeliveryWrite,
    Permissions.ReportSalesRead,
    Permissions.ReportStockRead,
    Permissions.AdminUsersManage,
    Permissions.AuditRead,
    // Note: platform:tenants:manage is handled separately by PLATFORM_ADMIN (platform tenant)
  ]

  async function attachPerms(roleId: string, codes: string[]) {
    for (const code of codes) {
      const permissionId = permIdByCode.get(code)
      if (!permissionId) continue
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        update: {},
        create: { roleId, permissionId },
      })
    }
  }

  await attachPerms(ventasRole.id, ventasPerms)
  await attachPerms(logisticaRole.id, logisticaPerms)
  await attachPerms(branchAdminRole.id, branchAdminPerms)
  await attachPerms(branchSellerRole.id, branchSellerPerms)
  await attachPerms(laboratorioRole.id, laboratorioPerms)

  if (tenantAdminRole) {
    await attachPerms(tenantAdminRole.id, tenantAdminPerms)
  }
}

export async function ensureSystemRolesForTenant(db: DbClient, tenantId: string): Promise<void> {
  const permIdByCode = await ensurePermissionCatalog(db)
  await ensureSystemRolesForTenantInternal(db, tenantId, permIdByCode)
}

export async function ensureSystemRoles(db: PrismaClient): Promise<void> {
  const permIdByCode = await ensurePermissionCatalog(db)
  const tenants = await db.tenant.findMany({ select: { id: true } })
  for (const tenant of tenants) {
    await ensureSystemRolesForTenantInternal(db, tenant.id, permIdByCode)
  }
}
