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
  
  // Platform Tenant (Supernovatel)
  const platformTenantId = '00000000-0000-0000-0000-000000000001'
  const isPlatformTenant = true

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
    { code: Permissions.CatalogRead, module: 'WAREHOUSE' },
    { code: Permissions.CatalogWrite, module: 'WAREHOUSE' },
    { code: Permissions.StockRead, module: 'WAREHOUSE' },
    { code: Permissions.StockManage, module: 'WAREHOUSE' },
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
    update: { passwordHash, isActive: true },
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
    update: { passwordHash, isActive: true },
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

  const demoAdminUser = await db.user.upsert({
    where: { tenantId_email: { tenantId: demoTenant.id, email: adminEmail } },
    update: { passwordHash, isActive: true },
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
  console.log(`   - Subscription: ${demoTenant.branchLimit} branches until ${demoTenant.subscriptionExpiresAt}`)
  console.log(`   - Contact: ${demoTenant.contactName} (${demoTenant.contactEmail}, ${demoTenant.contactPhone})`)
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e)
  process.exit(1)
})
