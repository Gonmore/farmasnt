import { prisma } from './src/adapters/db/prisma.js'
import { Permissions } from './src/application/security/permissions.js'

async function assignStockManagePermission() {
  const db = prisma()

  try {
    // Find the StockManage permission
    const stockManagePermission = await db.permission.findFirst({
      where: { code: Permissions.StockManage }
    })

    if (!stockManagePermission) {
      console.log('❌ StockManage permission not found')
      return
    }

    // Find all TENANT_ADMIN roles
    const tenantAdminRoles = await db.role.findMany({
      where: { code: 'TENANT_ADMIN' }
    })

    console.log(`Found ${tenantAdminRoles.length} TENANT_ADMIN roles`)

    // Assign StockManage permission to each TENANT_ADMIN role
    for (const role of tenantAdminRoles) {
      const existing = await db.rolePermission.findFirst({
        where: {
          roleId: role.id,
          permissionId: stockManagePermission.id
        }
      })

      if (!existing) {
        await db.rolePermission.create({
          data: {
            roleId: role.id,
            permissionId: stockManagePermission.id
          }
        })
        console.log(`✅ Assigned StockManage to role ${role.name} (${role.tenantId})`)
      } else {
        console.log(`ℹ️  Role ${role.name} (${role.tenantId}) already has StockManage`)
      }
    }

    console.log('✅ Migration completed successfully')
  } catch (error) {
    console.error('❌ Migration failed:', error)
  } finally {
    await db.$disconnect()
  }
}

assignStockManagePermission()