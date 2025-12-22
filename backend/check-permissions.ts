import 'dotenv/config'
import { prisma } from './src/adapters/db/prisma.js'

async function main() {
  const db = prisma()

  const users = await db.user.findMany({
    where: {
      email: {
        in: ['admin@supernovatel.com', 'usuario1@supernovatel.com', 'admin@demo.local']
      }
    },
    select: {
      email: true,
      tenant: { select: { name: true } },
      roles: {
        select: {
          role: {
            select: {
              code: true,
              name: true,
              permissions: {
                select: {
                  permission: {
                    select: { code: true }
                  }
                }
              }
            }
          }
        }
      }
    }
  })

  for (const user of users) {
    console.log('\n' + '='.repeat(60))
    console.log(`Usuario: ${user.email}`)
    console.log(`Tenant: ${user.tenant.name}`)
    console.log(`Roles: ${user.roles.map(r => r.role.name).join(', ')}`)
    console.log('Permisos:')
    
    const allPerms = new Set<string>()
    for (const userRole of user.roles) {
      for (const rolePerm of userRole.role.permissions) {
        allPerms.add(rolePerm.permission.code)
      }
    }
    
    Array.from(allPerms).sort().forEach(p => console.log(`  - ${p}`))
  }

  console.log('\n' + '='.repeat(60))
  await db.$disconnect()
}

main().catch(console.error)
