import type { FastifyRequest } from 'fastify'
import type { PrismaClient } from '../../generated/prisma/client.js'
import type { PermissionCode } from './permissions.js'

export type ModuleCode = 'WAREHOUSE' | 'SALES' | 'PRODUCTION' | 'DISTRIBUTION' | 'RND'

export type AuthContext = {
  userId: string
  tenantId: string
  permissions: Set<string>
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext
  }
}

export async function loadUserPermissions(prisma: PrismaClient, userId: string): Promise<Set<string>> {
  const roles = await prisma.userRole.findMany({
    where: { userId },
    select: {
      role: {
        select: {
          permissions: {
            select: {
              permission: { select: { code: true } },
            },
          },
        },
      },
    },
  })

  const codes = new Set<string>()
  for (const r of roles) {
    for (const rp of r.role.permissions) codes.add(rp.permission.code)
  }
  return codes
}

export function requireAuth() {
  return async function (request: FastifyRequest): Promise<void> {
    if (!request.auth) {
      const err = new Error('Unauthorized') as Error & { statusCode?: number }
      err.statusCode = 401
      throw err
    }
  }
}

export function requirePermission(permission: PermissionCode) {
  return async function (request: FastifyRequest): Promise<void> {
    const perms = request.auth?.permissions
    if (!request.auth) {
      const err = new Error('Unauthorized') as Error & { statusCode?: number }
      err.statusCode = 401
      throw err
    }

    if (!perms || !perms.has(permission)) {
      const err = new Error('Forbidden') as Error & { statusCode?: number }
      err.statusCode = 403
      throw err
    }
  }
}

export function requireModuleEnabled(prisma: PrismaClient, module: ModuleCode) {
  return async function (request: FastifyRequest): Promise<void> {
    const tenantId = request.auth?.tenantId
    if (!tenantId) {
      const err = new Error('Unauthorized') as Error & { statusCode?: number }
      err.statusCode = 401
      throw err
    }

    const enabled = await prisma.tenantModule.findFirst({
      where: { tenantId, module, enabled: true },
      select: { id: true },
    })

    if (!enabled) {
      const err = new Error('Module disabled') as Error & { statusCode?: number }
      err.statusCode = 403
      throw err
    }
  }
}
