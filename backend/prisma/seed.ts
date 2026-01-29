import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

async function loadPermissions(): Promise<any> {
  // In dev, seed runs against TS sources. In production Docker image, we only guarantee dist.
  try {
    const mod = await import('../src/application/security/permissions.js')
    return (mod as any).Permissions
  } catch {
    const mod = await import('../dist/application/security/permissions.js')
    return (mod as any).Permissions
  }
}

function createDb(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required')
  const pool = new Pool({ connectionString })
  const adapter = new PrismaPg(pool)
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
  })
}

const DEFAULT_MODULES = ['WAREHOUSE', 'SALES'] as const

function startOfTodayUtc(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0))
}

function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000)
}

function roundDownToMultiple(value: number, multiple: number): number {
  const v = Number(value)
  const m = Number(multiple)
  if (!Number.isFinite(v) || !Number.isFinite(m) || m <= 0) return 0
  return Math.floor(v / m) * m
}

async function main() {
  const Permissions = await loadPermissions()
  const db = createDb()

  const isProduction = process.env.NODE_ENV === 'production'
  const updatePasswords =
    !isProduction ||
    process.env.SEED_UPDATE_PASSWORDS === '1' ||
    process.env.SEED_UPDATE_PASSWORDS === 'true' ||
    process.env.SEED_UPDATE_PASSWORDS === 'TRUE'
  const seedDemoData =
    !isProduction ||
    process.env.SEED_DEMO_DATA === '1' ||
    process.env.SEED_DEMO_DATA === 'true' ||
    process.env.SEED_DEMO_DATA === 'TRUE'

  const tenantName = process.env.SEED_TENANT_NAME ?? 'Demo Pharma'
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@demo.local'
  const adminPasswordRaw = process.env.SEED_ADMIN_PASSWORD
  const adminPassword = adminPasswordRaw && adminPasswordRaw.trim() ? adminPasswordRaw : 'Admin123'
  const platformDomain = process.env.SEED_PLATFORM_DOMAIN ?? 'farmacia.supernovatel.com'
  
  // Platform Tenant (Supernovatel)
  const platformTenantId = '00000000-0000-0000-0000-000000000001'
  const isPlatformTenant = true

  if (updatePasswords && adminPassword.trim().length < 6) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 6 characters when updating passwords')
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12)

  // Crear Platform Tenant (Supernovatel)
  const platformTenant = await db.tenant.upsert({
    where: { id: platformTenantId },
    update: {
      name: 'Supernovatel',
      logoUrl: '/Logo_Azul.png',
      brandPrimary: '#0066FF', // Azul brillante del logo
      brandSecondary: '#FFFFFF', // Blanco
      brandTertiary: '#10b981', // Verde para estados
      defaultTheme: 'LIGHT',
      contactName: 'Administrador Supernovatel',
      contactEmail: 'admin@supernovatel.com',
      contactPhone: '+591 70000000',
      subscriptionExpiresAt: null, // Platform tenant sin expiración
    },
    create: {
      id: platformTenantId,
      name: 'Supernovatel',
      logoUrl: '/Logo_Azul.png',
      brandPrimary: '#0066FF',
      brandSecondary: '#FFFFFF',
      brandTertiary: '#10b981',
      defaultTheme: 'LIGHT',
      contactName: 'Administrador Supernovatel',
      contactEmail: 'admin@supernovatel.com',
      contactPhone: '+591 70000000',
      subscriptionExpiresAt: null,
      createdBy: null,
    },
  })

  // Crear configuración de contacto (solo debe haber un registro)
  await db.contactInfo.deleteMany({}) // Limpiar registros anteriores
  const contactInfo = await db.contactInfo.create({
    data: {
      modalHeader: 'Contactos',
      modalBody: 'Únete a este sistema o solicita el tuyo personalizado:\n- 📧 contactos@supernovatel.com\n- � WhatsApp: +591 65164773',
    },
  })

  // Crear Demo Tenant (tenant de ejemplo)
  const demoTenant = await db.tenant.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: {
      name: tenantName,
      contactName: 'Administrador Demo',
      contactEmail: adminEmail,
      contactPhone: '+591 71111111',
      branchLimit: 5,
      subscriptionExpiresAt: addDaysUtc(startOfTodayUtc(), 365), // 1 año desde hoy
    },
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      name: tenantName,
      contactName: 'Administrador Demo',
      contactEmail: adminEmail,
      contactPhone: '+591 71111111',
      branchLimit: 5,
      subscriptionExpiresAt: addDaysUtc(startOfTodayUtc(), 365),
      createdBy: null,
    },
  })

  // Módulos para Platform Tenant (solo necesita gestión básica)
  for (const module of DEFAULT_MODULES) {
    await db.tenantModule.upsert({
      where: { tenantId_module: { tenantId: platformTenant.id, module } },
      update: { enabled: true },
      create: { tenantId: platformTenant.id, module, enabled: true, createdBy: null },
    })
  }

  // Módulos para Demo Tenant
  for (const module of DEFAULT_MODULES) {
    await db.tenantModule.upsert({
      where: { tenantId_module: { tenantId: demoTenant.id, module } },
      update: { enabled: true },
      create: { tenantId: demoTenant.id, module, enabled: true, createdBy: null },
    })
  }

  const permissionSpecs = [
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
  ] as const

  for (const p of permissionSpecs) {
    await db.permission.upsert({
      where: { code: p.code },
      update: { module: p.module },
      create: { code: p.code, module: p.module, description: p.code, isSystem: true },
    })
  }

  // ============= PLATFORM ADMIN (Supernovatel) =============
  const platformAdminRole = await db.role.upsert({
    where: { tenantId_code: { tenantId: platformTenant.id, code: 'PLATFORM_ADMIN' } },
    update: { name: 'Platform Admin' },
    create: {
      tenantId: platformTenant.id,
      code: 'PLATFORM_ADMIN',
      name: 'Platform Admin',
      isSystem: true,
      createdBy: null,
    },
  })

  const perms = await db.permission.findMany({
    where: { code: { in: permissionSpecs.map((x) => x.code) } },
    select: { id: true, code: true },
  })

  // Platform Admin tiene TODOS los permisos incluyendo platform:tenants:manage
  for (const perm of perms) {
    await db.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: platformAdminRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: platformAdminRole.id, permissionId: perm.id },
    })
  }

  // Crear usuarios Platform Admin
  const platformAdmin1 = await db.user.upsert({
    where: { tenantId_email: { tenantId: platformTenant.id, email: 'admin@supernovatel.com' } },
    update: { ...(updatePasswords ? { passwordHash } : {}), isActive: true },
    create: {
      tenantId: platformTenant.id,
      email: 'admin@supernovatel.com',
      passwordHash,
      isActive: true,
      createdBy: null,
    },
    select: { id: true },
  })

  await db.userRole.upsert({
    where: { userId_roleId: { userId: platformAdmin1.id, roleId: platformAdminRole.id } },
    update: {},
    create: { userId: platformAdmin1.id, roleId: platformAdminRole.id },
  })

  const platformAdmin2 = await db.user.upsert({
    where: { tenantId_email: { tenantId: platformTenant.id, email: 'usuario1@supernovatel.com' } },
    update: { ...(updatePasswords ? { passwordHash } : {}), isActive: true },
    create: {
      tenantId: platformTenant.id,
      email: 'usuario1@supernovatel.com',
      passwordHash,
      isActive: true,
      createdBy: null,
    },
    select: { id: true },
  })

  await db.userRole.upsert({
    where: { userId_roleId: { userId: platformAdmin2.id, roleId: platformAdminRole.id } },
    update: {},
    create: { userId: platformAdmin2.id, roleId: platformAdminRole.id },
  })

  // Dominio platform
  await db.tenantDomain.upsert({
    where: { domain: platformDomain.toLowerCase() },
    update: { tenantId: platformTenant.id, isPrimary: true, verifiedAt: new Date() },
    create: { tenantId: platformTenant.id, domain: platformDomain.toLowerCase(), isPrimary: true, verifiedAt: new Date(), createdBy: null },
  })

  // ============= TENANT ADMIN (Demo Tenant) =============
  const demoAdminRole = await db.role.upsert({
    where: { tenantId_code: { tenantId: demoTenant.id, code: 'TENANT_ADMIN' } },
    update: { name: 'Tenant Admin' },
    create: {
      tenantId: demoTenant.id,
      code: 'TENANT_ADMIN',
      name: 'Tenant Admin',
      isSystem: true,
      createdBy: null,
    },
  })

  // Tenant Admin tiene todos los permisos EXCEPTO platform:tenants:manage
  for (const perm of perms) {
    if (perm.code === Permissions.PlatformTenantsManage) continue // NO dar permiso platform a tenants normales
    
    await db.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: demoAdminRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: demoAdminRole.id, permissionId: perm.id },
    })
  }

  // Dominio demo tenant (opcional, puede usar localhost)
  await db.tenantDomain.upsert({
    where: { domain: 'demo.localhost' },
    update: { tenantId: demoTenant.id, isPrimary: true, verifiedAt: new Date() },
    create: { tenantId: demoTenant.id, domain: 'demo.localhost', isPrimary: true, verifiedAt: new Date(), createdBy: null },
  })

  // Add localhost domain for local development
  await db.tenantDomain.upsert({
    where: { domain: 'localhost' },
    update: { tenantId: demoTenant.id, isPrimary: false, verifiedAt: new Date() },
    create: { tenantId: demoTenant.id, domain: 'localhost', isPrimary: false, verifiedAt: new Date(), createdBy: null },
  })

  const demoAdminUser = await db.user.upsert({
    where: { tenantId_email: { tenantId: demoTenant.id, email: adminEmail } },
    update: { ...(updatePasswords ? { passwordHash } : {}), isActive: true },
    create: {
      tenantId: demoTenant.id,
      email: adminEmail,
      passwordHash,
      isActive: true,
      createdBy: null,
    },
    select: { id: true },
  })

  await db.userRole.upsert({
    where: { userId_roleId: { userId: demoAdminUser.id, roleId: demoAdminRole.id } },
    update: {},
    create: { userId: demoAdminUser.id, roleId: demoAdminRole.id },
  })

  // ============= ROLES OPERATIVOS (Demo Tenant) =============
  const ventasRole = await db.role.upsert({
    where: { tenantId_code: { tenantId: demoTenant.id, code: 'VENTAS' } },
    update: { name: 'Ventas' },
    create: { tenantId: demoTenant.id, code: 'VENTAS', name: 'Ventas', isSystem: true, createdBy: null },
    select: { id: true },
  })

  const logisticaRole = await db.role.upsert({
    where: { tenantId_code: { tenantId: demoTenant.id, code: 'LOGISTICA' } },
    update: { name: 'Logística' },
    create: { tenantId: demoTenant.id, code: 'LOGISTICA', name: 'Logística', isSystem: true, createdBy: null },
    select: { id: true },
  })

  const branchAdminRole = await db.role.upsert({
    where: { tenantId_code: { tenantId: demoTenant.id, code: 'BRANCH_ADMIN' } },
    update: { name: 'Administrador de Sucursal' },
    create: { tenantId: demoTenant.id, code: 'BRANCH_ADMIN', name: 'Administrador de Sucursal', isSystem: true, createdBy: null },
    select: { id: true },
  })

  const permIdByCode = new Map(perms.map((p) => [p.code, p.id] as const))

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

  const branchAdminPerms: string[] = [
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

  // ============= LIMPIEZA DE DATOS ANTERIORES =============
  if (!seedDemoData) {
    console.log('\n🌱 Seed básico aplicado (sin data demo).')
    console.log(
      `   - Passwords: ${updatePasswords ? 'ACTUALIZADOS' : 'NO modificados'} (set SEED_UPDATE_PASSWORDS=1 para forzar)`,
    )
    console.log('   - Data demo: OMITIDA (set SEED_DEMO_DATA=1 para crear data demo)')
    await db.$disconnect()
    return
  }

  console.log('\n🧹 Limpiando datos anteriores (demo tenant)...')

  // Eliminar en orden inverso de dependencias
  await db.salesOrderLine.deleteMany({ where: { tenantId: demoTenant.id } })
  await db.salesOrder.deleteMany({ where: { tenantId: demoTenant.id } })
  await db.quoteLine.deleteMany({ where: { tenantId: demoTenant.id } })
  await db.quote.deleteMany({ where: { tenantId: demoTenant.id } })
  // Safety: delete request items referencing demo products even if they were created under another tenant.
  // The FK is on productId only, so cross-tenant references would block product cleanup.
  const demoProductsForCleanup = await db.product.findMany({ where: { tenantId: demoTenant.id }, select: { id: true } })
  const demoProductIdsForCleanup = demoProductsForCleanup.map((p) => p.id)
  if (demoProductIdsForCleanup.length > 0) {
    await db.stockMovementRequestItem.deleteMany({ where: { productId: { in: demoProductIdsForCleanup } } })
  }
  await db.stockMovementRequestItem.deleteMany({ where: { product: { tenantId: demoTenant.id } } })
  await db.stockMovementRequestItem.deleteMany({ where: { tenantId: demoTenant.id } })
  await db.stockMovementRequest.deleteMany({ where: { tenantId: demoTenant.id } })
  await db.stockReturnItem.deleteMany({ where: { tenantId: demoTenant.id } })
  await db.stockReturn.deleteMany({ where: { tenantId: demoTenant.id } })
  await db.stockMovement.deleteMany({ where: { tenantId: demoTenant.id } })
  await db.inventoryBalance.deleteMany({ where: { tenantId: demoTenant.id } })
  await db.batch.deleteMany({ where: { tenantId: demoTenant.id } })
  await db.product.deleteMany({ where: { tenantId: demoTenant.id } })
  await db.customer.deleteMany({ where: { tenantId: demoTenant.id } })
  await db.location.deleteMany({ where: { tenantId: demoTenant.id } })
  await db.warehouse.deleteMany({ where: { tenantId: demoTenant.id } })

  console.log('   ✅ Datos anteriores limpiados')

  // ============= DATA DE PRUEBA (Demo Tenant) =============
  // Basic warehouse/location for immediate stock tests
  const wh = await db.warehouse.upsert({
    where: { tenantId_code: { tenantId: demoTenant.id, code: 'WH-01' } },
    update: { name: 'Almacén Central' },
    create: { tenantId: demoTenant.id, code: 'WH-01', name: 'Almacén Central', createdBy: demoAdminUser.id },
  })

  const loc = await db.location.upsert({
    where: { tenantId_warehouseId_code: { tenantId: demoTenant.id, warehouseId: wh.id, code: 'BIN-01' } },
    update: {},
    create: { tenantId: demoTenant.id, warehouseId: wh.id, code: 'BIN-01', type: 'BIN', createdBy: demoAdminUser.id },
  })

  // Expiry QA dataset
  const todayUtc = startOfTodayUtc()
  const product = await db.product.upsert({
    where: { tenantId_sku: { tenantId: demoTenant.id, sku: 'PARA-500TAB' } },
    update: { name: 'Paracetamol 500mg (Tabletas)' },
    create: {
      tenantId: demoTenant.id,
      sku: 'PARA-500TAB',
      name: 'Paracetamol 500mg (Tabletas)',
      description: 'Dataset seed para vencimientos/FEFO',
      presentationWrapper: 'caja',
      presentationQuantity: '100',
      presentationFormat: 'comprimidos',
      createdBy: demoAdminUser.id,
    },
    select: { id: true },
  })

  // Productos de ejemplo para presentación (envoltorio + cantidad + formato)
  await db.product.upsert({
    where: { tenantId_sku: { tenantId: demoTenant.id, sku: 'ATRO-CAJ250COMP' } },
    update: { name: 'Atrovastatina' },
    create: {
      tenantId: demoTenant.id,
      sku: 'ATRO-CAJ250COMP',
      name: 'Atrovastatina',
      description: 'Ejemplo: Caja de 250 comprimidos',
      presentationWrapper: 'caja',
      presentationQuantity: '250',
      presentationFormat: 'comprimidos',
      createdBy: demoAdminUser.id,
    },
    select: { id: true },
  })

  await db.product.upsert({
    where: { tenantId_sku: { tenantId: demoTenant.id, sku: 'VALG-FRS60COMP' } },
    update: { name: 'Valganciclovir' },
    create: {
      tenantId: demoTenant.id,
      sku: 'VALG-FRS60COMP',
      name: 'Valganciclovir',
      description: 'Ejemplo: Frasco de 60 comprimidos',
      presentationWrapper: 'frasco',
      presentationQuantity: '60',
      presentationFormat: 'comprimidos',
      createdBy: demoAdminUser.id,
    },
    select: { id: true },
  })

  await db.product.upsert({
    where: { tenantId_sku: { tenantId: demoTenant.id, sku: 'OMEP-CAJ1VIAL' } },
    update: { name: 'Omeprazol 40mg Iny. 10ml' },
    create: {
      tenantId: demoTenant.id,
      sku: 'OMEP-CAJ1VIAL',
      name: 'Omeprazol 40mg Iny. 10ml',
      description: 'Ejemplo: Caja de 1 vial',
      presentationWrapper: 'caja',
      presentationQuantity: '1',
      presentationFormat: 'vial',
      createdBy: demoAdminUser.id,
    },
    select: { id: true },
  })

  const expiredBatch = await db.batch.upsert({
    where: { tenantId_productId_batchNumber: { tenantId: demoTenant.id, productId: product.id, batchNumber: 'LOT-EXPIRED' } },
    update: { expiresAt: addDaysUtc(todayUtc, -10) },
    create: {
      tenantId: demoTenant.id,
      productId: product.id,
      batchNumber: 'LOT-EXPIRED',
      expiresAt: addDaysUtc(todayUtc, -10),
      createdBy: demoAdminUser.id,
    },
    select: { id: true },
  })

  const yellowBatch = await db.batch.upsert({
    where: { tenantId_productId_batchNumber: { tenantId: demoTenant.id, productId: product.id, batchNumber: 'LOT-YELLOW' } },
    update: { expiresAt: addDaysUtc(todayUtc, 60) },
    create: {
      tenantId: demoTenant.id,
      productId: product.id,
      batchNumber: 'LOT-YELLOW',
      expiresAt: addDaysUtc(todayUtc, 60),
      createdBy: demoAdminUser.id,
    },
    select: { id: true },
  })

  await db.inventoryBalance.upsert({
    where: {
      tenantId_locationId_productId_batchId: {
        tenantId: demoTenant.id,
        locationId: loc.id,
        productId: product.id,
        batchId: expiredBatch.id,
      },
    },
    update: { quantity: '5' },
    create: {
      tenantId: demoTenant.id,
      locationId: loc.id,
      productId: product.id,
      batchId: expiredBatch.id,
      quantity: '5',
      createdBy: demoAdminUser.id,
    },
  })

  await db.inventoryBalance.upsert({
    where: {
      tenantId_locationId_productId_batchId: {
        tenantId: demoTenant.id,
        locationId: loc.id,
        productId: product.id,
        batchId: yellowBatch.id,
      },
    },
    update: { quantity: '20' },
    create: {
      tenantId: demoTenant.id,
      locationId: loc.id,
      productId: product.id,
      batchId: yellowBatch.id,
      quantity: '20',
      createdBy: demoAdminUser.id,
    },
  })

  // ============= MÁS DATOS DE PRUEBA =============

  // Warehouses adicionales en diferentes ciudades
  const whCochabamba = await db.warehouse.upsert({
    where: { tenantId_code: { tenantId: demoTenant.id, code: 'WH-02' } },
    update: { name: 'Sucursal Cochabamba', city: 'Cochabamba' },
    create: {
      tenantId: demoTenant.id,
      code: 'WH-02',
      name: 'Sucursal Cochabamba',
      city: 'Cochabamba',
      createdBy: demoAdminUser.id
    },
  })

  const whSantaCruz = await db.warehouse.upsert({
    where: { tenantId_code: { tenantId: demoTenant.id, code: 'WH-03' } },
    update: { name: 'Sucursal Santa Cruz', city: 'Santa Cruz' },
    create: {
      tenantId: demoTenant.id,
      code: 'WH-03',
      name: 'Sucursal Santa Cruz',
      city: 'Santa Cruz',
      createdBy: demoAdminUser.id
    },
  })

  // Ubicaciones para los nuevos warehouses
  const locCochabamba = await db.location.upsert({
    where: { tenantId_warehouseId_code: { tenantId: demoTenant.id, warehouseId: whCochabamba.id, code: 'BIN-02' } },
    update: {},
    create: { tenantId: demoTenant.id, warehouseId: whCochabamba.id, code: 'BIN-02', type: 'BIN', createdBy: demoAdminUser.id },
  })

  const locSantaCruz = await db.location.upsert({
    where: { tenantId_warehouseId_code: { tenantId: demoTenant.id, warehouseId: whSantaCruz.id, code: 'BIN-03' } },
    update: {},
    create: { tenantId: demoTenant.id, warehouseId: whSantaCruz.id, code: 'BIN-03', type: 'BIN', createdBy: demoAdminUser.id },
  })

  // Usuarios demo adicionales
  const ventasUser = await db.user.upsert({
    where: { tenantId_email: { tenantId: demoTenant.id, email: 'ventas@demo.local' } },
    update: { ...(updatePasswords ? { passwordHash } : {}), isActive: true },
    create: {
      tenantId: demoTenant.id,
      email: 'ventas@demo.local',
      passwordHash,
      fullName: 'Usuario Ventas',
      isActive: true,
      createdBy: demoAdminUser.id,
    },
    select: { id: true },
  })
  await db.userRole.upsert({
    where: { userId_roleId: { userId: ventasUser.id, roleId: ventasRole.id } },
    update: {},
    create: { userId: ventasUser.id, roleId: ventasRole.id },
  })

  const logisticaUser = await db.user.upsert({
    where: { tenantId_email: { tenantId: demoTenant.id, email: 'logistica@demo.local' } },
    update: { ...(updatePasswords ? { passwordHash } : {}), isActive: true },
    create: {
      tenantId: demoTenant.id,
      email: 'logistica@demo.local',
      passwordHash,
      fullName: 'Usuario Logística',
      isActive: true,
      createdBy: demoAdminUser.id,
    },
    select: { id: true },
  })
  await db.userRole.upsert({
    where: { userId_roleId: { userId: logisticaUser.id, roleId: logisticaRole.id } },
    update: {},
    create: { userId: logisticaUser.id, roleId: logisticaRole.id },
  })

  const branchAdminUser = await db.user.upsert({
    where: { tenantId_email: { tenantId: demoTenant.id, email: 'branch.scz@demo.local' } },
    update: { ...(updatePasswords ? { passwordHash } : {}), isActive: true, warehouseId: whSantaCruz.id },
    create: {
      tenantId: demoTenant.id,
      email: 'branch.scz@demo.local',
      passwordHash,
      fullName: 'Admin Sucursal (SCZ)',
      isActive: true,
      warehouseId: whSantaCruz.id,
      createdBy: demoAdminUser.id,
    },
    select: { id: true },
  })
  await db.userRole.upsert({
    where: { userId_roleId: { userId: branchAdminUser.id, roleId: branchAdminRole.id } },
    update: {},
    create: { userId: branchAdminUser.id, roleId: branchAdminRole.id },
  })

  // Clientes en diferentes ciudades
  const customerLaPaz = await db.customer.upsert({
    where: { id: 'customer-lp-001' }, // Usar ID fijo para upsert
    update: {
      businessName: 'Farmacia Central La Paz S.R.L.',
      nit: '123456789',
      contactName: 'María González',
      contactBirthDay: 15,
      contactBirthMonth: 3,
      contactBirthYear: 1985,
      email: 'contacto@farmaciacentral-lp.com',
      phone: '+591 22222222',
      address: 'Av. 16 de Julio #1234',
      city: 'La Paz',
      zone: 'Centro'
    },
    create: {
      id: 'customer-lp-001',
      tenantId: demoTenant.id,
      name: 'Farmacia Central La Paz',
      businessName: 'Farmacia Central La Paz S.R.L.',
      nit: '123456789',
      contactName: 'María González',
      contactBirthDay: 15,
      contactBirthMonth: 3,
      contactBirthYear: 1985,
      email: 'contacto@farmaciacentral-lp.com',
      phone: '+591 22222222',
      address: 'Av. 16 de Julio #1234',
      city: 'La Paz',
      zone: 'Centro',
      createdBy: demoAdminUser.id
    },
  })

  const customerCochabamba = await db.customer.upsert({
    where: { id: 'customer-cbba-001' },
    update: {
      businessName: 'Farmacia del Valle Ltda.',
      nit: '987654321',
      contactName: 'Carlos Rodríguez',
      contactBirthDay: 22,
      contactBirthMonth: 7,
      contactBirthYear: 1978,
      email: 'ventas@farmaciadelvalle.com',
      phone: '+591 44444444',
      address: 'Calle Bolívar #567',
      city: 'Cochabamba',
      zone: 'Zona Norte'
    },
    create: {
      id: 'customer-cbba-001',
      tenantId: demoTenant.id,
      name: 'Farmacia del Valle',
      businessName: 'Farmacia del Valle Ltda.',
      nit: '987654321',
      contactName: 'Carlos Rodríguez',
      contactBirthDay: 22,
      contactBirthMonth: 7,
      contactBirthYear: 1978,
      email: 'ventas@farmaciadelvalle.com',
      phone: '+591 44444444',
      address: 'Calle Bolívar #567',
      city: 'Cochabamba',
      zone: 'Zona Norte',
      createdBy: demoAdminUser.id
    },
  })

  const customerSantaCruz = await db.customer.upsert({
    where: { id: 'customer-scz-001' },
    update: {
      businessName: 'Farmacia Oriental S.A.',
      nit: '456789123',
      contactName: 'Ana López',
      contactBirthDay: 8,
      contactBirthMonth: 11,
      contactBirthYear: 1990,
      email: 'info@farmaciaoriental.com',
      phone: '+591 33333333',
      address: 'Av. San Martín #890',
      city: 'Santa Cruz',
      zone: 'Equipetrol'
    },
    create: {
      id: 'customer-scz-001',
      tenantId: demoTenant.id,
      name: 'Farmacia Oriental',
      businessName: 'Farmacia Oriental S.A.',
      nit: '456789123',
      contactName: 'Ana López',
      contactBirthDay: 8,
      contactBirthMonth: 11,
      contactBirthYear: 1990,
      email: 'info@farmaciaoriental.com',
      phone: '+591 33333333',
      address: 'Av. San Martín #890',
      city: 'Santa Cruz',
      zone: 'Equipetrol',
      createdBy: demoAdminUser.id
    },
  })

  // Productos adicionales con recetario
  const productIbuprofeno = await db.product.upsert({
    where: { tenantId_sku: { tenantId: demoTenant.id, sku: 'IBUP-400TAB' } },
    update: { name: 'Ibuprofeno 400mg (Tabletas)' },
    create: {
      tenantId: demoTenant.id,
      sku: 'IBUP-400TAB',
      name: 'Ibuprofeno 400mg (Tabletas)',
      description: 'Antiinflamatorio no esteroideo',
      createdBy: demoAdminUser.id,
    },
    select: { id: true },
  })

  const productAmoxicilina = await db.product.upsert({
    where: { tenantId_sku: { tenantId: demoTenant.id, sku: 'AMOX-500CAP' } },
    update: { name: 'Amoxicilina 500mg (Cápsulas)' },
    create: {
      tenantId: demoTenant.id,
      sku: 'AMOX-500CAP',
      name: 'Amoxicilina 500mg (Cápsulas)',
      description: 'Antibiótico de amplio espectro',
      createdBy: demoAdminUser.id,
    },
    select: { id: true },
  })

  // Recetarios para los productos (simplificado por ahora)
  // Nota: Los campos de prescripción no existen en el schema actual
  // await db.productRecipe.upsert({
  //   where: { tenantId_productId: { tenantId: demoTenant.id, productId: productIbuprofeno.id } },
  //   update: {
  //     recipeType: 'CONTROLADO',
  //     activeIngredients: 'Ibuprofeno 400mg',
  //     indications: 'Dolor, fiebre, inflamación',
  //     contraindications: 'Úlcera péptica, insuficiencia renal',
  //     dosage: '1 tableta cada 8 horas'
  //   },
  //   create: {
  //     tenantId: demoTenant.id,
  //     productId: productIbuprofeno.id,
  //     recipeType: 'CONTROLADO',
  //     activeIngredients: 'Ibuprofeno 400mg',
  //     indications: 'Dolor, fiebre, inflamación',
  //     contraindications: 'Úlcera péptica, insuficiencia renal',
  //     dosage: '1 tableta cada 8 horas',
  //     createdBy: demoAdminUser.id
  //   },
  // })

  // await db.productRecipe.upsert({
  //   where: { tenantId_productId: { tenantId: demoTenant.id, productId: productAmoxicilina.id } },
  //   update: {
  //     recipeType: 'CONTROLADO',
  //     activeIngredients: 'Amoxicilina trihidrato 500mg',
  //     indications: 'Infecciones bacterianas',
  //     contraindications: 'Alergia a penicilinas',
  //     dosage: '1 cápsula cada 8 horas por 7 días'
  //   },
  //   create: {
  //     tenantId: demoTenant.id,
  //     productId: productAmoxicilina.id,
  //     recipeType: 'CONTROLADO',
  //     activeIngredients: 'Amoxicilina trihidrato 500mg',
  //     indications: 'Infecciones bacterianas',
  //     contraindications: 'Alergia a penicilinas',
  //     dosage: '1 cápsula cada 8 horas por 7 días',
  //     createdBy: demoAdminUser.id
  //   },
  // })

  // Batches y stock para los nuevos productos en diferentes ciudades
  const ibuprofenoPresentation =
    (await db.productPresentation.findFirst({
      where: { tenantId: demoTenant.id, productId: productIbuprofeno.id, name: 'Caja de 10', isActive: true },
      select: { id: true, unitsPerPresentation: true },
    })) ??
    (await db.productPresentation.findFirst({
      where: { tenantId: demoTenant.id, productId: productIbuprofeno.id, isDefault: true, isActive: true },
      select: { id: true, unitsPerPresentation: true },
    }))
  const ibuprofenoUnitsPerPresentation = ibuprofenoPresentation ? Number(ibuprofenoPresentation.unitsPerPresentation.toString()) : 1

  const ibuprofenoBatch = await db.batch.upsert({
    where: { tenantId_productId_batchNumber: { tenantId: demoTenant.id, productId: productIbuprofeno.id, batchNumber: 'IBU-2024-01' } },
    update: { expiresAt: addDaysUtc(todayUtc, 365), presentationId: ibuprofenoPresentation?.id ?? null },
    create: {
      tenantId: demoTenant.id,
      productId: productIbuprofeno.id,
      batchNumber: 'IBU-2024-01',
      expiresAt: addDaysUtc(todayUtc, 365),
      presentationId: ibuprofenoPresentation?.id ?? null,
      createdBy: demoAdminUser.id,
    },
    select: { id: true },
  })

  const amoxicilinaPresentation =
    (await db.productPresentation.findFirst({
      where: { tenantId: demoTenant.id, productId: productAmoxicilina.id, name: 'Caja de 10', isActive: true },
      select: { id: true, unitsPerPresentation: true },
    })) ??
    (await db.productPresentation.findFirst({
      where: { tenantId: demoTenant.id, productId: productAmoxicilina.id, isDefault: true, isActive: true },
      select: { id: true, unitsPerPresentation: true },
    }))
  const amoxicilinaUnitsPerPresentation = amoxicilinaPresentation ? Number(amoxicilinaPresentation.unitsPerPresentation.toString()) : 1

  const amoxicilinaBatch = await db.batch.upsert({
    where: { tenantId_productId_batchNumber: { tenantId: demoTenant.id, productId: productAmoxicilina.id, batchNumber: 'AMOX-2024-01' } },
    update: { expiresAt: addDaysUtc(todayUtc, 400), presentationId: amoxicilinaPresentation?.id ?? null },
    create: {
      tenantId: demoTenant.id,
      productId: productAmoxicilina.id,
      batchNumber: 'AMOX-2024-01',
      expiresAt: addDaysUtc(todayUtc, 400),
      presentationId: amoxicilinaPresentation?.id ?? null,
      createdBy: demoAdminUser.id,
    },
    select: { id: true },
  })

  // Stock distribuido en diferentes ciudades
  // Ibuprofeno: La Paz (20), Cochabamba (15), Santa Cruz (10)
  const ibuprofenoLaPaz =
    ibuprofenoUnitsPerPresentation > 1 ? roundDownToMultiple(20, ibuprofenoUnitsPerPresentation) : 20
  const ibuprofenoCbba =
    ibuprofenoUnitsPerPresentation > 1 ? roundDownToMultiple(15, ibuprofenoUnitsPerPresentation) : 15
  const ibuprofenoScz =
    ibuprofenoUnitsPerPresentation > 1 ? roundDownToMultiple(10, ibuprofenoUnitsPerPresentation) : 10

  await db.inventoryBalance.upsert({
    where: {
      tenantId_locationId_productId_batchId: {
        tenantId: demoTenant.id,
        locationId: loc.id, // La Paz
        productId: productIbuprofeno.id,
        batchId: ibuprofenoBatch.id,
      },
    },
    update: { quantity: ibuprofenoLaPaz.toString() },
    create: {
      tenantId: demoTenant.id,
      locationId: loc.id,
      productId: productIbuprofeno.id,
      batchId: ibuprofenoBatch.id,
      quantity: ibuprofenoLaPaz.toString(),
      createdBy: demoAdminUser.id,
    },
  })

  await db.inventoryBalance.upsert({
    where: {
      tenantId_locationId_productId_batchId: {
        tenantId: demoTenant.id,
        locationId: locCochabamba.id,
        productId: productIbuprofeno.id,
        batchId: ibuprofenoBatch.id,
      },
    },
    update: { quantity: ibuprofenoCbba.toString() },
    create: {
      tenantId: demoTenant.id,
      locationId: locCochabamba.id,
      productId: productIbuprofeno.id,
      batchId: ibuprofenoBatch.id,
      quantity: ibuprofenoCbba.toString(),
      createdBy: demoAdminUser.id,
    },
  })

  await db.inventoryBalance.upsert({
    where: {
      tenantId_locationId_productId_batchId: {
        tenantId: demoTenant.id,
        locationId: locSantaCruz.id,
        productId: productIbuprofeno.id,
        batchId: ibuprofenoBatch.id,
      },
    },
    update: { quantity: ibuprofenoScz.toString() },
    create: {
      tenantId: demoTenant.id,
      locationId: locSantaCruz.id,
      productId: productIbuprofeno.id,
      batchId: ibuprofenoBatch.id,
      quantity: ibuprofenoScz.toString(),
      createdBy: demoAdminUser.id,
    },
  })

  // Amoxicilina: La Paz (12), Cochabamba (8), Santa Cruz (18)
  const amoxicilinaLaPaz =
    amoxicilinaUnitsPerPresentation > 1 ? roundDownToMultiple(12, amoxicilinaUnitsPerPresentation) : 12
  const amoxicilinaCbba =
    amoxicilinaUnitsPerPresentation > 1 ? roundDownToMultiple(8, amoxicilinaUnitsPerPresentation) : 8
  const amoxicilinaScz =
    amoxicilinaUnitsPerPresentation > 1 ? roundDownToMultiple(18, amoxicilinaUnitsPerPresentation) : 18

  await db.inventoryBalance.upsert({
    where: {
      tenantId_locationId_productId_batchId: {
        tenantId: demoTenant.id,
        locationId: loc.id, // La Paz
        productId: productAmoxicilina.id,
        batchId: amoxicilinaBatch.id,
      },
    },
    update: { quantity: amoxicilinaLaPaz.toString() },
    create: {
      tenantId: demoTenant.id,
      locationId: loc.id,
      productId: productAmoxicilina.id,
      batchId: amoxicilinaBatch.id,
      quantity: amoxicilinaLaPaz.toString(),
      createdBy: demoAdminUser.id,
    },
  })

  await db.inventoryBalance.upsert({
    where: {
      tenantId_locationId_productId_batchId: {
        tenantId: demoTenant.id,
        locationId: locCochabamba.id,
        productId: productAmoxicilina.id,
        batchId: amoxicilinaBatch.id,
      },
    },
    update: { quantity: amoxicilinaCbba.toString() },
    create: {
      tenantId: demoTenant.id,
      locationId: locCochabamba.id,
      productId: productAmoxicilina.id,
      batchId: amoxicilinaBatch.id,
      quantity: amoxicilinaCbba.toString(),
      createdBy: demoAdminUser.id,
    },
  })

  await db.inventoryBalance.upsert({
    where: {
      tenantId_locationId_productId_batchId: {
        tenantId: demoTenant.id,
        locationId: locSantaCruz.id,
        productId: productAmoxicilina.id,
        batchId: amoxicilinaBatch.id,
      },
    },
    update: { quantity: amoxicilinaScz.toString() },
    create: {
      tenantId: demoTenant.id,
      locationId: locSantaCruz.id,
      productId: productAmoxicilina.id,
      batchId: amoxicilinaBatch.id,
      quantity: amoxicilinaScz.toString(),
      createdBy: demoAdminUser.id,
    },
  })

  // ============= DATOS EXTENSIVOS PARA REPORTES ATRACTIVOS =============
  console.log('\n🔄 Generando datos extensivos para reportes...')
  
  // Productos de farmacia completos con precios y costos
  const farmaciaProducts = [
    { sku: 'MED-001', name: 'Paracetamol 500mg Tab x 100', price: 35, cost: 22, stock: 150 },
    { sku: 'MED-002', name: 'Ibuprofeno 400mg Tab x 50', price: 28, cost: 18, stock: 200 },
    { sku: 'MED-003', name: 'Omeprazol 20mg Cap x 28', price: 45, cost: 28, stock: 85 },
    { sku: 'MED-004', name: 'Amoxicilina 500mg Cap x 21', price: 55, cost: 35, stock: 120 },
    { sku: 'MED-005', name: 'Losartán 50mg Tab x 30', price: 42, cost: 26, stock: 95 },
    { sku: 'MED-006', name: 'Metformina 850mg Tab x 60', price: 38, cost: 24, stock: 175 },
    { sku: 'MED-007', name: 'Atorvastatina 20mg Tab x 30', price: 65, cost: 42, stock: 65 },
    { sku: 'MED-008', name: 'Amlodipino 5mg Tab x 30', price: 32, cost: 20, stock: 110 },
    { sku: 'MED-009', name: 'Vitamina C 1000mg Tab x 60', price: 48, cost: 30, stock: 220 },
    { sku: 'MED-010', name: 'Vitamina D3 1000UI Cap x 30', price: 55, cost: 35, stock: 140 },
    { sku: 'MED-011', name: 'Complejo B Tab x 100', price: 38, cost: 24, stock: 185 },
    { sku: 'MED-012', name: 'Omega 3 1000mg Cap x 60', price: 75, cost: 48, stock: 90 },
    { sku: 'MED-013', name: 'Clonazepam 2mg Tab x 30', price: 85, cost: 55, stock: 45 },
    { sku: 'MED-014', name: 'Diazepam 5mg Tab x 20', price: 35, cost: 22, stock: 60 },
    { sku: 'MED-015', name: 'Alprazolam 0.5mg Tab x 30', price: 65, cost: 42, stock: 55 },
    { sku: 'MED-016', name: 'Cetirizina 10mg Tab x 10', price: 18, cost: 11, stock: 280 },
    { sku: 'MED-017', name: 'Loratadina 10mg Tab x 10', price: 15, cost: 9, stock: 310 },
    { sku: 'MED-018', name: 'Dexametasona 4mg Tab x 10', price: 22, cost: 14, stock: 155 },
    { sku: 'MED-019', name: 'Prednisona 20mg Tab x 20', price: 28, cost: 18, stock: 125 },
    { sku: 'MED-020', name: 'Azitromicina 500mg Tab x 3', price: 35, cost: 22, stock: 95 },
    // Productos con stock bajo para alertas
    { sku: 'MED-021', name: 'Insulina Glargina 100UI Pluma', price: 450, cost: 320, stock: 8 },
    { sku: 'MED-022', name: 'Salbutamol Inhalador 100mcg', price: 125, cost: 85, stock: 5 },
    { sku: 'MED-023', name: 'Budesonida Inhalador 200mcg', price: 185, cost: 125, stock: 3 },
    { sku: 'MED-024', name: 'Tramadol 50mg Cap x 10', price: 55, cost: 35, stock: 6 },
    { sku: 'MED-025', name: 'Morfina 10mg Tab x 20', price: 95, cost: 65, stock: 4 },
    // Productos de cuidado personal
    { sku: 'CUI-001', name: 'Jabón Antibacterial 250ml', price: 18, cost: 11, stock: 350 },
    { sku: 'CUI-002', name: 'Crema Hidratante 200ml', price: 45, cost: 28, stock: 180 },
    { sku: 'CUI-003', name: 'Protector Solar FPS50 100ml', price: 85, cost: 55, stock: 95 },
    { sku: 'CUI-004', name: 'Shampoo Anticaspa 400ml', price: 65, cost: 42, stock: 145 },
    { sku: 'CUI-005', name: 'Alcohol en Gel 500ml', price: 25, cost: 15, stock: 420 },
  ]

  const createdProducts: { id: string; sku: string; price: number; stock: number }[] = []
  
  for (const p of farmaciaProducts) {
    const prod = await db.product.upsert({
      where: { tenantId_sku: { tenantId: demoTenant.id, sku: p.sku } },
      update: { name: p.name, price: p.price.toString(), cost: p.cost.toString() },
      create: {
        tenantId: demoTenant.id,
        sku: p.sku,
        name: p.name,
        price: p.price.toString(),
        cost: p.cost.toString(),
        createdBy: demoAdminUser.id,
      },
      select: { id: true },
    })
    createdProducts.push({ id: prod.id, sku: p.sku, price: p.price, stock: p.stock })
  }
  console.log(`   ✅ ${createdProducts.length} productos creados con precios y costos`)

  // Crear presentaciones para productos
  const productsWithPresentations = createdProducts // Todos los productos
  for (const p of productsWithPresentations) {
    const presentations = [
      { name: 'Unidad', unitsPerPresentation: 1, isDefault: true },
      { name: 'Caja de 10', unitsPerPresentation: 10, isDefault: false },
      { name: 'Caja de 20', unitsPerPresentation: 20, isDefault: false },
      { name: 'Caja de 50', unitsPerPresentation: 50, isDefault: false },
      { name: 'Caja de 100', unitsPerPresentation: 100, isDefault: false },
    ]
    for (const pres of presentations) {
      await db.productPresentation.upsert({
        where: { tenantId_productId_name: { tenantId: demoTenant.id, productId: p.id, name: pres.name } },
        update: {},
        create: {
          tenantId: demoTenant.id,
          productId: p.id,
          name: pres.name,
          unitsPerPresentation: pres.unitsPerPresentation.toString(),
          isDefault: pres.isDefault,
          sortOrder: pres.unitsPerPresentation,
          createdBy: demoAdminUser.id,
        },
      })
    }
  }
  console.log(`   ✅ Presentaciones creadas para ${productsWithPresentations.length} productos`)

  // Crear batches y stock para los nuevos productos
  for (const p of createdProducts) {
    const stockData = farmaciaProducts.find(fp => fp.sku === p.sku)!

    const presUnit = await db.productPresentation.findFirst({
      where: { tenantId: demoTenant.id, productId: p.id, name: 'Unidad', isActive: true },
      select: { id: true, unitsPerPresentation: true },
    })
    const presCaja10 = await db.productPresentation.findFirst({
      where: { tenantId: demoTenant.id, productId: p.id, name: 'Caja de 10', isActive: true },
      select: { id: true, unitsPerPresentation: true },
    })
    const presCaja20 = await db.productPresentation.findFirst({
      where: { tenantId: demoTenant.id, productId: p.id, name: 'Caja de 20', isActive: true },
      select: { id: true, unitsPerPresentation: true },
    })

    const unitUnitsPer = presUnit ? Number(presUnit.unitsPerPresentation.toString()) : 1
    const caja10UnitsPer = presCaja10 ? Number(presCaja10.unitsPerPresentation.toString()) : 10
    const caja20UnitsPer = presCaja20 ? Number(presCaja20.unitsPerPresentation.toString()) : 20

    const totalStockUnits = Math.max(stockData.stock, 0)

    const expiresAt = addDaysUtc(todayUtc, 365 + Math.floor(Math.random() * 365))
    const batchUnit = await db.batch.upsert({
      where: { tenantId_productId_batchNumber: { tenantId: demoTenant.id, productId: p.id, batchNumber: `${p.sku}-U-2025` } },
      update: { expiresAt, presentationId: presUnit?.id ?? null },
      create: { tenantId: demoTenant.id, productId: p.id, batchNumber: `${p.sku}-U-2025`, expiresAt, presentationId: presUnit?.id ?? null, createdBy: demoAdminUser.id },
      select: { id: true },
    })
    const batchCaja10 = await db.batch.upsert({
      where: { tenantId_productId_batchNumber: { tenantId: demoTenant.id, productId: p.id, batchNumber: `${p.sku}-C10-2025` } },
      update: { expiresAt, presentationId: presCaja10?.id ?? null },
      create: { tenantId: demoTenant.id, productId: p.id, batchNumber: `${p.sku}-C10-2025`, expiresAt, presentationId: presCaja10?.id ?? null, createdBy: demoAdminUser.id },
      select: { id: true },
    })
    const batchCaja20 = await db.batch.upsert({
      where: { tenantId_productId_batchNumber: { tenantId: demoTenant.id, productId: p.id, batchNumber: `${p.sku}-C20-2025` } },
      update: { expiresAt, presentationId: presCaja20?.id ?? null },
      create: { tenantId: demoTenant.id, productId: p.id, batchNumber: `${p.sku}-C20-2025`, expiresAt, presentationId: presCaja20?.id ?? null, createdBy: demoAdminUser.id },
      select: { id: true },
    })

    // Distribuir stock total en las 3 ubicaciones
    const locStockLaPaz = Math.ceil(totalStockUnits * 0.5)
    const locStockCbba = Math.ceil(totalStockUnits * 0.3)
    const locStockScz = Math.max(0, totalStockUnits - locStockLaPaz - locStockCbba)

    const splitByPresentation = (locationUnits: number) => {
      const caja10Units = roundDownToMultiple(locationUnits * 0.5, caja10UnitsPer)
      const caja20Units = roundDownToMultiple(locationUnits * 0.3, caja20UnitsPer)
      const used = caja10Units + caja20Units
      const unitUnits = Math.max(0, Math.round(locationUnits - used))
      return { unitUnits, caja10Units, caja20Units }
    }

    const laPaz = splitByPresentation(locStockLaPaz)
    const cbba = splitByPresentation(locStockCbba)
    const scz = splitByPresentation(locStockScz)

    const upsertBalance = async (locationId: string, batchId: string, qty: number) => {
      if (!Number.isFinite(qty) || qty <= 0) return
      await db.inventoryBalance.upsert({
        where: {
          tenantId_locationId_productId_batchId: {
            tenantId: demoTenant.id,
            locationId,
            productId: p.id,
            batchId,
          },
        },
        update: { quantity: String(Math.round(qty)) },
        create: {
          tenantId: demoTenant.id,
          locationId,
          productId: p.id,
          batchId,
          quantity: String(Math.round(qty)),
          createdBy: demoAdminUser.id,
        },
      })
    }

    await upsertBalance(loc.id, batchUnit.id, laPaz.unitUnits)
    await upsertBalance(loc.id, batchCaja10.id, laPaz.caja10Units)
    await upsertBalance(loc.id, batchCaja20.id, laPaz.caja20Units)

    await upsertBalance(locCochabamba.id, batchUnit.id, cbba.unitUnits)
    await upsertBalance(locCochabamba.id, batchCaja10.id, cbba.caja10Units)
    await upsertBalance(locCochabamba.id, batchCaja20.id, cbba.caja20Units)

    await upsertBalance(locSantaCruz.id, batchUnit.id, scz.unitUnits)
    await upsertBalance(locSantaCruz.id, batchCaja10.id, scz.caja10Units)
    await upsertBalance(locSantaCruz.id, batchCaja20.id, scz.caja20Units)
  }
  console.log('   ✅ Stock distribuido en todas las ubicaciones')

  // Crear productos con vencimientos próximos para alertas de expiración
  const expiringProducts = [
    { sku: 'EXP-001', name: 'Suero Oral x500ml', expiryDays: -5, qty: 12 }, // Vencido
    { sku: 'EXP-002', name: 'Leche de Fórmula NAN 1', expiryDays: 3, qty: 8 }, // Vence en 3 días
    { sku: 'EXP-003', name: 'Yogurt Probiótico x6', expiryDays: 7, qty: 24 }, // Vence en 7 días
    { sku: 'EXP-004', name: 'Jarabe para la Tos 120ml', expiryDays: 15, qty: 15 }, // Vence en 15 días
    { sku: 'EXP-005', name: 'Vitamina C Efervescente x20', expiryDays: 25, qty: 30 }, // Vence en 25 días
    { sku: 'EXP-006', name: 'Colirio Oftálmico 15ml', expiryDays: 45, qty: 20 }, // Vence en 45 días
  ]

  for (const ep of expiringProducts) {
    const prod = await db.product.upsert({
      where: { tenantId_sku: { tenantId: demoTenant.id, sku: ep.sku } },
      update: { name: ep.name },
      create: {
        tenantId: demoTenant.id,
        sku: ep.sku,
        name: ep.name,
        price: '35',
        cost: '22',
        createdBy: demoAdminUser.id,
      },
      select: { id: true },
    })

    // Presentaciones mínimas para dataset de vencimientos
    await db.productPresentation.upsert({
      where: { tenantId_productId_name: { tenantId: demoTenant.id, productId: prod.id, name: 'Unidad' } },
      update: {},
      create: {
        tenantId: demoTenant.id,
        productId: prod.id,
        name: 'Unidad',
        unitsPerPresentation: '1',
        isDefault: true,
        sortOrder: 1,
        createdBy: demoAdminUser.id,
      },
    })
    await db.productPresentation.upsert({
      where: { tenantId_productId_name: { tenantId: demoTenant.id, productId: prod.id, name: 'Caja de 10' } },
      update: {},
      create: {
        tenantId: demoTenant.id,
        productId: prod.id,
        name: 'Caja de 10',
        unitsPerPresentation: '10',
        isDefault: false,
        sortOrder: 10,
        createdBy: demoAdminUser.id,
      },
    })

    const caja10 = await db.productPresentation.findFirst({
      where: { tenantId: demoTenant.id, productId: prod.id, name: 'Caja de 10', isActive: true },
      select: { id: true },
    })
    const useCaja10 = !!caja10 && ep.qty >= 10
    const presentationId = useCaja10 ? caja10!.id : null
    const qtyUnits = useCaja10 ? Math.max(10, roundDownToMultiple(ep.qty, 10)) : ep.qty

    const batch = await db.batch.upsert({
      where: { tenantId_productId_batchNumber: { tenantId: demoTenant.id, productId: prod.id, batchNumber: `${ep.sku}-EXP` } },
      update: { expiresAt: addDaysUtc(todayUtc, ep.expiryDays), presentationId },
      create: {
        tenantId: demoTenant.id,
        productId: prod.id,
        batchNumber: `${ep.sku}-EXP`,
        expiresAt: addDaysUtc(todayUtc, ep.expiryDays),
        presentationId,
        createdBy: demoAdminUser.id,
      },
      select: { id: true },
    })

    await db.inventoryBalance.upsert({
      where: {
        tenantId_locationId_productId_batchId: {
          tenantId: demoTenant.id,
          locationId: loc.id,
          productId: prod.id,
          batchId: batch.id,
        },
      },
      update: { quantity: qtyUnits.toString() },
      create: {
        tenantId: demoTenant.id,
        locationId: loc.id,
        productId: prod.id,
        batchId: batch.id,
        quantity: qtyUnits.toString(),
        createdBy: demoAdminUser.id,
      },
    })
  }
  console.log('   ✅ Productos con vencimientos próximos creados')

  // ============= ÓRDENES DE VENTA HISTÓRICAS =============
  const customers = [customerLaPaz, customerCochabamba, customerSantaCruz]
  const warehouses = [
    { warehouse: wh, location: loc },
    { warehouse: whCochabamba, location: locCochabamba },
    { warehouse: whSantaCruz, location: locSantaCruz },
  ]

  // Generar órdenes de los últimos 12 meses con variación estacional
  const monthlyMultipliers = [0.8, 0.9, 1.0, 1.1, 1.2, 1.0, 0.9, 1.1, 1.3, 1.2, 1.4, 1.5] // Más ventas en fin de año
  
  let totalOrders = 0
  let totalSalesValue = 0

  const orderStatuses = ['DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED'] as const

  for (let monthOffset = 11; monthOffset >= -2; monthOffset--) { // Incluir 2 meses futuros
    const monthDate = new Date(todayUtc)
    monthDate.setMonth(monthDate.getMonth() - monthOffset)
    
    const multiplier = monthOffset >= 0 ? monthlyMultipliers[monthDate.getMonth()] : 0.5 // Menos órdenes futuras
    const ordersThisMonth = Math.floor(10 + Math.random() * 20 * multiplier) // 10-30+ órdenes por mes
    
    for (let o = 0; o < ordersThisMonth; o++) {
      const customer = customers[Math.floor(Math.random() * customers.length)]
      const warehouseData = warehouses[Math.floor(Math.random() * warehouses.length)]
      
      // Fecha aleatoria dentro del mes
      const orderDay = Math.floor(1 + Math.random() * 28)
      const orderDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), orderDay, 
        8 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60))
      
      // Estado aleatorio
      const status = orderStatuses[Math.floor(Math.random() * orderStatuses.length)]
      
      // Seleccionar 1-5 productos aleatorios
      const numProducts = 1 + Math.floor(Math.random() * 5)
      const selectedProducts = [...createdProducts]
        .sort(() => Math.random() - 0.5)
        .slice(0, numProducts)
      
      let orderTotal = 0
      const lineItems: any[] = []
      for (const sp of selectedProducts) {
        const qty = 1 + Math.floor(Math.random() * 5)
        const unitPrice = sp.price
        const lineTotal = qty * unitPrice
        orderTotal += lineTotal

        // Elegir presentación aleatoria si existe
        let presentationId: string | undefined
        let presentationQuantity: number | undefined
        let totalQty = qty
        if (productsWithPresentations.some(pwp => pwp.id === sp.id)) {
          const presentations = [
            { name: 'Unidad', units: 1 },
            { name: 'Caja de 10', units: 10 },
            { name: 'Caja de 20', units: 20 },
          ]
          const pres = presentations[Math.floor(Math.random() * presentations.length)]
          presentationQuantity = 1 + Math.floor(Math.random() * 5)
          totalQty = presentationQuantity * pres.units
          // Buscar la presentación
          const presRecord = await db.productPresentation.findFirst({
            where: { tenantId: demoTenant.id, productId: sp.id, name: pres.name },
            select: { id: true },
          })
          if (presRecord) {
            presentationId = presRecord.id
          }
        }
        
        lineItems.push({
          productId: sp.id,
          quantity: totalQty.toString(),
          presentationId,
          presentationQuantity: presentationId ? presentationQuantity!.toString() : null,
          unitPrice: unitPrice.toString(),
          createdBy: demoAdminUser.id,
        })
      }

      // Crear la orden
      const orderData: any = {
        tenantId: demoTenant.id,
        number: `ORD-${monthDate.getFullYear()}${String(monthDate.getMonth() + 1).padStart(2, '0')}-${String(totalOrders + 1).padStart(4, '0')}`,
        customerId: customer.id,
        status,
        note: `Orden generada para demo - ${monthDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}`,
        createdAt: orderDate,
        updatedAt: orderDate,
        createdBy: demoAdminUser.id,
        lines: {
          create: lineItems.map(li => ({
            tenantId: demoTenant.id,
            ...li,
          })),
        },
      }

      if (status === 'FULFILLED') {
        // Agregar fechas de entrega y pago aleatorias
        const deliveryDays = 1 + Math.floor(Math.random() * 7)
        const deliveredAt = new Date(orderDate.getTime() + deliveryDays * 86400000)
        orderData.deliveredAt = deliveredAt
        orderData.deliveryCity = customer.city
        orderData.deliveryZone = 'Centro'
        orderData.deliveryAddress = 'Dirección de entrega'

        // 80% de las órdenes entregadas están pagadas
        if (Math.random() < 0.8) {
          const paymentDays = Math.floor(Math.random() * 3)
          orderData.paidAt = new Date(deliveredAt.getTime() + paymentDays * 86400000)
          orderData.paidBy = demoAdminUser.id
        }
      }

      const order = await db.salesOrder.create({
        data: orderData,
      })

      // Crear movimientos de stock para cada línea (solo para órdenes cumplidas)
      if (status === 'FULFILLED') {
        for (const li of lineItems) {
          // Buscar un batch existente para el producto
          const existingBatch = await db.batch.findFirst({
            where: { tenantId: demoTenant.id, productId: li.productId },
            select: { id: true },
          })
          
          if (existingBatch) {
            await db.stockMovement.create({
              data: {
                tenantId: demoTenant.id,
                number: `SM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                numberYear: new Date().getFullYear(),
                productId: li.productId,
                batchId: existingBatch.id,
                fromLocationId: warehouseData.location.id,
                type: 'OUT',
                quantity: -li.quantity,
                note: `Venta ${order.id}`,
                referenceType: 'SALES_ORDER',
                referenceId: order.id,
                createdAt: orderDate,
                createdBy: demoAdminUser.id,
              },
            })
          }
        }
      }

      totalOrders++
      totalSalesValue += orderTotal
    }
  }
  console.log(`   ✅ ${totalOrders} órdenes de venta creadas (valor total: Bs ${totalSalesValue.toLocaleString()})`)

  // ============= COTIZACIONES =============
  let totalQuotes = 0
  const quoteStatuses = ['CREATED', 'PROCESSED'] as const

  for (let monthOffset = 11; monthOffset >= -1; monthOffset--) { // Incluir 1 mes futuro
    const monthDate = new Date(todayUtc)
    monthDate.setMonth(monthDate.getMonth() - monthOffset)
    
    const quotesThisMonth = Math.floor(5 + Math.random() * 15)
    
    for (let q = 0; q < quotesThisMonth; q++) {
      const customer = customers[Math.floor(Math.random() * customers.length)]
      
      const quoteDay = Math.floor(1 + Math.random() * 28)
      const quoteDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), quoteDay, 
        8 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60))
      
      const status = quoteStatuses[Math.floor(Math.random() * quoteStatuses.length)]
      
      const numProducts = 1 + Math.floor(Math.random() * 4)
      const selectedProducts = [...createdProducts]
        .sort(() => Math.random() - 0.5)
        .slice(0, numProducts)
      
      let quoteTotal = 0
      const quoteLines: any[] = []
      for (const sp of selectedProducts) {
        const qty = 1 + Math.floor(Math.random() * 10)
        const unitPrice = sp.price
        const lineTotal = qty * unitPrice
        quoteTotal += lineTotal

        // Elegir presentación aleatoria si existe
        let presentationId: string | undefined
        let presentationQuantity: number | undefined
        let totalQty = qty
        if (productsWithPresentations.some(pwp => pwp.id === sp.id)) {
          const presentations = [
            { name: 'Unidad', units: 1 },
            { name: 'Caja de 10', units: 10 },
            { name: 'Caja de 20', units: 20 },
          ]
          const pres = presentations[Math.floor(Math.random() * presentations.length)]
          presentationQuantity = 1 + Math.floor(Math.random() * 5)
          totalQty = presentationQuantity * pres.units
          // Buscar la presentación
          const presRecord = await db.productPresentation.findFirst({
            where: { tenantId: demoTenant.id, productId: sp.id, name: pres.name },
            select: { id: true },
          })
          if (presRecord) {
            presentationId = presRecord.id
          }
        }

        quoteLines.push({
          tenantId: demoTenant.id,
          productId: sp.id,
          quantity: totalQty.toString(),
          presentationId,
          presentationQuantity: presentationId ? presentationQuantity!.toString() : null,
          unitPrice: unitPrice.toString(),
          discountPct: '0',
          createdBy: demoAdminUser.id,
        })
      }

      const quoteData: any = {
        tenantId: demoTenant.id,
        number: `QT-${monthDate.getFullYear()}${String(monthDate.getMonth() + 1).padStart(2, '0')}-${String(totalQuotes + 1).padStart(4, '0')}`,
        customerId: customer.id,
        status,
        validityDays: 7,
        paymentMode: 'CASH',
        deliveryDays: 1,
        deliveryCity: customer.city,
        globalDiscountPct: '0',
        createdAt: quoteDate,
        updatedAt: quoteDate,
        createdBy: demoAdminUser.id,
        lines: {
          create: quoteLines,
        },
      }

      if (status === 'PROCESSED') {
        quoteData.processedAt = new Date(quoteDate.getTime() + (1 + Math.random() * 7) * 86400000)
      }

      const quote = await db.quote.create({
        data: quoteData,
      })

      if (status === 'PROCESSED') {
        // Crear orden desde la cotización
        const orderFromQuote = await db.salesOrder.create({
          data: {
            tenantId: demoTenant.id,
            number: `ORD-${monthDate.getFullYear()}${String(monthDate.getMonth() + 1).padStart(2, '0')}-${String(totalOrders + 1).padStart(4, '0')}`,
            customerId: customer.id,
            quoteId: quote.id,
            status: 'FULFILLED',
            note: `Orden desde cotización ${quote.number}`,
            createdAt: quoteData.processedAt,
            updatedAt: quoteData.processedAt,
            createdBy: demoAdminUser.id,
            lines: {
              create: quoteLines.map(ql => ({
                tenantId: demoTenant.id,
                productId: ql.productId,
                quantity: ql.quantity,
                presentationId: ql.presentationId,
                presentationQuantity: ql.presentationQuantity,
                unitPrice: ql.unitPrice,
                createdBy: demoAdminUser.id,
              })),
            },
          },
        })
        totalOrders++
      }

      totalQuotes++
    }
  }
  console.log(`   ✅ ${totalQuotes} cotizaciones creadas (${quoteStatuses.map(s => `${s}: ${Math.floor(totalQuotes / quoteStatuses.length)}`).join(', ')})`)

  // ============= SOLICITUDES DE MOVIMIENTOS =============
  let totalRequests = 0
  const requestStatuses = ['OPEN', 'FULFILLED', 'CANCELLED'] as const

  for (let r = 0; r < 20; r++) {
    const cities = ['La Paz', 'Cochabamba', 'Santa Cruz']
    const requestedCity = cities[Math.floor(Math.random() * cities.length)]
    const status = requestStatuses[Math.floor(Math.random() * requestStatuses.length)]
    
    const daysAgo = Math.floor(Math.random() * 60)
    const requestDate = addDaysUtc(todayUtc, -daysAgo)
    
    const numItems = 1 + Math.floor(Math.random() * 3)
    const selectedProducts = [...createdProducts]
      .sort(() => Math.random() - 0.5)
      .slice(0, numItems)
    
    const requestItems: any[] = []
    for (const sp of selectedProducts) {
      // Elegir presentación aleatoria si existe
      let presentationId: string | undefined
      let presentationQuantity: number | undefined
      let totalQty = 0
      if (productsWithPresentations.some(pwp => pwp.id === sp.id)) {
        const presentations = [
          { name: 'Unidad', units: 1 },
          { name: 'Caja de 10', units: 10 },
          { name: 'Caja de 20', units: 20 },
        ]
        const pres = presentations[Math.floor(Math.random() * presentations.length)]
        presentationQuantity = 1 + Math.floor(Math.random() * 5)
        totalQty = presentationQuantity
        // Buscar la presentación
        const presRecord = await db.productPresentation.findFirst({
          where: { tenantId: demoTenant.id, productId: sp.id, name: pres.name },
          select: { id: true },
        })
        if (presRecord) {
          presentationId = presRecord.id
        }
      } else {
        // Si no hay presentaciones, usar unidades
        totalQty = 10 + Math.floor(Math.random() * 50)
      }
      
      requestItems.push({
        tenantId: demoTenant.id,
        productId: sp.id,
        requestedQuantity: totalQty.toString(),
        remainingQuantity: status === 'OPEN' ? totalQty.toString() : '0',
        presentationId,
        presentationQuantity: presentationId ? presentationQuantity!.toString() : null,
      })
    }

    const requestData: any = {
      tenantId: demoTenant.id,
      status,
      requestedCity,
      requestedBy: demoAdminUser.id,
      note: `Solicitud de stock para ${requestedCity}`,
      createdAt: requestDate,
      updatedAt: requestDate,
      items: {
        create: requestItems,
      },
    }

    if (status === 'FULFILLED') {
      requestData.fulfilledAt = new Date(requestDate.getTime() + (1 + Math.random() * 7) * 86400000)
      requestData.fulfilledBy = demoAdminUser.id

      // Confirmación: algunas quedan pendientes, otras aceptadas/rechazadas para mostrar el flujo
      const confirmations = ['PENDING', 'ACCEPTED', 'REJECTED'] as const
      const confirmationStatus = confirmations[Math.floor(Math.random() * confirmations.length)]
      requestData.confirmationStatus = confirmationStatus
      if (confirmationStatus !== 'PENDING') {
        requestData.confirmedAt = new Date(requestData.fulfilledAt.getTime() + 3600_000)
        requestData.confirmedBy = demoAdminUser.id
        requestData.confirmationNote =
          confirmationStatus === 'ACCEPTED'
            ? 'Recibido conforme (seed)'
            : 'Observación: faltó parte del stock (seed)'
      }
    }

    await db.stockMovementRequest.create({
      data: requestData,
    })

    totalRequests++
  }
  console.log(`   ✅ ${totalRequests} solicitudes de movimientos creadas (${requestStatuses.map(s => `${s}: ${Math.floor(totalRequests / requestStatuses.length)}`).join(', ')})`)

  // ============= DEVOLUCIONES (OPS) =============
  // Crear algunas devoluciones para alimentar el módulo y reportes OPS.
  // Nota: aquí no se crean movimientos/balances; los reportes OPS consultan StockReturn/StockReturnItem.
  const returnDates = [addDaysUtc(todayUtc, -5), addDaysUtc(todayUtc, -15), addDaysUtc(todayUtc, -25)]
  const returnLocations = [locSantaCruz, locCochabamba, loc]
  const returnReasons = ['Producto dañado', 'Devolución de cliente', 'Cambio de lote']

  // Crear devoluciones usando productos/batches ya existentes
  for (let i = 0; i < 3; i++) {
    const toLocation = returnLocations[i % returnLocations.length]
    const createdAt = returnDates[i % returnDates.length]

    const p1 = createdProducts[Math.floor(Math.random() * createdProducts.length)]
    const p2 = createdProducts[Math.floor(Math.random() * createdProducts.length)]

    const b1 = await db.batch.findFirst({ where: { tenantId: demoTenant.id, productId: p1.id }, select: { id: true } })
    const b2 = await db.batch.findFirst({ where: { tenantId: demoTenant.id, productId: p2.id }, select: { id: true } })

    const sr = await db.stockReturn.create({
      data: {
        tenantId: demoTenant.id,
        toLocationId: toLocation.id,
        reason: returnReasons[i % returnReasons.length],
        note: 'Registro demo (seed)',
        photoKey: null,
        photoUrl: null,
        sourceType: null,
        sourceId: null,
        createdAt,
        createdBy: demoAdminUser.id,
      },
      select: { id: true },
    })

    const itemsData: any[] = []
    if (b1) itemsData.push({ tenantId: demoTenant.id, returnId: sr.id, productId: p1.id, batchId: b1.id, quantity: '3', createdAt, createdBy: demoAdminUser.id })
    if (b2) itemsData.push({ tenantId: demoTenant.id, returnId: sr.id, productId: p2.id, batchId: b2.id, quantity: '2', createdAt, createdBy: demoAdminUser.id })

    if (itemsData.length > 0) {
      await db.stockReturnItem.createMany({ data: itemsData })
    }
  }
  console.log('   ✅ 3 devoluciones creadas (seed)')

  // ============= MOVIMIENTOS DE STOCK ADICIONALES (ENTRADAS) =============
  // Crear movimientos de entrada para simular reposiciones
  for (let i = 0; i < 50; i++) {
    const product = createdProducts[Math.floor(Math.random() * createdProducts.length)]
    const warehouseData = warehouses[Math.floor(Math.random() * warehouses.length)]
    const qty = 10 + Math.floor(Math.random() * 50)
    const daysAgo = Math.floor(Math.random() * 180)
    const movDate = addDaysUtc(todayUtc, -daysAgo)

    const existingBatch = await db.batch.findFirst({
      where: { tenantId: demoTenant.id, productId: product.id },
      select: { id: true },
    })

    if (existingBatch) {
      await db.stockMovement.create({
        data: {
          tenantId: demoTenant.id,
          number: `SM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          numberYear: new Date().getFullYear(),
          productId: product.id,
          batchId: existingBatch.id,
          toLocationId: warehouseData.location.id,
          type: 'IN',
          quantity: qty,
          note: `Reposición de inventario`,
          createdAt: movDate,
          createdBy: demoAdminUser.id,
        },
      })
    }
  }
  console.log('   ✅ Movimientos de entrada (reposiciones) creados')

  console.log('\n📊 Resumen de datos para reportes:')
  console.log(`   - Productos: ${createdProducts.length + expiringProducts.length + 7}`)
  console.log(`   - Órdenes de venta: ${totalOrders}`)
  console.log(`   - Valor total de ventas: Bs ${totalSalesValue.toLocaleString()}`)
  console.log(`   - Clientes: 3`)
  console.log(`   - Almacenes: 3`)
  console.log(`   - Productos con stock bajo: 5`)
  console.log(`   - Productos próximos a vencer: 6`)

  // eslint-disable-next-line no-console
  console.log('✅ Seed completed successfully!')
  console.log('\n📦 Platform Tenant (Supernovatel):')
  console.log(`   - ID: ${platformTenant.id}`)
  console.log(`   - Domain: ${platformDomain}`)
  console.log(`   - Admin users:`)
  console.log(`     * admin@supernovatel.com / ${adminPassword}`)
  console.log(`     * usuario1@supernovatel.com / ${adminPassword}`)
  console.log(`   - Role: PLATFORM_ADMIN (all permissions including platform:tenants:manage)`)
  
  console.log('\n🏢 Demo Tenant:')
  console.log(`   - ID: ${demoTenant.id}`)
  console.log(`   - Name: ${tenantName}`)
  console.log(`   - Domain: demo.localhost`)
  console.log(`   - Admin: ${adminEmail} / ${adminPassword}`)
  console.log(`   - Role: TENANT_ADMIN (all permissions except platform:tenants:manage)`)
  console.log(`   - Usuarios demo:`)
  console.log(`     * ventas@demo.local / ${adminPassword} (VENTAS)`)
  console.log(`     * logistica@demo.local / ${adminPassword} (LOGISTICA)`)
  console.log(`     * branch.scz@demo.local / ${adminPassword} (BRANCH_ADMIN, preseleccionado en WH-03 Santa Cruz)`)
  console.log(`   - Subscription: ${demoTenant.branchLimit} branches until ${demoTenant.subscriptionExpiresAt}`)
  console.log(`   - Contact: ${demoTenant.contactName} (${demoTenant.contactEmail}, ${demoTenant.contactPhone})`)

  await db.$disconnect()
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e)
  process.exit(1)
})
