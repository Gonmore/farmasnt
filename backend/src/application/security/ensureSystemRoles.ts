import type { PrismaClient } from '../../generated/prisma/client.js'
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

export async function ensureSystemRoles(db: PrismaClient): Promise<void> {
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
  const permIdByCode = new Map(permRows.map((p: { id: string; code: string }) => [p.code, p.id] as const))

  const tenants = await db.tenant.findMany({ select: { id: true } })
  for (const tenant of tenants) {
    // Ensure required tenant roles exist.
    const ventasRole = await db.role.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: 'VENTAS' } },
      update: { name: 'Ventas' },
      create: { tenantId: tenant.id, code: 'VENTAS', name: 'Ventas', isSystem: true, createdBy: null },
      select: { id: true },
    })

    const logisticaRole = await db.role.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: 'LOGISTICA' } },
      update: { name: 'Logística' },
      create: { tenantId: tenant.id, code: 'LOGISTICA', name: 'Logística', isSystem: true, createdBy: null },
      select: { id: true },
    })

    const branchAdminRole = await db.role.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: 'BRANCH_ADMIN' } },
      update: { name: 'Administrador de Sucursal' },
      create: { tenantId: tenant.id, code: 'BRANCH_ADMIN', name: 'Administrador de Sucursal', isSystem: true, createdBy: null },
      select: { id: true },
    })

    const branchSellerRole = await db.role.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: 'BRANCH_SELLER' } },
      update: { name: 'Vendedor de Sucursal' },
      create: { tenantId: tenant.id, code: 'BRANCH_SELLER', name: 'Vendedor de Sucursal', isSystem: true, createdBy: null },
      select: { id: true },
    })

    // TENANT_ADMIN: keep in sync with full-permissions set (except platform permission is allowed only for platform tenant).
    const tenantAdminRole = await db.role.findUnique({
      where: { tenantId_code: { tenantId: tenant.id, code: 'TENANT_ADMIN' } },
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
    const branchAdminPerms: string[] = [
      ...branchSellerPerms,
      Permissions.StockMove,
    ]

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

    for (const code of ventasPerms) {
      const permissionId = permIdByCode.get(code)
      if (!permissionId) continue
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: ventasRole.id, permissionId } },
        update: {},
        create: { roleId: ventasRole.id, permissionId },
      })
    }

    for (const code of logisticaPerms) {
      const permissionId = permIdByCode.get(code)
      if (!permissionId) continue
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: logisticaRole.id, permissionId } },
        update: {},
        create: { roleId: logisticaRole.id, permissionId },
      })
    }

    for (const code of branchAdminPerms) {
      const permissionId = permIdByCode.get(code)
      if (!permissionId) continue
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: branchAdminRole.id, permissionId } },
        update: {},
        create: { roleId: branchAdminRole.id, permissionId },
      })
    }

    for (const code of branchSellerPerms) {
      const permissionId = permIdByCode.get(code)
      if (!permissionId) continue
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: branchSellerRole.id, permissionId } },
        update: {},
        create: { roleId: branchSellerRole.id, permissionId },
      })
    }

    if (tenantAdminRole) {
      for (const code of tenantAdminPerms) {
        const permissionId = permIdByCode.get(code)
        if (!permissionId) continue
        await db.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: tenantAdminRole.id, permissionId } },
          update: {},
          create: { roleId: tenantAdminRole.id, permissionId },
        })
      }
    }
  }
}
