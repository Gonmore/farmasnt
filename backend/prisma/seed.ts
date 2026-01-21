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

async function main() {
  const Permissions = await loadPermissions()
  const db = createDb()

  const tenantName = process.env.SEED_TENANT_NAME ?? 'Demo Pharma'
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@demo.local'
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Admin123'
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

  // Add localhost domain for local development
  await db.tenantDomain.upsert({
    where: { domain: 'localhost' },
    update: { tenantId: demoTenant.id, isPrimary: false, verifiedAt: new Date() },
    create: { tenantId: demoTenant.id, domain: 'localhost', isPrimary: false, verifiedAt: new Date(), createdBy: null },
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

  // ============= LIMPIEZA DE DATOS ANTERIORES =============
  console.log('\n🧹 Limpiando datos anteriores...')
  
  // Eliminar en orden inverso de dependencias
  await db.salesOrderLine.deleteMany({ where: { tenantId: demoTenant.id } })
  await db.salesOrder.deleteMany({ where: { tenantId: demoTenant.id } })
  await db.quoteLine.deleteMany({ where: { tenantId: demoTenant.id } })
  await db.quote.deleteMany({ where: { tenantId: demoTenant.id } })
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
  const ibuprofenoBatch = await db.batch.upsert({
    where: { tenantId_productId_batchNumber: { tenantId: demoTenant.id, productId: productIbuprofeno.id, batchNumber: 'IBU-2024-01' } },
    update: { expiresAt: addDaysUtc(todayUtc, 365) },
    create: {
      tenantId: demoTenant.id,
      productId: productIbuprofeno.id,
      batchNumber: 'IBU-2024-01',
      expiresAt: addDaysUtc(todayUtc, 365),
      createdBy: demoAdminUser.id,
    },
    select: { id: true },
  })

  const amoxicilinaBatch = await db.batch.upsert({
    where: { tenantId_productId_batchNumber: { tenantId: demoTenant.id, productId: productAmoxicilina.id, batchNumber: 'AMOX-2024-01' } },
    update: { expiresAt: addDaysUtc(todayUtc, 400) },
    create: {
      tenantId: demoTenant.id,
      productId: productAmoxicilina.id,
      batchNumber: 'AMOX-2024-01',
      expiresAt: addDaysUtc(todayUtc, 400),
      createdBy: demoAdminUser.id,
    },
    select: { id: true },
  })

  // Stock distribuido en diferentes ciudades
  // Ibuprofeno: La Paz (20), Cochabamba (15), Santa Cruz (10)
  await db.inventoryBalance.upsert({
    where: {
      tenantId_locationId_productId_batchId: {
        tenantId: demoTenant.id,
        locationId: loc.id, // La Paz
        productId: productIbuprofeno.id,
        batchId: ibuprofenoBatch.id,
      },
    },
    update: { quantity: '20' },
    create: {
      tenantId: demoTenant.id,
      locationId: loc.id,
      productId: productIbuprofeno.id,
      batchId: ibuprofenoBatch.id,
      quantity: '20',
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
    update: { quantity: '15' },
    create: {
      tenantId: demoTenant.id,
      locationId: locCochabamba.id,
      productId: productIbuprofeno.id,
      batchId: ibuprofenoBatch.id,
      quantity: '15',
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
    update: { quantity: '10' },
    create: {
      tenantId: demoTenant.id,
      locationId: locSantaCruz.id,
      productId: productIbuprofeno.id,
      batchId: ibuprofenoBatch.id,
      quantity: '10',
      createdBy: demoAdminUser.id,
    },
  })

  // Amoxicilina: La Paz (12), Cochabamba (8), Santa Cruz (18)
  await db.inventoryBalance.upsert({
    where: {
      tenantId_locationId_productId_batchId: {
        tenantId: demoTenant.id,
        locationId: loc.id, // La Paz
        productId: productAmoxicilina.id,
        batchId: amoxicilinaBatch.id,
      },
    },
    update: { quantity: '12' },
    create: {
      tenantId: demoTenant.id,
      locationId: loc.id,
      productId: productAmoxicilina.id,
      batchId: amoxicilinaBatch.id,
      quantity: '12',
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
    update: { quantity: '8' },
    create: {
      tenantId: demoTenant.id,
      locationId: locCochabamba.id,
      productId: productAmoxicilina.id,
      batchId: amoxicilinaBatch.id,
      quantity: '8',
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
    update: { quantity: '18' },
    create: {
      tenantId: demoTenant.id,
      locationId: locSantaCruz.id,
      productId: productAmoxicilina.id,
      batchId: amoxicilinaBatch.id,
      quantity: '18',
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

  // Crear batches y stock para los nuevos productos
  for (const p of createdProducts) {
    const stockData = farmaciaProducts.find(fp => fp.sku === p.sku)!
    
    // Crear batch
    const batch = await db.batch.upsert({
      where: { tenantId_productId_batchNumber: { tenantId: demoTenant.id, productId: p.id, batchNumber: `${p.sku}-2025-01` } },
      update: { expiresAt: addDaysUtc(todayUtc, 365 + Math.floor(Math.random() * 365)) },
      create: {
        tenantId: demoTenant.id,
        productId: p.id,
        batchNumber: `${p.sku}-2025-01`,
        expiresAt: addDaysUtc(todayUtc, 365 + Math.floor(Math.random() * 365)),
        createdBy: demoAdminUser.id,
      },
      select: { id: true },
    })

    // Distribuir stock en las 3 ubicaciones
    const stockLaPaz = Math.ceil(stockData.stock * 0.5)
    const stockCbba = Math.ceil(stockData.stock * 0.3)
    const stockScz = stockData.stock - stockLaPaz - stockCbba

    await db.inventoryBalance.upsert({
      where: {
        tenantId_locationId_productId_batchId: {
          tenantId: demoTenant.id,
          locationId: loc.id,
          productId: p.id,
          batchId: batch.id,
        },
      },
      update: { quantity: stockLaPaz.toString() },
      create: {
        tenantId: demoTenant.id,
        locationId: loc.id,
        productId: p.id,
        batchId: batch.id,
        quantity: stockLaPaz.toString(),
        createdBy: demoAdminUser.id,
      },
    })

    if (stockCbba > 0) {
      await db.inventoryBalance.upsert({
        where: {
          tenantId_locationId_productId_batchId: {
            tenantId: demoTenant.id,
            locationId: locCochabamba.id,
            productId: p.id,
            batchId: batch.id,
          },
        },
        update: { quantity: stockCbba.toString() },
        create: {
          tenantId: demoTenant.id,
          locationId: locCochabamba.id,
          productId: p.id,
          batchId: batch.id,
          quantity: stockCbba.toString(),
          createdBy: demoAdminUser.id,
        },
      })
    }

    if (stockScz > 0) {
      await db.inventoryBalance.upsert({
        where: {
          tenantId_locationId_productId_batchId: {
            tenantId: demoTenant.id,
            locationId: locSantaCruz.id,
            productId: p.id,
            batchId: batch.id,
          },
        },
        update: { quantity: stockScz.toString() },
        create: {
          tenantId: demoTenant.id,
          locationId: locSantaCruz.id,
          productId: p.id,
          batchId: batch.id,
          quantity: stockScz.toString(),
          createdBy: demoAdminUser.id,
        },
      })
    }
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

    const batch = await db.batch.upsert({
      where: { tenantId_productId_batchNumber: { tenantId: demoTenant.id, productId: prod.id, batchNumber: `${ep.sku}-EXP` } },
      update: { expiresAt: addDaysUtc(todayUtc, ep.expiryDays) },
      create: {
        tenantId: demoTenant.id,
        productId: prod.id,
        batchNumber: `${ep.sku}-EXP`,
        expiresAt: addDaysUtc(todayUtc, ep.expiryDays),
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
      update: { quantity: ep.qty.toString() },
      create: {
        tenantId: demoTenant.id,
        locationId: loc.id,
        productId: prod.id,
        batchId: batch.id,
        quantity: ep.qty.toString(),
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

  for (let monthOffset = 11; monthOffset >= 0; monthOffset--) {
    const monthDate = new Date(todayUtc)
    monthDate.setMonth(monthDate.getMonth() - monthOffset)
    
    const multiplier = monthlyMultipliers[monthDate.getMonth()]
    const ordersThisMonth = Math.floor(15 + Math.random() * 20 * multiplier) // 15-35+ órdenes por mes
    
    for (let o = 0; o < ordersThisMonth; o++) {
      const customer = customers[Math.floor(Math.random() * customers.length)]
      const warehouseData = warehouses[Math.floor(Math.random() * warehouses.length)]
      
      // Fecha aleatoria dentro del mes
      const orderDay = Math.floor(1 + Math.random() * 28)
      const orderDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), orderDay, 
        8 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60))
      
      // Seleccionar 1-5 productos aleatorios
      const numProducts = 1 + Math.floor(Math.random() * 5)
      const selectedProducts = [...createdProducts]
        .sort(() => Math.random() - 0.5)
        .slice(0, numProducts)
      
      let orderTotal = 0
      const lineItems = selectedProducts.map(sp => {
        const qty = 1 + Math.floor(Math.random() * 5)
        const unitPrice = sp.price
        const lineTotal = qty * unitPrice
        orderTotal += lineTotal
        
        return {
          productId: sp.id,
          quantity: qty.toString(),
          unitPrice: unitPrice.toString(),
          createdBy: demoAdminUser.id,
        }
      })

      // Crear la orden
      const order = await db.salesOrder.create({
        data: {
          tenantId: demoTenant.id,
          number: `ORD-${monthDate.getFullYear()}${String(monthDate.getMonth() + 1).padStart(2, '0')}-${String(totalOrders + 1).padStart(4, '0')}`,
          customerId: customer.id,
          status: 'FULFILLED',
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
        },
      })

      // Crear movimientos de stock para cada línea
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

      totalOrders++
      totalSalesValue += orderTotal
    }
  }
  console.log(`   ✅ ${totalOrders} órdenes de venta creadas (valor total: Bs ${totalSalesValue.toLocaleString()})`)

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
  console.log(`   - Subscription: ${demoTenant.branchLimit} branches until ${demoTenant.subscriptionExpiresAt}`)
  console.log(`   - Contact: ${demoTenant.contactName} (${demoTenant.contactEmail}, ${demoTenant.contactPhone})`)

  await db.$disconnect()
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e)
  process.exit(1)
})
