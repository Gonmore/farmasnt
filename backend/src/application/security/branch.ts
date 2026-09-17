import type { FastifyRequest } from 'fastify'
import { Permissions } from './permissions.js'

export function branchDepartmentsOf(request: FastifyRequest): string[] | null {
  const auth = request.auth
  if (!auth) return null
  if (auth.isTenantAdmin) return null
  if (!auth.permissions?.has(Permissions.ScopeBranch)) return null
  if (auth.warehouseType === 'PROVIDER') return null
  const departments = auth.warehouseDepartments
  if (!departments || departments.length === 0) return null
  return departments
}

export function branchDepartmentsOfMissing(request: FastifyRequest): boolean {
  const auth = request.auth
  if (!auth) return false
  if (auth.isTenantAdmin) return false
  if (!auth.permissions?.has(Permissions.ScopeBranch)) return false
  if (auth.warehouseType === 'PROVIDER') return false
  const departments = auth.warehouseDepartments
  return !departments || departments.length === 0
}

export function branchWarehouseIdOf(request: FastifyRequest): string | null {
  const auth = request.auth
  if (!auth) return null
  if (auth.isTenantAdmin) return null
  if (!auth.permissions?.has(Permissions.ScopeBranch)) return null
  const wid = String(auth.warehouseId ?? '').trim()
  return wid ? wid : '__MISSING__'
}

export function branchWarehouseIdOfMissing(request: FastifyRequest): boolean {
  const auth = request.auth
  if (!auth) return false
  if (auth.isTenantAdmin) return false
  if (!auth.permissions?.has(Permissions.ScopeBranch)) return false
  const wid = String(auth.warehouseId ?? '').trim()
  return !wid
}
