import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { prisma } from '../src/adapters/db/prisma.js'
import { Permissions } from '../src/application/security/permissions.js'

const DEFAULT_MODULES = ['WAREHOUSE', 'SALES'] as const

function startOfTodayUtc(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0))
}

function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000)
}

async function main() {
  const db = prisma()

  const tenantName = process.env.SEED_TENANT_NAME ?? 'Demo Pharma'
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@demo.local'
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Admin123!'
  const platformDomain = process.env.SEED_PLATFORM_DOMAIN ?? 'farmacia.supernovatel.com'

  const passwordHash = await bcrypt.hash(adminPassword, 12)

  const tenant = await db.tenant.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: { name: tenantName },
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: tenantName,
      createdBy: null,
    },
  })

  for (const module of DEFAULT_MODULES) {
    await db.tenantModule.upsert({
      where: { tenantId_module: { tenantId: tenant.id, module } },
      update: { enabled: true },
      create: { tenantId: tenant.id, module, enabled: true, createdBy: null },
    })
  }

  const permissionSpecs = [
    { code: Permissions.CatalogRead, module: 'WAREHOUSE' },
    { code: Permissions.CatalogWrite, module: 'WAREHOUSE' },
    { code: Permissions.StockRead, module: 'WAREHOUSE' },
    { code: Permissions.StockMove, module: 'WAREHOUSE' },
    { code: Permissions.AuditRead, module: 'WAREHOUSE' },
    { code: Permissions.SalesOrderRead, module: 'SALES' },
    { code: Permissions.SalesOrderWrite, module: 'SALES' },
    { code: Permissions.AdminUsersManage, module: 'SALES' },
    { code: Permissions.PlatformTenantsManage, module: 'SALES' },
  ] as const

  for (const p of permissionSpecs) {
    await db.permission.upsert({
      where: { code: p.code },
      update: { module: p.module },
      create: { code: p.code, module: p.module, description: p.code, isSystem: true },
    })
  }

  const adminRole = await db.role.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'TENANT_ADMIN' } },
    update: { name: 'Tenant Admin' },
    create: {
      tenantId: tenant.id,
      code: 'TENANT_ADMIN',
      name: 'Tenant Admin',
      isSystem: true,
      createdBy: null,
    },
  })

  const perms = await db.permission.findMany({
    where: { code: { in: permissionSpecs.map((x) => x.code) } },
    select: { id: true, code: true },
  })

  for (const perm of perms) {
    if (perm.code === Permissions.PlatformTenantsManage) {
      // Grant platform provisioning only on the seeded "platform" tenant.
      // New tenants created later should not get this permission.
      if (tenant.id !== '00000000-0000-0000-0000-000000000001') continue
    }
    await db.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: adminRole.id, permissionId: perm.id },
    })
  }

  // Host-based tenant resolution (platform domain)
  await db.tenantDomain.upsert({
    where: { domain: platformDomain.toLowerCase() },
    update: { tenantId: tenant.id, isPrimary: true, verifiedAt: new Date() },
    create: { tenantId: tenant.id, domain: platformDomain.toLowerCase(), isPrimary: true, verifiedAt: new Date(), createdBy: null },
  })

  const adminUser = await db.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: adminEmail } },
    update: { passwordHash, isActive: true },
    create: {
      tenantId: tenant.id,
      email: adminEmail,
      passwordHash,
      isActive: true,
      createdBy: null,
    },
    select: { id: true },
  })

  await db.userRole.upsert({
    where: { userId_roleId: { userId: adminUser.id, roleId: adminRole.id } },
    update: {},
    create: { userId: adminUser.id, roleId: adminRole.id },
  })

  // Basic warehouse/location for immediate stock tests
  const wh = await db.warehouse.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'WH-01' } },
    update: { name: 'Almacén Central' },
    create: { tenantId: tenant.id, code: 'WH-01', name: 'Almacén Central', createdBy: adminUser.id },
  })

  const loc = await db.location.upsert({
    where: { tenantId_warehouseId_code: { tenantId: tenant.id, warehouseId: wh.id, code: 'BIN-01' } },
    update: {},
    create: { tenantId: tenant.id, warehouseId: wh.id, code: 'BIN-01', type: 'BIN', createdBy: adminUser.id },
  })

  // Expiry QA dataset
  const todayUtc = startOfTodayUtc()
  const product = await db.product.upsert({
    where: { tenantId_sku: { tenantId: tenant.id, sku: 'PARA-500TAB' } },
    update: { name: 'Paracetamol 500mg (Tabletas)' },
    create: {
      tenantId: tenant.id,
      sku: 'PARA-500TAB',
      name: 'Paracetamol 500mg (Tabletas)',
      description: 'Dataset seed para vencimientos/FEFO',
      createdBy: adminUser.id,
    },
    select: { id: true },
  })

  const expiredBatch = await db.batch.upsert({
    where: { tenantId_productId_batchNumber: { tenantId: tenant.id, productId: product.id, batchNumber: 'LOT-EXPIRED' } },
    update: { expiresAt: addDaysUtc(todayUtc, -10) },
    create: {
      tenantId: tenant.id,
      productId: product.id,
      batchNumber: 'LOT-EXPIRED',
      expiresAt: addDaysUtc(todayUtc, -10),
      createdBy: adminUser.id,
    },
    select: { id: true },
  })

  const yellowBatch = await db.batch.upsert({
    where: { tenantId_productId_batchNumber: { tenantId: tenant.id, productId: product.id, batchNumber: 'LOT-YELLOW' } },
    update: { expiresAt: addDaysUtc(todayUtc, 60) },
    create: {
      tenantId: tenant.id,
      productId: product.id,
      batchNumber: 'LOT-YELLOW',
      expiresAt: addDaysUtc(todayUtc, 60),
      createdBy: adminUser.id,
    },
    select: { id: true },
  })

  await db.inventoryBalance.upsert({
    where: {
      tenantId_locationId_productId_batchId: {
        tenantId: tenant.id,
        locationId: loc.id,
        productId: product.id,
        batchId: expiredBatch.id,
      },
    },
    update: { quantity: '5' },
    create: {
      tenantId: tenant.id,
      locationId: loc.id,
      productId: product.id,
      batchId: expiredBatch.id,
      quantity: '5',
      createdBy: adminUser.id,
    },
  })

  await db.inventoryBalance.upsert({
    where: {
      tenantId_locationId_productId_batchId: {
        tenantId: tenant.id,
        locationId: loc.id,
        productId: product.id,
        batchId: yellowBatch.id,
      },
    },
    update: { quantity: '20' },
    create: {
      tenantId: tenant.id,
      locationId: loc.id,
      productId: product.id,
      batchId: yellowBatch.id,
      quantity: '20',
      createdBy: adminUser.id,
    },
  })

  // eslint-disable-next-line no-console
  console.log('Seed completed:', { tenantId: tenant.id, adminEmail, platformDomain })
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e)
  process.exit(1)
})
