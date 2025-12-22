import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import {
  apiFetch,
  createPlatformTenantDomain,
  getApiBaseUrl,
  listPlatformTenantDomains,
  verifyPlatformTenantDomain,
  type PlatformTenantDomainListItem,
} from './lib/api'
import { connectSocket, disconnectSocket } from './lib/socket'
import { useAuth } from './providers/AuthProvider'
import { useTenant } from './providers/TenantProvider'
import { useTheme } from './providers/ThemeProvider'
import { useLocation, useNavigate, useParams } from 'react-router-dom'

type HealthResponse = {
  status: 'ok'
  service: string
  time: string
}

type ListResponse<T> = { items: T[]; nextCursor: string | null }

type CustomerListItem = {
  id: string
  name: string
  nit: string | null
  email: string | null
  phone: string | null
  isActive: boolean
  version: number
  updatedAt: string
}

type SalesOrderListItem = {
  id: string
  number: string
  customerId: string
  status: 'DRAFT' | 'CONFIRMED' | 'FULFILLED' | 'CANCELLED'
  note: string | null
  version: number
  updatedAt: string
}

type CatalogSearchItem = { id: string; sku: string; name: string }

type PermissionListItem = {
  id: string
  code: string
  module: string
  description: string | null
  isSystem: boolean
}

type AdminRoleListItem = {
  id: string
  code: string
  name: string
  isSystem: boolean
  version: number
  updatedAt: string
  permissionCodes: string[]
}

type AdminRoleRef = { id: string; code: string; name: string }

type AdminUserListItem = {
  id: string
  email: string
  fullName: string | null
  isActive: boolean
  createdAt: string
  roleIds: string[]
  roles: AdminRoleRef[]
}

type AuditActor = { id: string; email: string; fullName: string | null } | null
type AuditEventListItem = {
  id: string
  createdAt: string
  actorUserId: string | null
  action: string
  entityType: string
  entityId: string | null
  actor?: AuditActor
  before?: unknown
  after?: unknown
  metadata?: unknown
}

type SalesSummaryItem = {
  day: string
  ordersCount: number
  linesCount: number
  quantity: string
  amount: string
}

type TopProductItem = {
  productId: string
  sku: string
  name: string
  quantity: string
  amount: string
}

type WarehouseRef = { id: string; code: string; name: string }
type LocationRef = { id: string; code: string; warehouse: WarehouseRef }

type StockExpiryStatus = 'EXPIRED' | 'RED' | 'YELLOW' | 'GREEN'

type ExpirySummaryItem = {
  balanceId: string
  productId: string
  sku: string
  name: string
  batchId: string
  batchNumber: string
  expiresAt: string
  daysToExpire: number
  status: StockExpiryStatus
  quantity: string
  warehouseId: string
  warehouseCode: string
  warehouseName: string
  locationId: string
  locationCode: string
}

type WarehouseListItem = { id: string; code: string; name: string; isActive: boolean }

type BalanceExpandedItem = {
  id: string
  quantity: string
  updatedAt: string
  productId: string
  batchId: string | null
  locationId: string
  product: { sku: string; name: string }
  batch: { batchNumber: string; expiresAt: string | null; status: string } | null
  location: LocationRef
}

type MovementExpandedItem = {
  id: string
  createdAt: string
  type: 'IN' | 'OUT' | 'TRANSFER' | 'ADJUSTMENT'
  productId: string
  batchId: string | null
  fromLocationId: string | null
  toLocationId: string | null
  quantity: string
  referenceType: string | null
  referenceId: string | null
  note: string | null
  product: { sku: string; name: string }
  batch: { batchNumber: string; expiresAt: string | null; status: string } | null
  fromLocation: LocationRef | null
  toLocation: LocationRef | null
}

type PlatformTenantListItem = {
  id: string
  name: string
  isActive: boolean
  branchLimit: number
  createdAt: string
  updatedAt: string
  domains: Array<{ domain: string; isPrimary: boolean; verifiedAt: string | null }>
}

const API_BASE_URL = getApiBaseUrl()

async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/health`)
  if (!response.ok) throw new Error('Health check failed')
  return response.json() as Promise<HealthResponse>
}

function App() {
  const auth = useAuth()
  const tenant = useTenant()
  const theme = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const params = useParams()

  const isAdminRoute = location.pathname === '/admin' || location.pathname.startsWith('/admin/')
  const routeAdminTab = (params as any).tab as string | undefined
  const [email, setEmail] = useState('admin@demo.local')
  const [password, setPassword] = useState('Admin123!')
  const [authError, setAuthError] = useState<string | null>(null)

  const token = auth.accessToken

  const [socketStatus, setSocketStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const [events, setEvents] = useState<Array<{ at: string; type: string; payload: unknown }>>([])
  const [demoStatus, setDemoStatus] = useState<string | null>(null)
  const [demoError, setDemoError] = useState<string | null>(null)

  const [customerQuery, setCustomerQuery] = useState<string>('')
  const [orderStatus, setOrderStatus] = useState<'ALL' | SalesOrderListItem['status']>('ALL')
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)

  const [productQuery, setProductQuery] = useState('')

  const [adminTab, setAdminTab] = useState<'roles' | 'users' | 'permissions' | 'audit' | 'reports' | 'branding' | 'tenants'>('roles')

  const [adminNotice, setAdminNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const showAdminNotice = (kind: 'success' | 'error', message: string) => {
    setAdminNotice({ kind, message })
    window.setTimeout(() => setAdminNotice(null), 4000)
  }

  const [roleSaveAt, setRoleSaveAt] = useState<string | null>(null)
  const [userSaveAt, setUserSaveAt] = useState<string | null>(null)

  // Reports
  const [salesFrom, setSalesFrom] = useState('')
  const [salesTo, setSalesTo] = useState('')
  const [salesStatus, setSalesStatus] = useState<'ALL' | 'DRAFT' | 'CONFIRMED' | 'FULFILLED' | 'CANCELLED'>('ALL')
  const [topTake, setTopTake] = useState(10)

  const [stockWarehouseId, setStockWarehouseId] = useState('')
  const [stockLocationId, setStockLocationId] = useState('')
  const [stockProductId, setStockProductId] = useState('')
  const [stockTake, setStockTake] = useState(100)

  const [movesFrom, setMovesFrom] = useState('')
  const [movesTo, setMovesTo] = useState('')
  const [movesProductId, setMovesProductId] = useState('')
  const [movesLocationId, setMovesLocationId] = useState('')
  const [movesTake, setMovesTake] = useState(100)

  // Expiry dashboard
  const [expiryWarehouseId, setExpiryWarehouseId] = useState('')
  const [expiryStatus, setExpiryStatus] = useState<'ALL' | StockExpiryStatus>('ALL')
  const [expiryTake, setExpiryTake] = useState(100)

  const [reportsFilterError, setReportsFilterError] = useState<string | null>(null)

  // Tenant branding (Admin)
  const [brandingPrimary, setBrandingPrimary] = useState<string>('#0f172a')
  const [brandingSecondary, setBrandingSecondary] = useState<string>('#334155')
  const [brandingTertiary, setBrandingTertiary] = useState<string>('#64748b')
  const [brandingTheme, setBrandingTheme] = useState<'LIGHT' | 'DARK'>('LIGHT')
  const [brandingLogoUrl, setBrandingLogoUrl] = useState<string>('')
  const [brandingFile, setBrandingFile] = useState<File | null>(null)
  const [brandingBusy, setBrandingBusy] = useState(false)
  const [brandingError, setBrandingError] = useState<string | null>(null)

  // Platform tenants provisioning
  const [platformTenantName, setPlatformTenantName] = useState('')
  const [platformTenantBranchCount, setPlatformTenantBranchCount] = useState(4)
  const [platformTenantAdminEmail, setPlatformTenantAdminEmail] = useState('')
  const [platformTenantAdminPassword, setPlatformTenantAdminPassword] = useState('')
  const [platformTenantPrimaryDomain, setPlatformTenantPrimaryDomain] = useState('')

  const [platformSelectedTenantId, setPlatformSelectedTenantId] = useState<string | null>(null)
  const [platformDomainInput, setPlatformDomainInput] = useState('')
  const [platformDomainIsPrimary, setPlatformDomainIsPrimary] = useState(true)
  const [platformLastVerification, setPlatformLastVerification] = useState<
    | {
        tenantId: string
        domain: string
        token: string
        url: string
        expiresAt: string
      }
    | null
  >(null)

  const tenantBrandingAdminQuery = useQuery({
    queryKey: ['adminTenantBranding'],
    enabled: Boolean(token) && adminTab === 'branding',
    queryFn: async () => apiFetch<any>('/api/v1/admin/tenant/branding', { token }),
  })

  const platformTenantsQuery = useInfiniteQuery({
    queryKey: ['platformTenants'],
    enabled: Boolean(token) && adminTab === 'tenants',
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''
      return apiFetch<ListResponse<PlatformTenantListItem>>(`/api/v1/platform/tenants?take=20${cursor}`, { token })
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    retry: (failureCount, err: any) => {
      if (err?.status === 403) return false
      return failureCount < 1
    },
  })

  const createPlatformTenantMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error('No autenticado')
      return apiFetch<{ id: string; name: string }>(`/api/v1/platform/tenants`, {
        method: 'POST',
        token,
        body: JSON.stringify({
          name: platformTenantName.trim(),
          branchCount: platformTenantBranchCount,
          adminEmail: platformTenantAdminEmail.trim(),
          adminPassword: platformTenantAdminPassword,
          primaryDomain: platformTenantPrimaryDomain.trim() || undefined,
        }),
      })
    },
    onSuccess: async () => {
      setPlatformTenantName('')
      setPlatformTenantAdminEmail('')
      setPlatformTenantAdminPassword('')
      setPlatformTenantPrimaryDomain('')
      await platformTenantsQuery.refetch()
      showAdminNotice('success', 'Tenant creado')
    },
    onError: (e: any) => showAdminNotice('error', e?.message ?? 'Error creando tenant'),
  })

  const platformTenantDomainsQuery = useQuery({
    queryKey: ['platformTenantDomains', platformSelectedTenantId],
    enabled: Boolean(token) && adminTab === 'tenants' && Boolean(platformSelectedTenantId),
    queryFn: async () => {
      if (!token || !platformSelectedTenantId) throw new Error('No autenticado')
      return listPlatformTenantDomains(platformSelectedTenantId, { token })
    },
    retry: (failureCount, err: any) => {
      if (err?.status === 403) return false
      return failureCount < 1
    },
  })

  const createPlatformTenantDomainMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error('No autenticado')
      if (!platformSelectedTenantId) throw new Error('Selecciona un tenant')
      const domain = platformDomainInput.trim()
      if (!domain) throw new Error('Dominio requerido')
      return createPlatformTenantDomain(
        platformSelectedTenantId,
        { domain, isPrimary: platformDomainIsPrimary },
        { token },
      )
    },
    onSuccess: async (res) => {
      setPlatformLastVerification({
        tenantId: res.tenantId,
        domain: res.domain,
        token: res.verification.token,
        url: res.verification.url,
        expiresAt: res.verification.expiresAt,
      })
      setPlatformDomainInput('')
      showAdminNotice('success', `Dominio registrado: ${res.domain}. Pendiente de verificación.`)
      await platformTenantDomainsQuery.refetch()
      await platformTenantsQuery.refetch()
    },
    onError: (err: any) => showAdminNotice('error', err?.message ?? 'Error registrando dominio'),
  })

  const verifyPlatformTenantDomainMutation = useMutation({
    mutationFn: async (domain: string) => {
      if (!token) throw new Error('No autenticado')
      if (!platformSelectedTenantId) throw new Error('Selecciona un tenant')
      return verifyPlatformTenantDomain(platformSelectedTenantId, domain, { token })
    },
    onSuccess: async (_res, domain) => {
      showAdminNotice('success', `Dominio verificado: ${domain}`)
      await platformTenantDomainsQuery.refetch()
      await platformTenantsQuery.refetch()
    },
    onError: (err: any) => showAdminNotice('error', err?.message ?? 'Error verificando dominio'),
  })

  useEffect(() => {
    if (!isAdminRoute) return
    const t = (routeAdminTab ?? '').toLowerCase()
    const allowed = new Set(['roles', 'users', 'permissions', 'audit', 'reports', 'branding', 'tenants'])
    if (allowed.has(t) && t !== adminTab) setAdminTab(t as any)
    if (!t) {
      navigate(`/admin/${adminTab}`, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminRoute, routeAdminTab])

  useEffect(() => {
    if (!isAdminRoute) return
    const current = (routeAdminTab ?? '').toLowerCase()
    if (current !== adminTab) navigate(`/admin/${adminTab}`, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminTab, isAdminRoute])

  useEffect(() => {
    if (adminTab !== 'branding') return
    const data = tenantBrandingAdminQuery.data
    if (!data) return
    setBrandingError(null)
    setBrandingLogoUrl(data.logoUrl ?? '')
    setBrandingPrimary((data.brandPrimary as string | null) ?? brandingPrimary)
    setBrandingSecondary((data.brandSecondary as string | null) ?? brandingSecondary)
    setBrandingTertiary((data.brandTertiary as string | null) ?? brandingTertiary)
    setBrandingTheme((data.defaultTheme as 'LIGHT' | 'DARK') ?? 'LIGHT')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminTab, tenantBrandingAdminQuery.data])

  async function uploadTenantLogo(): Promise<string> {
    if (!brandingFile) throw new Error('Selecciona un archivo primero')
    if (!token) throw new Error('No autenticado')

    const presign = await apiFetch<{ uploadUrl: string; publicUrl: string; method: 'PUT'; expiresInSeconds: number }>(
      '/api/v1/admin/tenant/branding/logo-upload',
      {
        method: 'POST',
        token,
        body: JSON.stringify({ fileName: brandingFile.name, contentType: brandingFile.type || 'image/png' }),
      },
    )

    const putResp = await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': brandingFile.type || 'application/octet-stream' },
      body: brandingFile,
    })
    if (!putResp.ok) {
      throw new Error(`Error subiendo logo (HTTP ${putResp.status})`)
    }
    return presign.publicUrl
  }

  async function saveTenantBranding() {
    if (!token) return
    setBrandingError(null)
    setBrandingBusy(true)
    try {
      let logoUrl = brandingLogoUrl.trim() || null
      if (brandingFile) {
        logoUrl = await uploadTenantLogo()
        setBrandingLogoUrl(logoUrl)
        setBrandingFile(null)
      }

      await apiFetch('/api/v1/admin/tenant/branding', {
        method: 'PUT',
        token,
        body: JSON.stringify({
          logoUrl,
          brandPrimary: brandingPrimary,
          brandSecondary: brandingSecondary,
          brandTertiary: brandingTertiary,
          defaultTheme: brandingTheme,
        }),
      })

      showAdminNotice('success', 'Branding guardado')
      await tenantBrandingAdminQuery.refetch()
    } catch (e: any) {
      setBrandingError(e?.message ?? 'Error guardando branding')
      showAdminNotice('error', e?.message ?? 'Error guardando branding')
    } finally {
      setBrandingBusy(false)
    }
  }

  function validateReportsDateRange(fromValue: string, toValue: string): boolean {
    setReportsFilterError(null)
    if (!fromValue.trim() || !toValue.trim()) return true
    const fromDate = new Date(fromValue)
    const toDate = new Date(toValue)
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      setReportsFilterError('Rango de fechas inválido')
      return false
    }
    if (fromDate.getTime() > toDate.getTime()) {
      setReportsFilterError('El campo “from” no puede ser mayor que “to”')
      return false
    }
    return true
  }

  // Admin: permissions
  const permissionsQuery = useQuery({
    queryKey: ['adminPermissions'],
    enabled: Boolean(token),
    queryFn: async () => apiFetch<{ items: PermissionListItem[] }>(`/api/v1/admin/permissions`, { token }),
  })

  // Admin: roles
  const [roleQ, setRoleQ] = useState('')
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
  const [roleCreateCode, setRoleCreateCode] = useState('')
  const [roleCreateName, setRoleCreateName] = useState('')
  const [roleCreatePermCodes, setRoleCreatePermCodes] = useState<Record<string, boolean>>({})
  const [roleEditPermCodes, setRoleEditPermCodes] = useState<Record<string, boolean>>({})

  const rolesQuery = useInfiniteQuery({
    queryKey: ['adminRoles', { q: roleQ }],
    enabled: Boolean(token),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const q = roleQ.trim() ? `&q=${encodeURIComponent(roleQ.trim())}` : ''
      const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''
      return apiFetch<ListResponse<AdminRoleListItem>>(`/api/v1/admin/roles?take=20${q}${cursor}`, { token })
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })

  const allRoles = useMemo(() => rolesQuery.data?.pages.flatMap((p) => p.items) ?? [], [rolesQuery.data])
  const selectedRole = useMemo(
    () => (selectedRoleId ? allRoles.find((r) => r.id === selectedRoleId) ?? null : null),
    [allRoles, selectedRoleId],
  )

  const selectedRolePermSet = useMemo(() => {
    if (!selectedRole) return new Set<string>()
    return new Set(selectedRole.permissionCodes)
  }, [selectedRole])

  const editedRolePermSet = useMemo(() => {
    return new Set(Object.entries(roleEditPermCodes).filter(([, v]) => v).map(([k]) => k))
  }, [roleEditPermCodes])

  const isRolePermDirty = useMemo(() => {
    if (!selectedRole) return false
    if (selectedRolePermSet.size !== editedRolePermSet.size) return true
    for (const c of selectedRolePermSet) if (!editedRolePermSet.has(c)) return true
    return false
  }, [selectedRole, selectedRolePermSet, editedRolePermSet])

  useEffect(() => {
    if (!selectedRole) return
    const next: Record<string, boolean> = {}
    for (const code of selectedRole.permissionCodes) next[code] = true
    setRoleEditPermCodes(next)
    setRoleSaveAt(null)
  }, [selectedRole])

  const createRoleMutation = useMutation({
    mutationFn: async () => {
      const permissionCodes = Object.entries(roleCreatePermCodes)
        .filter(([, v]) => v)
        .map(([k]) => k)
      return apiFetch<{ id: string; code: string; name: string }>(`/api/v1/admin/roles`, {
        method: 'POST',
        token,
        body: JSON.stringify({
          code: roleCreateCode.trim(),
          name: roleCreateName.trim(),
          ...(permissionCodes.length > 0 ? { permissionCodes } : {}),
        }),
      })
    },
    onSuccess: async () => {
      setRoleCreateCode('')
      setRoleCreateName('')
      setRoleCreatePermCodes({})
      setSelectedRoleId(null)
      await rolesQuery.refetch()
      showAdminNotice('success', 'Rol creado correctamente')
    },
    onError: (e: any) => showAdminNotice('error', e?.message ?? 'Error creando rol'),
  })

  const replaceRolePermsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRoleId) throw new Error('Selecciona un rol')
      const permissionCodes = Object.entries(roleEditPermCodes)
        .filter(([, v]) => v)
        .map(([k]) => k)
      return apiFetch(`/api/v1/admin/roles/${selectedRoleId}/permissions`, {
        method: 'PUT',
        token,
        body: JSON.stringify({ permissionCodes }),
      })
    },
    onSuccess: async () => {
      await rolesQuery.refetch()
      setRoleSaveAt(new Date().toLocaleString())
      showAdminNotice('success', 'Permisos del rol actualizados')
    },
    onError: (e: any) => showAdminNotice('error', e?.message ?? 'Error actualizando permisos'),
  })

  // Admin: users
  const [userQ, setUserQ] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [userCreateEmail, setUserCreateEmail] = useState('')
  const [userCreatePassword, setUserCreatePassword] = useState('')
  const [userCreateFullName, setUserCreateFullName] = useState('')
  const [userCreateRoleIds, setUserCreateRoleIds] = useState<Record<string, boolean>>({})
  const [userEditRoleIds, setUserEditRoleIds] = useState<Record<string, boolean>>({})

  const usersQuery = useInfiniteQuery({
    queryKey: ['adminUsers', { q: userQ }],
    enabled: Boolean(token),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const q = userQ.trim() ? `&q=${encodeURIComponent(userQ.trim())}` : ''
      const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''
      return apiFetch<ListResponse<AdminUserListItem>>(`/api/v1/admin/users?take=20${q}${cursor}`, { token })
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })

  const allUsers = useMemo(() => usersQuery.data?.pages.flatMap((p) => p.items) ?? [], [usersQuery.data])
  const selectedUser = useMemo(
    () => (selectedUserId ? allUsers.find((u) => u.id === selectedUserId) ?? null : null),
    [allUsers, selectedUserId],
  )

  const selectedUserRoleSet = useMemo(() => {
    if (!selectedUser) return new Set<string>()
    return new Set(selectedUser.roleIds)
  }, [selectedUser])

  const editedUserRoleSet = useMemo(() => {
    return new Set(Object.entries(userEditRoleIds).filter(([, v]) => v).map(([k]) => k))
  }, [userEditRoleIds])

  const isUserRolesDirty = useMemo(() => {
    if (!selectedUser) return false
    if (selectedUserRoleSet.size !== editedUserRoleSet.size) return true
    for (const r of selectedUserRoleSet) if (!editedUserRoleSet.has(r)) return true
    return false
  }, [selectedUser, selectedUserRoleSet, editedUserRoleSet])

  useEffect(() => {
    if (!selectedUser) return
    const next: Record<string, boolean> = {}
    for (const rid of selectedUser.roleIds) next[rid] = true
    setUserEditRoleIds(next)
    setUserSaveAt(null)
  }, [selectedUser])

  const createUserMutation = useMutation({
    mutationFn: async () => {
      const roleIds = Object.entries(userCreateRoleIds)
        .filter(([, v]) => v)
        .map(([k]) => k)
      return apiFetch(`/api/v1/admin/users`, {
        method: 'POST',
        token,
        body: JSON.stringify({
          email: userCreateEmail.trim(),
          password: userCreatePassword,
          ...(userCreateFullName.trim() ? { fullName: userCreateFullName.trim() } : {}),
          ...(roleIds.length > 0 ? { roleIds } : {}),
        }),
      })
    },
    onSuccess: async () => {
      setUserCreateEmail('')
      setUserCreatePassword('')
      setUserCreateFullName('')
      setUserCreateRoleIds({})
      setSelectedUserId(null)
      await usersQuery.refetch()
      showAdminNotice('success', 'Usuario creado correctamente')
    },
    onError: (e: any) => showAdminNotice('error', e?.message ?? 'Error creando usuario'),
  })

  const replaceUserRolesMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUserId) throw new Error('Selecciona un usuario')
      const roleIds = Object.entries(userEditRoleIds)
        .filter(([, v]) => v)
        .map(([k]) => k)
      return apiFetch(`/api/v1/admin/users/${selectedUserId}/roles`, {
        method: 'PUT',
        token,
        body: JSON.stringify({ roleIds }),
      })
    },
    onSuccess: async () => {
      await usersQuery.refetch()
      setUserSaveAt(new Date().toLocaleString())
      showAdminNotice('success', 'Roles del usuario actualizados')
    },
    onError: (e: any) => showAdminNotice('error', e?.message ?? 'Error actualizando roles'),
  })

  // Auto-refresh data when switching admin tabs
  useEffect(() => {
    if (!token) return
    if (adminTab === 'permissions') void permissionsQuery.refetch()
    if (adminTab === 'roles') {
      void permissionsQuery.refetch()
      void rolesQuery.refetch()
    }
    if (adminTab === 'users') {
      void rolesQuery.refetch()
      void usersQuery.refetch()
    }
    if (adminTab === 'audit') void auditQuery.refetch()
    if (adminTab === 'reports') {
      void salesSummaryQuery.refetch()
      void topProductsQuery.refetch()
      void stockBalancesExpandedQuery.refetch()
      void stockMovementsExpandedQuery.refetch()
      void expirySummaryQuery.refetch()
      void warehousesQuery.refetch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminTab, token])

  // Audit
  const [auditAction, setAuditAction] = useState('')
  const [auditEntityType, setAuditEntityType] = useState('')
  const [auditEntityId, setAuditEntityId] = useState('')
  const [auditActorUserId, setAuditActorUserId] = useState('')
  const [auditFrom, setAuditFrom] = useState('')
  const [auditTo, setAuditTo] = useState('')
  const [auditIncludePayload, setAuditIncludePayload] = useState(false)
  const [selectedAuditEventId, setSelectedAuditEventId] = useState<string | null>(null)
  const [auditFilterError, setAuditFilterError] = useState<string | null>(null)

  const auditQuery = useInfiniteQuery({
    queryKey: [
      'auditEvents',
      {
        action: auditAction,
        entityType: auditEntityType,
        entityId: auditEntityId,
        actorUserId: auditActorUserId,
        from: auditFrom,
        to: auditTo,
        includePayload: auditIncludePayload,
      },
    ],
    enabled: Boolean(token),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams()
      qs.set('take', '20')
      if (pageParam) qs.set('cursor', pageParam)
      if (auditAction.trim()) qs.set('action', auditAction.trim())
      if (auditEntityType.trim()) qs.set('entityType', auditEntityType.trim())
      if (auditEntityId.trim()) qs.set('entityId', auditEntityId.trim())
      if (auditActorUserId.trim()) qs.set('actorUserId', auditActorUserId.trim())
      if (auditFrom.trim()) qs.set('from', new Date(auditFrom).toISOString())
      if (auditTo.trim()) qs.set('to', new Date(auditTo).toISOString())
      if (auditIncludePayload) qs.set('includePayload', 'true')
      return apiFetch<ListResponse<AuditEventListItem>>(`/api/v1/audit/events?${qs.toString()}`, { token })
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })

  const auditItems = useMemo(() => auditQuery.data?.pages.flatMap((p) => p.items) ?? [], [auditQuery.data])

  const selectedAuditEvent = useMemo(
    () => (selectedAuditEventId ? auditItems.find((x) => x.id === selectedAuditEventId) ?? null : null),
    [auditItems, selectedAuditEventId],
  )

  const auditDetailQuery = useQuery({
    queryKey: ['auditEvent', { id: selectedAuditEventId }],
    enabled: Boolean(token) && Boolean(selectedAuditEventId),
    queryFn: async () => apiFetch(`/api/v1/audit/events/${selectedAuditEventId}`, { token }),
  })

  const salesSummaryQuery = useQuery({
    queryKey: ['reports', 'salesSummary', { from: salesFrom, to: salesTo, status: salesStatus }],
    enabled: Boolean(token) && adminTab === 'reports',
    queryFn: async () => {
      const qs = new URLSearchParams()
      if (salesFrom.trim()) qs.set('from', new Date(salesFrom).toISOString())
      if (salesTo.trim()) qs.set('to', new Date(salesTo).toISOString())
      if (salesStatus !== 'ALL') qs.set('status', salesStatus)
      return apiFetch<{ items: SalesSummaryItem[] }>(`/api/v1/reports/sales/summary?${qs.toString()}`, { token })
    },
  })

  const topProductsQuery = useQuery({
    queryKey: ['reports', 'topProducts', { from: salesFrom, to: salesTo, status: salesStatus, take: topTake }],
    enabled: Boolean(token) && adminTab === 'reports',
    queryFn: async () => {
      const qs = new URLSearchParams()
      qs.set('take', String(topTake))
      if (salesFrom.trim()) qs.set('from', new Date(salesFrom).toISOString())
      if (salesTo.trim()) qs.set('to', new Date(salesTo).toISOString())
      if (salesStatus !== 'ALL') qs.set('status', salesStatus)
      return apiFetch<{ items: TopProductItem[] }>(`/api/v1/reports/sales/top-products?${qs.toString()}`, { token })
    },
  })

  const stockBalancesExpandedQuery = useQuery({
    queryKey: [
      'reports',
      'stockBalancesExpanded',
      {
        warehouseId: stockWarehouseId,
        locationId: stockLocationId,
        productId: stockProductId,
        take: stockTake,
      },
    ],
    enabled: Boolean(token) && adminTab === 'reports',
    queryFn: async () => {
      const qs = new URLSearchParams()
      qs.set('take', String(stockTake))
      if (stockWarehouseId.trim()) qs.set('warehouseId', stockWarehouseId.trim())
      if (stockLocationId.trim()) qs.set('locationId', stockLocationId.trim())
      if (stockProductId.trim()) qs.set('productId', stockProductId.trim())
      return apiFetch<{ items: BalanceExpandedItem[] }>(`/api/v1/reports/stock/balances-expanded?${qs.toString()}`, { token })
    },
  })

  const stockMovementsExpandedQuery = useQuery({
    queryKey: [
      'reports',
      'stockMovementsExpanded',
      { from: movesFrom, to: movesTo, productId: movesProductId, locationId: movesLocationId, take: movesTake },
    ],
    enabled: Boolean(token) && adminTab === 'reports',
    queryFn: async () => {
      const qs = new URLSearchParams()
      qs.set('take', String(movesTake))
      if (movesFrom.trim()) qs.set('from', new Date(movesFrom).toISOString())
      if (movesTo.trim()) qs.set('to', new Date(movesTo).toISOString())
      if (movesProductId.trim()) qs.set('productId', movesProductId.trim())
      if (movesLocationId.trim()) qs.set('locationId', movesLocationId.trim())
      return apiFetch<{ items: MovementExpandedItem[] }>(`/api/v1/reports/stock/movements-expanded?${qs.toString()}`, { token })
    },
  })

  const warehousesQuery = useQuery({
    queryKey: ['warehouses', { take: 100 }],
    enabled: Boolean(token) && adminTab === 'reports',
    queryFn: async () => apiFetch<ListResponse<WarehouseListItem>>('/api/v1/warehouses?take=100', { token }),
  })

  const expirySummaryQuery = useQuery({
    queryKey: ['reports', 'stockExpiry', { warehouseId: expiryWarehouseId, status: expiryStatus, take: expiryTake }],
    enabled: Boolean(token) && adminTab === 'reports',
    queryFn: async () => {
      const qs = new URLSearchParams()
      qs.set('take', String(expiryTake))
      if (expiryWarehouseId.trim()) qs.set('warehouseId', expiryWarehouseId.trim())
      if (expiryStatus !== 'ALL') qs.set('status', expiryStatus)
      return apiFetch<{ items: ExpirySummaryItem[]; nextCursor: string | null; generatedAt: string }>(
        `/api/v1/stock/expiry/summary?${qs.toString()}`,
        { token },
      )
    },
  })

  function expiryBadge(status: StockExpiryStatus) {
    const base = 'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium'
    if (status === 'EXPIRED') return <span className={`${base} border-red-200 bg-red-50 text-red-800`}>EXPIRED</span>
    if (status === 'RED') return <span className={`${base} border-red-200 bg-red-50 text-red-800`}>RED</span>
    if (status === 'YELLOW') return <span className={`${base} border-amber-200 bg-amber-50 text-amber-800`}>YELLOW</span>
    return <span className={`${base} border-emerald-200 bg-emerald-50 text-emerald-800`}>GREEN</span>
  }

  function startOfTodayUtc(): Date {
    const now = new Date()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0))
  }

  function daysToExpire(expiresAt: Date, todayUtc: Date): number {
    const ms = expiresAt.getTime() - todayUtc.getTime()
    return Math.floor(ms / 86400000)
  }

  function statusForDays(d: number): StockExpiryStatus {
    if (d < 0) return 'EXPIRED'
    if (d <= 30) return 'RED'
    if (d <= 90) return 'YELLOW'
    return 'GREEN'
  }

  function validateAuditFilters(): boolean {
    setAuditFilterError(null)
    if (auditFrom.trim() && auditTo.trim()) {
      const fromDate = new Date(auditFrom)
      const toDate = new Date(auditTo)
      if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
        setAuditFilterError('Rango de fechas inválido')
        return false
      }
      if (fromDate.getTime() > toDate.getTime()) {
        setAuditFilterError('El campo “from” no puede ser mayor que “to”')
        return false
      }
    }
    return true
  }

  async function copyToClipboard(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
      showAdminNotice('success', `${label} copiado`)
    } catch {
      showAdminNotice('error', `No se pudo copiar ${label}`)
    }
  }

  function renderJson(value: unknown) {
    if (value === null || value === undefined) {
      return <div className="text-sm text-slate-600">-</div>
    }
    return (
      <pre className="max-h-80 overflow-auto rounded bg-slate-50 p-3 text-xs text-slate-800">
        {JSON.stringify(value, null, 2)}
      </pre>
    )
  }

  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
  })

  const canConnectSocket = useMemo(() => Boolean(token), [token])

  const customersQuery = useQuery({
    queryKey: ['customers', { q: customerQuery }],
    enabled: Boolean(token),
    queryFn: async () => {
      const qs = customerQuery.trim() ? `?q=${encodeURIComponent(customerQuery.trim())}` : ''
      return apiFetch<ListResponse<CustomerListItem>>(`/api/v1/customers${qs}`, { token })
    },
  })

  const ordersQuery = useQuery({
    queryKey: ['salesOrders', { status: orderStatus }],
    enabled: Boolean(token),
    queryFn: async () => {
      const qs = orderStatus === 'ALL' ? '' : `?status=${encodeURIComponent(orderStatus)}`
      return apiFetch<ListResponse<SalesOrderListItem>>(`/api/v1/sales/orders${qs}`, { token })
    },
  })

  const productSearchQuery = useQuery({
    queryKey: ['catalogSearch', { q: productQuery }],
    enabled: Boolean(token) && productQuery.trim().length > 0,
    queryFn: async () => {
      const q = productQuery.trim()
      return apiFetch<{ items: CatalogSearchItem[] }>(
        `/api/v1/catalog/search?q=${encodeURIComponent(q)}&take=20`,
        { token },
      )
    },
  })

  const orderDetailQuery = useQuery({
    queryKey: ['salesOrder', { id: selectedOrderId }],
    enabled: Boolean(token) && Boolean(selectedOrderId),
    queryFn: async () => {
      return apiFetch(`/api/v1/sales/orders/${selectedOrderId}`, { token })
    },
  })

  useEffect(() => {
    if (!canConnectSocket || !token) {
      setSocketStatus('disconnected')
      return
    }

    setSocketStatus('connecting')
    const s = connectSocket()
    if (!s) {
      setSocketStatus('disconnected')
      return
    }

    const pushEvent = (type: string, payload: unknown) => {
      setEvents((prev) => [{ at: new Date().toISOString(), type, payload }, ...prev].slice(0, 50))
    }

    s.on('connect', () => setSocketStatus('connected'))
    s.on('disconnect', () => setSocketStatus('disconnected'))
    s.on('connect_error', (err) => {
      pushEvent('socket.connect_error', { message: err.message })
      setSocketStatus('disconnected')
    })

    // Backend emits
    s.on('connected', (p) => pushEvent('connected', p))
    s.on('stock.movement.created', (p) => pushEvent('stock.movement.created', p))
    s.on('stock.balance.changed', (p) => pushEvent('stock.balance.changed', p))
    s.on('stock.alert.low', (p) => pushEvent('stock.alert.low', p))
    s.on('sales.order.confirmed', (p) => pushEvent('sales.order.confirmed', p))
    s.on('sales.order.fulfilled', (p) => pushEvent('sales.order.fulfilled', p))

    return () => {
      disconnectSocket()
    }
  }, [canConnectSocket, token])

  async function handleLogin() {
    setAuthError(null)
    try {
      await auth.login(email, password)
    } catch (e: any) {
      setAuthError(e?.message ?? 'Login failed')
    }
  }

  async function runDemoFlow() {
    if (!token) return
    setDemoError(null)
    setDemoStatus('Creando producto, lotes (con vencimientos), stock y pedidos…')

    try {
      const wh = await apiFetch<ListResponse<{ id: string; code: string }>>('/api/v1/warehouses', { token })
      const whId = wh.items[0]?.id
      if (!whId) throw new Error('No hay warehouses disponibles')

      const loc = await apiFetch<ListResponse<{ id: string; code: string }>>(`/api/v1/warehouses/${whId}/locations`, { token })
      const locId = loc.items[0]?.id
      if (!locId) throw new Error('No hay locations disponibles')

      const sku = `SKU-${Math.floor(Math.random() * 1000000)}`
      const product = await apiFetch<{ id: string; sku: string }>(`/api/v1/products`, {
        method: 'POST',
        token,
        body: JSON.stringify({ sku, name: `Producto ${sku}` }),
      })

      const todayUtc = startOfTodayUtc()
      const expiredAtIso = new Date(todayUtc.getTime() - 10 * 86400000).toISOString()
      const yellowAtIso = new Date(todayUtc.getTime() + 60 * 86400000).toISOString()

      const expiredBatch = await apiFetch<{ id: string; batchNumber: string; expiresAt: string | null }>(
        `/api/v1/products/${encodeURIComponent(product.id)}/batches`,
        {
          method: 'POST',
          token,
          body: JSON.stringify({ batchNumber: 'LOT-EXPIRED', expiresAt: expiredAtIso }),
        },
      )

      const yellowBatch = await apiFetch<{ id: string; batchNumber: string; expiresAt: string | null }>(
        `/api/v1/products/${encodeURIComponent(product.id)}/batches`,
        {
          method: 'POST',
          token,
          body: JSON.stringify({ batchNumber: 'LOT-YELLOW', expiresAt: yellowAtIso }),
        },
      )

      await apiFetch(`/api/v1/stock/movements`, {
        method: 'POST',
        token,
        body: JSON.stringify({
          type: 'IN',
          productId: product.id,
          batchId: expiredBatch.id,
          toLocationId: locId,
          quantity: 2,
          referenceType: 'TEST',
          referenceId: 'UI-DEMO',
        }),
      })

      await apiFetch(`/api/v1/stock/movements`, {
        method: 'POST',
        token,
        body: JSON.stringify({
          type: 'IN',
          productId: product.id,
          batchId: yellowBatch.id,
          toLocationId: locId,
          quantity: 2,
          referenceType: 'TEST',
          referenceId: 'UI-DEMO',
        }),
      })

      const customer = await apiFetch<{ id: string; name: string }>(`/api/v1/customers`, {
        method: 'POST',
        token,
        body: JSON.stringify({ name: `Cliente ${Math.floor(Math.random() * 10000)}`, nit: '1234567', email: 'cliente@example.com' }),
      })

      const order = await apiFetch<{ id: string; number: string; version: number }>(`/api/v1/sales/orders`, {
        method: 'POST',
        token,
        body: JSON.stringify({
          customerId: customer.id,
          note: 'UI demo order',
          // Force an expired batch to prove the 409 rule
          lines: [{ productId: product.id, batchId: expiredBatch.id, quantity: 1, unitPrice: 12.5 }],
        }),
      })

      const confirmed = await apiFetch<{ id: string; version: number }>(`/api/v1/sales/orders/${order.id}/confirm`, {
        method: 'POST',
        token,
        body: JSON.stringify({ version: order.version }),
      })

      try {
        await apiFetch(`/api/v1/sales/orders/${order.id}/fulfill`, {
          method: 'POST',
          token,
          body: JSON.stringify({ version: confirmed.version, fromLocationId: locId, note: 'UI demo fulfill' }),
        })
        throw new Error('Se esperaba bloqueo por vencimiento pero el fulfill pasó')
      } catch (e: any) {
        if (!String(e?.message ?? '').toLowerCase().includes('expired')) throw e
      }

      const okOrder = await apiFetch<{ id: string; number: string; version: number }>(`/api/v1/sales/orders`, {
        method: 'POST',
        token,
        body: JSON.stringify({
          customerId: customer.id,
          note: 'UI demo order (valid batch)',
          lines: [{ productId: product.id, batchId: yellowBatch.id, quantity: 1, unitPrice: 12.5 }],
        }),
      })

      const okConfirmed = await apiFetch<{ id: string; version: number }>(`/api/v1/sales/orders/${okOrder.id}/confirm`, {
        method: 'POST',
        token,
        body: JSON.stringify({ version: okOrder.version }),
      })

      await apiFetch(`/api/v1/sales/orders/${okOrder.id}/fulfill`, {
        method: 'POST',
        token,
        body: JSON.stringify({ version: okConfirmed.version, fromLocationId: locId, note: 'UI demo fulfill (valid batch)' }),
      })

      setDemoStatus('Listo: bloqueo por vencimiento OK + fulfill válido OK. Revisa el log realtime y la sección Vencimientos.')
    } catch (e: any) {
      setDemoError(e?.message ?? 'Error ejecutando demo')
      setDemoStatus(null)
    }
  }

  function handleLogout() {
    auth.logout()
    setEvents([])
    setSelectedOrderId(null)
    setSelectedRoleId(null)
    setSelectedUserId(null)
    setSelectedAuditEventId(null)
    setAdminNotice(null)
    setRoleSaveAt(null)
    setUserSaveAt(null)
    setReportsFilterError(null)
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 dark:border-slate-700">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            {tenant.branding?.logoUrl ? (
              <img
                src={tenant.branding.logoUrl}
                alt="Tenant logo"
                className="h-8 w-8 rounded border border-slate-200 object-contain dark:border-slate-700"
              />
            ) : null}
            <div className="text-lg font-semibold">PharmaFlow Bolivia</div>
          </div>
          <div className="flex items-center gap-3">
            <button
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              onClick={() => theme.toggle()}
              type="button"
              title="Cambiar tema"
            >
              Tema: {theme.mode === 'dark' ? 'Oscuro' : 'Claro'}
            </button>
            <div className="text-sm text-slate-600 dark:text-slate-300">MVP · Almacén + Ventas B2B</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <button
            className={`rounded-md border px-3 py-2 text-sm ${!isAdminRoute ? 'border-slate-400 bg-slate-50 dark:border-slate-500 dark:bg-slate-800' : 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800'}`}
            onClick={() => navigate('/')}
            type="button"
          >
            Inicio
          </button>
          <button
            className={`rounded-md border px-3 py-2 text-sm ${isAdminRoute ? 'border-slate-400 bg-slate-50 dark:border-slate-500 dark:bg-slate-800' : 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800'}`}
            onClick={() => navigate(`/admin/${adminTab}`)}
            type="button"
          >
            Administración
          </button>
        </div>

        {!isAdminRoute && (
          <>
        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">Conectividad backend</div>
          {healthQuery.isLoading && (
            <div className="text-sm text-slate-600 dark:text-slate-300">Consultando /health…</div>
          )}
          {healthQuery.isError && (
            <div className="text-sm text-red-700">
              No se pudo conectar al backend en {API_BASE_URL}. Si el backend está corriendo, revisa CORS (origen {window.location.origin}).
            </div>
          )}
          {healthQuery.data && (
            <div className="text-sm text-emerald-700">
              OK · {healthQuery.data.service} · {healthQuery.data.time}
            </div>
          )}
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-200">Autenticación</div>
            <div className="space-y-3">
              {(tenant.brandingLoading || tenant.branding) && (
                <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                  {tenant.branding?.logoUrl ? (
                    <img
                      src={tenant.branding.logoUrl}
                      alt="Tenant logo"
                      className="h-8 w-8 rounded border border-slate-200 bg-white object-contain dark:border-slate-700 dark:bg-slate-900"
                    />
                  ) : (
                    <div className="h-8 w-8 rounded border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900" />
                  )}
                  <div>
                    <div className="text-xs text-slate-600 dark:text-slate-300">Tenant</div>
                    <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      {tenant.brandingLoading ? 'Cargando…' : tenant.branding?.tenantName ?? '—'}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>
                <input
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@demo.local"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Password</label>
                <input
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  placeholder="Admin123!"
                />
              </div>

              {authError && <div className="text-sm text-red-700">{authError}</div>}

              <div className="flex items-center gap-3">
                <button
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  onClick={handleLogin}
                >
                  Login
                </button>
                <button
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  onClick={handleLogout}
                  disabled={!token}
                >
                  Logout
                </button>
              </div>

              <div className="text-xs text-slate-600 dark:text-slate-300">
                Token: {token ? 'present' : 'none'}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-medium text-slate-700 dark:text-slate-200">Realtime (Socket.io)</div>
              <div className="text-xs text-slate-600 dark:text-slate-300">Status: {socketStatus}</div>
            </div>
            {!token && <div className="text-sm text-slate-600 dark:text-slate-300">Inicia sesión para conectar al socket.</div>}
            {token && (
              <div className="max-h-64 overflow-auto rounded-md border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                {events.length === 0 ? (
                  <div className="p-3 text-sm text-slate-600 dark:text-slate-300">Aún no hay eventos. Crea movimientos de stock o completa pedidos.</div>
                ) : (
                  <ul className="divide-y divide-slate-200">
                    {events.map((e, idx) => (
                      <li key={idx} className="p-3">
                        <div className="text-xs text-slate-500 dark:text-slate-400">{e.at}</div>
                        <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{e.type}</div>
                        <pre className="mt-2 overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                          {JSON.stringify(e.payload, null, 2)}
                        </pre>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>


        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
          <div className="mb-3 text-sm font-medium text-slate-700">Demo</div>
          {!token && <div className="text-sm text-slate-600">Inicia sesión para ejecutar la demo.</div>}
          {token && (
            <div className="space-y-3">
              <button className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" onClick={runDemoFlow}>
                Ejecutar demo (Stock + Ventas)
              </button>
              {demoStatus && <div className="text-sm text-slate-700">{demoStatus}</div>}
              {demoError && <div className="text-sm text-red-700">{demoError}</div>}
              <div className="text-xs text-slate-600">
                Esto crea un producto, hace un movimiento IN, crea un cliente, crea/confirm/fulfill un pedido.
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium text-slate-700">Buscador ultrarrápido de productos</div>
            <button
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              onClick={() => productSearchQuery.refetch()}
              disabled={!token || productQuery.trim().length === 0 || productSearchQuery.isFetching}
            >
              Buscar
            </button>
          </div>
          {!token && <div className="text-sm text-slate-600">Inicia sesión para buscar productos.</div>}
          {token && (
            <>
              <input
                className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
                placeholder="Buscar por SKU o nombre (q)"
              />
              {productSearchQuery.isFetching && <div className="text-sm text-slate-600">Buscando…</div>}
              {productSearchQuery.isError && <div className="text-sm text-red-700">Error buscando productos</div>}
              {productSearchQuery.data && (
                <div className="max-h-64 overflow-auto rounded-md border border-slate-200">
                  {productSearchQuery.data.items.length === 0 ? (
                    <div className="p-3 text-sm text-slate-600">Sin resultados</div>
                  ) : (
                    <ul className="divide-y divide-slate-200">
                      {productSearchQuery.data.items.map((p) => (
                        <li key={p.id} className="p-3">
                          <div className="text-sm font-medium text-slate-800">{p.name}</div>
                          <div className="text-xs text-slate-600">SKU: {p.sku}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-medium text-slate-700">Customers</div>
              <button
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                onClick={() => customersQuery.refetch()}
                disabled={!token || customersQuery.isFetching}
              >
                Refresh
              </button>
            </div>

            {!token && <div className="text-sm text-slate-600">Inicia sesión para ver customers.</div>}
            {token && (
              <>
                <input
                  className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                  placeholder="Buscar por nombre (q)"
                />

                {customersQuery.isLoading && <div className="text-sm text-slate-600">Cargando…</div>}
                {customersQuery.isError && <div className="text-sm text-red-700">Error cargando customers</div>}
                {customersQuery.data && (
                  <div className="max-h-64 overflow-auto rounded-md border border-slate-200">
                    {customersQuery.data.items.length === 0 ? (
                      <div className="p-3 text-sm text-slate-600">Sin resultados</div>
                    ) : (
                      <ul className="divide-y divide-slate-200">
                        {customersQuery.data.items.map((c) => (
                          <li key={c.id} className="p-3">
                            <div className="text-sm font-medium text-slate-800">{c.name}</div>
                            <div className="text-xs text-slate-600">
                              {c.nit ? `NIT: ${c.nit}` : 'NIT: -'} · {c.email ?? 'email: -'}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-medium text-slate-700">Sales Orders</div>
              <button
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                onClick={() => ordersQuery.refetch()}
                disabled={!token || ordersQuery.isFetching}
              >
                Refresh
              </button>
            </div>

            {!token && <div className="text-sm text-slate-600">Inicia sesión para ver pedidos.</div>}
            {token && (
              <>
                <div className="mb-3 flex items-center gap-2">
                  <label className="text-xs font-medium text-slate-600">Status</label>
                  <select
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    value={orderStatus}
                    onChange={(e) => setOrderStatus(e.target.value as any)}
                  >
                    <option value="ALL">ALL</option>
                    <option value="DRAFT">DRAFT</option>
                    <option value="CONFIRMED">CONFIRMED</option>
                    <option value="FULFILLED">FULFILLED</option>
                    <option value="CANCELLED">CANCELLED</option>
                  </select>
                </div>

                {ordersQuery.isLoading && <div className="text-sm text-slate-600">Cargando…</div>}
                {ordersQuery.isError && <div className="text-sm text-red-700">Error cargando pedidos</div>}
                {ordersQuery.data && (
                  <div className="max-h-64 overflow-auto rounded-md border border-slate-200">
                    {ordersQuery.data.items.length === 0 ? (
                      <div className="p-3 text-sm text-slate-600">Sin resultados</div>
                    ) : (
                      <ul className="divide-y divide-slate-200">
                        {ordersQuery.data.items.map((o) => (
                          <li key={o.id} className="p-3">
                            <button
                              className="w-full text-left"
                              onClick={() => setSelectedOrderId(o.id)}
                              title="Ver detalle"
                            >
                              <div className="flex items-center justify-between">
                                <div className="text-sm font-medium text-slate-800">{o.number}</div>
                                <div className="text-xs text-slate-600">{o.status}</div>
                              </div>
                              {o.note && <div className="mt-1 text-xs text-slate-600">{o.note}</div>}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium text-slate-700">Order detail</div>
            <button
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              onClick={() => orderDetailQuery.refetch()}
              disabled={!token || !selectedOrderId || orderDetailQuery.isFetching}
            >
              Refresh
            </button>
          </div>

          {!token && <div className="text-sm text-slate-600">Inicia sesión para ver detalle.</div>}
          {token && !selectedOrderId && <div className="text-sm text-slate-600">Selecciona un pedido en la lista.</div>}
          {token && selectedOrderId && (
            <>
              {orderDetailQuery.isLoading && <div className="text-sm text-slate-600">Cargando…</div>}
              {orderDetailQuery.isError && <div className="text-sm text-red-700">Error cargando detalle</div>}
              {orderDetailQuery.data && (
                <pre className="max-h-96 overflow-auto rounded bg-slate-50 p-3 text-xs text-slate-800">
                  {JSON.stringify(orderDetailQuery.data, null, 2)}
                </pre>
              )}
            </>
          )}
        </div>

          </>
        )}

        {isAdminRoute ? (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-medium text-slate-700">Administración, Auditoría & Reportes</div>
            <div className="flex flex-wrap gap-2">
              <button
                className={`rounded-md border px-3 py-2 text-sm ${adminTab === 'roles' ? 'border-slate-400 bg-slate-50' : 'border-slate-300 bg-white'}`}
                onClick={() => setAdminTab('roles')}
              >
                Roles
              </button>
              <button
                className={`rounded-md border px-3 py-2 text-sm ${adminTab === 'users' ? 'border-slate-400 bg-slate-50' : 'border-slate-300 bg-white'}`}
                onClick={() => setAdminTab('users')}
              >
                Usuarios
              </button>
              <button
                className={`rounded-md border px-3 py-2 text-sm ${adminTab === 'permissions' ? 'border-slate-400 bg-slate-50' : 'border-slate-300 bg-white'}`}
                onClick={() => setAdminTab('permissions')}
              >
                Permisos
              </button>
              <button
                className={`rounded-md border px-3 py-2 text-sm ${adminTab === 'audit' ? 'border-slate-400 bg-slate-50' : 'border-slate-300 bg-white'}`}
                onClick={() => setAdminTab('audit')}
              >
                Auditoría
              </button>
              <button
                className={`rounded-md border px-3 py-2 text-sm ${adminTab === 'reports' ? 'border-slate-400 bg-slate-50' : 'border-slate-300 bg-white'}`}
                onClick={() => setAdminTab('reports')}
              >
                Reportes
              </button>
              <button
                className={`rounded-md border px-3 py-2 text-sm ${adminTab === 'branding' ? 'border-slate-400 bg-slate-50' : 'border-slate-300 bg-white'}`}
                onClick={() => setAdminTab('branding')}
              >
                Branding
              </button>
              <button
                className={`rounded-md border px-3 py-2 text-sm ${adminTab === 'tenants' ? 'border-slate-400 bg-slate-50' : 'border-slate-300 bg-white'}`}
                onClick={() => setAdminTab('tenants')}
              >
                Tenants
              </button>
            </div>
          </div>

          {!token && <div className="text-sm text-slate-600">Inicia sesión para usar administración y auditoría.</div>}

          {token && adminNotice && (
            <div
              className={`mb-4 rounded-md border p-3 text-sm ${
                adminNotice.kind === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              {adminNotice.message}
            </div>
          )}

          {token && adminTab === 'permissions' && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-medium text-slate-700">Catálogo de permisos</div>
                <button
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  onClick={() => permissionsQuery.refetch()}
                  disabled={permissionsQuery.isFetching}
                >
                  Refresh
                </button>
              </div>
              {permissionsQuery.isLoading && <div className="text-sm text-slate-600">Cargando…</div>}
              {permissionsQuery.isError && <div className="text-sm text-red-700">Error cargando permisos</div>}
              {permissionsQuery.data && (
                <div className="max-h-80 overflow-auto rounded-md border border-slate-200">
                  <ul className="divide-y divide-slate-200">
                    {permissionsQuery.data.items.map((p) => (
                      <li key={p.id} className="p-3">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium text-slate-800">{p.code}</div>
                          <div className="text-xs text-slate-600">{p.module}</div>
                        </div>
                        <div className="mt-1 text-xs text-slate-600">{p.description ?? '-'}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {token && adminTab === 'branding' && (
            <div className="space-y-4">
              <div className="text-sm font-medium text-slate-700">Branding del tenant</div>

              {tenantBrandingAdminQuery.isLoading && <div className="text-sm text-slate-600">Cargando…</div>}
              {tenantBrandingAdminQuery.isError && (
                <div className="text-sm text-red-700">No se pudo cargar el branding.</div>
              )}

              {brandingError && <div className="text-sm text-red-700">{brandingError}</div>}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-md border border-slate-200 p-4">
                  <div className="mb-3 text-sm font-medium text-slate-700">Logo</div>

                  <div className="flex items-center gap-3">
                    {brandingLogoUrl ? (
                      <img
                        src={brandingLogoUrl}
                        alt="Logo"
                        className="h-12 w-12 rounded border border-slate-200 object-contain"
                      />
                    ) : (
                      <div className="h-12 w-12 rounded border border-dashed border-slate-300 bg-slate-50" />
                    )}
                    <div className="flex-1">
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        onChange={(e) => setBrandingFile(e.target.files?.[0] ?? null)}
                      />
                      <div className="mt-2 text-xs text-slate-600">
                        Se sube a S3-compatible con URL firmada (PUT) al guardar.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 p-4">
                  <div className="mb-3 text-sm font-medium text-slate-700">Colores & tema</div>

                  <div className="grid gap-3">
                    <label className="flex items-center justify-between gap-3 text-sm text-slate-700">
                      <span>Primario</span>
                      <span className="flex items-center gap-2">
                        <input type="color" value={brandingPrimary} onChange={(e) => setBrandingPrimary(e.target.value)} />
                        <input
                          className="w-28 rounded border border-slate-300 px-2 py-1 text-sm"
                          value={brandingPrimary}
                          onChange={(e) => setBrandingPrimary(e.target.value)}
                        />
                      </span>
                    </label>
                    <label className="flex items-center justify-between gap-3 text-sm text-slate-700">
                      <span>Secundario</span>
                      <span className="flex items-center gap-2">
                        <input type="color" value={brandingSecondary} onChange={(e) => setBrandingSecondary(e.target.value)} />
                        <input
                          className="w-28 rounded border border-slate-300 px-2 py-1 text-sm"
                          value={brandingSecondary}
                          onChange={(e) => setBrandingSecondary(e.target.value)}
                        />
                      </span>
                    </label>
                    <label className="flex items-center justify-between gap-3 text-sm text-slate-700">
                      <span>Terciario</span>
                      <span className="flex items-center gap-2">
                        <input type="color" value={brandingTertiary} onChange={(e) => setBrandingTertiary(e.target.value)} />
                        <input
                          className="w-28 rounded border border-slate-300 px-2 py-1 text-sm"
                          value={brandingTertiary}
                          onChange={(e) => setBrandingTertiary(e.target.value)}
                        />
                      </span>
                    </label>

                    <label className="flex items-center justify-between gap-3 text-sm text-slate-700">
                      <span>Tema por defecto</span>
                      <select
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                        value={brandingTheme}
                        onChange={(e) => setBrandingTheme(e.target.value as any)}
                      >
                        <option value="LIGHT">Claro</option>
                        <option value="DARK">Oscuro</option>
                      </select>
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <button
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  onClick={() => tenantBrandingAdminQuery.refetch()}
                  disabled={tenantBrandingAdminQuery.isFetching || brandingBusy}
                >
                  Recargar
                </button>
                <button
                  className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white"
                  onClick={() => void saveTenantBranding()}
                  disabled={brandingBusy}
                >
                  {brandingBusy ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </div>
          )}

          {token && adminTab === 'roles' && (
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">Roles</div>
                <div className="mb-3 flex items-center gap-2">
                  <input
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Buscar (code o name)"
                    value={roleQ}
                    onChange={(e) => {
                      setRoleQ(e.target.value)
                      setSelectedRoleId(null)
                    }}
                  />
                  <button
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    onClick={() => rolesQuery.refetch()}
                    disabled={rolesQuery.isFetching}
                  >
                    Refresh
                  </button>
                </div>

                {rolesQuery.isLoading && <div className="text-sm text-slate-600">Cargando…</div>}
                {rolesQuery.isError && <div className="text-sm text-red-700">Error cargando roles</div>}
                <div className="max-h-80 overflow-auto rounded-md border border-slate-200">
                  {allRoles.length === 0 ? (
                    <div className="p-3 text-sm text-slate-600">Sin roles</div>
                  ) : (
                    <ul className="divide-y divide-slate-200">
                      {allRoles.map((r) => (
                        <li key={r.id} className="p-3">
                          <button className="w-full text-left" onClick={() => setSelectedRoleId(r.id)}>
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-medium text-slate-800">{r.code}</div>
                              <div className="text-xs text-slate-600">v{r.version}</div>
                            </div>
                            <div className="mt-1 text-xs text-slate-600">{r.name}</div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="mt-3">
                  <button
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    onClick={() => rolesQuery.fetchNextPage()}
                    disabled={!rolesQuery.hasNextPage || rolesQuery.isFetchingNextPage}
                  >
                    {rolesQuery.hasNextPage ? (rolesQuery.isFetchingNextPage ? 'Cargando…' : 'Cargar más') : 'No hay más'}
                  </button>
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">Crear rol</div>
                <div className="space-y-3 rounded-md border border-slate-200 p-3">
                  <input
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Code (ej: SALES_CLERK)"
                    value={roleCreateCode}
                    onChange={(e) => setRoleCreateCode(e.target.value)}
                  />
                  <input
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Name"
                    value={roleCreateName}
                    onChange={(e) => setRoleCreateName(e.target.value)}
                  />

                  <div className="text-xs font-medium text-slate-600">Permisos</div>
                  <div className="max-h-40 overflow-auto rounded-md border border-slate-200 p-2">
                    {(permissionsQuery.data?.items ?? []).length === 0 ? (
                      <div className="text-sm text-slate-600">Carga permisos primero.</div>
                    ) : (
                      <div className="space-y-1">
                        {(permissionsQuery.data?.items ?? []).map((p) => (
                          <label key={p.code} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={Boolean(roleCreatePermCodes[p.code])}
                              onChange={(e) =>
                                setRoleCreatePermCodes((prev) => ({ ...prev, [p.code]: e.target.checked }))
                              }
                            />
                            <span className="text-slate-800">{p.code}</span>
                            <span className="text-xs text-slate-500">({p.module})</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {createRoleMutation.isError && (
                    <div className="text-sm text-red-700">{(createRoleMutation.error as any)?.message ?? 'Error creando rol'}</div>
                  )}
                  <button
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    onClick={() => createRoleMutation.mutate()}
                    disabled={createRoleMutation.isPending || roleCreateCode.trim().length < 2 || roleCreateName.trim().length < 2}
                  >
                    {createRoleMutation.isPending ? 'Creando…' : 'Crear rol'}
                  </button>
                </div>

                <div className="mt-6 mb-2 text-sm font-medium text-slate-700">Editar permisos del rol</div>
                {!selectedRole && <div className="text-sm text-slate-600">Selecciona un rol de la lista.</div>}
                {selectedRole && (
                  <div className="space-y-3 rounded-md border border-slate-200 p-3">
                    <div>
                      <div className="text-sm font-medium text-slate-800">{selectedRole.code}</div>
                      <div className="text-xs text-slate-600">{selectedRole.name}</div>
                    </div>

                    <div className="max-h-52 overflow-auto rounded-md border border-slate-200 p-2">
                      <div className="space-y-1">
                        {(permissionsQuery.data?.items ?? []).map((p) => (
                          <label key={p.code} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={Boolean(roleEditPermCodes[p.code])}
                              onChange={(e) =>
                                setRoleEditPermCodes((prev) => ({ ...prev, [p.code]: e.target.checked }))
                              }
                            />
                            <span className="text-slate-800">{p.code}</span>
                            <span className="text-xs text-slate-500">({p.module})</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {replaceRolePermsMutation.isError && (
                      <div className="text-sm text-red-700">{(replaceRolePermsMutation.error as any)?.message ?? 'Error actualizando permisos'}</div>
                    )}

                    <div className="flex items-center justify-between">
                      <div className="text-xs text-slate-600">
                        {roleSaveAt ? `Guardado: ${roleSaveAt}` : isRolePermDirty ? 'Cambios sin guardar' : 'Sin cambios'}
                      </div>
                      <button
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                        onClick={() => {
                          if (!selectedRole) return
                          const ok = window.confirm(`Guardar permisos para el rol ${selectedRole.code}?`)
                          if (ok) replaceRolePermsMutation.mutate()
                        }}
                        disabled={replaceRolePermsMutation.isPending || !isRolePermDirty}
                        title={!isRolePermDirty ? 'No hay cambios para guardar' : 'Guardar'}
                      >
                        {replaceRolePermsMutation.isPending ? 'Guardando…' : 'Guardar permisos'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {token && adminTab === 'users' && (
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">Usuarios</div>
                <div className="mb-3 flex items-center gap-2">
                  <input
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Buscar por email (q)"
                    value={userQ}
                    onChange={(e) => {
                      setUserQ(e.target.value)
                      setSelectedUserId(null)
                    }}
                  />
                  <button
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    onClick={() => usersQuery.refetch()}
                    disabled={usersQuery.isFetching}
                  >
                    Refresh
                  </button>
                </div>

                {usersQuery.isLoading && <div className="text-sm text-slate-600">Cargando…</div>}
                {usersQuery.isError && <div className="text-sm text-red-700">Error cargando usuarios</div>}
                <div className="max-h-80 overflow-auto rounded-md border border-slate-200">
                  {allUsers.length === 0 ? (
                    <div className="p-3 text-sm text-slate-600">Sin usuarios</div>
                  ) : (
                    <ul className="divide-y divide-slate-200">
                      {allUsers.map((u) => (
                        <li key={u.id} className="p-3">
                          <button className="w-full text-left" onClick={() => setSelectedUserId(u.id)}>
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-medium text-slate-800">{u.email}</div>
                              <div className="text-xs text-slate-600">{u.isActive ? 'active' : 'inactive'}</div>
                            </div>
                            <div className="mt-1 text-xs text-slate-600">
                              Roles: {u.roles.length ? u.roles.map((r) => r.code).join(', ') : '-'}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="mt-3">
                  <button
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    onClick={() => usersQuery.fetchNextPage()}
                    disabled={!usersQuery.hasNextPage || usersQuery.isFetchingNextPage}
                  >
                    {usersQuery.hasNextPage ? (usersQuery.isFetchingNextPage ? 'Cargando…' : 'Cargar más') : 'No hay más'}
                  </button>
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">Crear usuario</div>
                <div className="space-y-3 rounded-md border border-slate-200 p-3">
                  <input
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Email"
                    value={userCreateEmail}
                    onChange={(e) => setUserCreateEmail(e.target.value)}
                  />
                  <input
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Password"
                    type="password"
                    value={userCreatePassword}
                    onChange={(e) => setUserCreatePassword(e.target.value)}
                  />
                  <input
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Full name (opcional)"
                    value={userCreateFullName}
                    onChange={(e) => setUserCreateFullName(e.target.value)}
                  />

                  <div className="text-xs font-medium text-slate-600">Roles iniciales</div>
                  <div className="max-h-40 overflow-auto rounded-md border border-slate-200 p-2">
                    {allRoles.length === 0 ? (
                      <div className="text-sm text-slate-600">Crea o carga roles primero.</div>
                    ) : (
                      <div className="space-y-1">
                        {allRoles.map((r) => (
                          <label key={r.id} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={Boolean(userCreateRoleIds[r.id])}
                              onChange={(e) =>
                                setUserCreateRoleIds((prev) => ({ ...prev, [r.id]: e.target.checked }))
                              }
                            />
                            <span className="text-slate-800">{r.code}</span>
                            <span className="text-xs text-slate-500">({r.name})</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {createUserMutation.isError && (
                    <div className="text-sm text-red-700">{(createUserMutation.error as any)?.message ?? 'Error creando usuario'}</div>
                  )}
                  <button
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    onClick={() => createUserMutation.mutate()}
                    disabled={
                      createUserMutation.isPending ||
                      userCreateEmail.trim().length < 3 ||
                      !userCreateEmail.includes('@') ||
                      userCreatePassword.length < 6
                    }
                  >
                    {createUserMutation.isPending ? 'Creando…' : 'Crear usuario'}
                  </button>
                </div>

                <div className="mt-6 mb-2 text-sm font-medium text-slate-700">Asignar roles</div>
                {!selectedUser && <div className="text-sm text-slate-600">Selecciona un usuario de la lista.</div>}
                {selectedUser && (
                  <div className="space-y-3 rounded-md border border-slate-200 p-3">
                    <div>
                      <div className="text-sm font-medium text-slate-800">{selectedUser.email}</div>
                      <div className="text-xs text-slate-600">{selectedUser.fullName ?? '-'}</div>
                    </div>

                    <div className="max-h-52 overflow-auto rounded-md border border-slate-200 p-2">
                      <div className="space-y-1">
                        {allRoles.map((r) => (
                          <label key={r.id} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={Boolean(userEditRoleIds[r.id])}
                              onChange={(e) => setUserEditRoleIds((prev) => ({ ...prev, [r.id]: e.target.checked }))}
                            />
                            <span className="text-slate-800">{r.code}</span>
                            <span className="text-xs text-slate-500">({r.name})</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {replaceUserRolesMutation.isError && (
                      <div className="text-sm text-red-700">{(replaceUserRolesMutation.error as any)?.message ?? 'Error actualizando roles'}</div>
                    )}
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-slate-600">
                        {userSaveAt ? `Guardado: ${userSaveAt}` : isUserRolesDirty ? 'Cambios sin guardar' : 'Sin cambios'}
                      </div>
                      <button
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                        onClick={() => {
                          if (!selectedUser) return
                          const ok = window.confirm(`Guardar roles para ${selectedUser.email}?`)
                          if (ok) replaceUserRolesMutation.mutate()
                        }}
                        disabled={replaceUserRolesMutation.isPending || !isUserRolesDirty}
                        title={!isUserRolesDirty ? 'No hay cambios para guardar' : 'Guardar'}
                      >
                        {replaceUserRolesMutation.isPending ? 'Guardando…' : 'Guardar roles'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {token && adminTab === 'audit' && (
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">Eventos (AuditEvent)</div>
                <div className="grid gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Action (contains)"
                      value={auditAction}
                      onChange={(e) => setAuditAction(e.target.value)}
                    />
                    <input
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="EntityType"
                      value={auditEntityType}
                      onChange={(e) => setAuditEntityType(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="EntityId"
                      value={auditEntityId}
                      onChange={(e) => setAuditEntityId(e.target.value)}
                    />
                    <input
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="ActorUserId"
                      value={auditActorUserId}
                      onChange={(e) => setAuditActorUserId(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                      type="datetime-local"
                      value={auditFrom}
                      onChange={(e) => setAuditFrom(e.target.value)}
                    />
                    <input
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                      type="datetime-local"
                      value={auditTo}
                      onChange={(e) => setAuditTo(e.target.value)}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={auditIncludePayload} onChange={(e) => setAuditIncludePayload(e.target.checked)} />
                    Incluir payload (before/after/metadata)
                  </label>
                  {auditFilterError && <div className="text-sm text-red-700">{auditFilterError}</div>}
                  <div className="flex items-center gap-2">
                    <button
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                      onClick={() => {
                        if (!validateAuditFilters()) return
                        auditQuery.refetch()
                      }}
                      disabled={auditQuery.isFetching}
                    >
                      Buscar
                    </button>
                    <button
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                      onClick={() => {
                        setAuditAction('')
                        setAuditEntityType('')
                        setAuditEntityId('')
                        setAuditActorUserId('')
                        setAuditFrom('')
                        setAuditTo('')
                        setAuditIncludePayload(false)
                        setSelectedAuditEventId(null)
                        setAuditFilterError(null)
                      }}
                    >
                      Limpiar
                    </button>
                  </div>
                </div>

                {auditQuery.isLoading && <div className="mt-3 text-sm text-slate-600">Cargando…</div>}
                {auditQuery.isError && <div className="mt-3 text-sm text-red-700">Error cargando auditoría</div>}
                <div className="mt-3 max-h-80 overflow-auto rounded-md border border-slate-200">
                  {auditItems.length === 0 ? (
                    <div className="p-3 text-sm text-slate-600">Sin eventos (ajusta filtros o crea actividad).</div>
                  ) : (
                    <ul className="divide-y divide-slate-200">
                      {auditItems.map((ev) => (
                        <li key={ev.id} className="p-3">
                          <button
                            className={`w-full rounded-md p-2 text-left ${
                              selectedAuditEventId === ev.id ? 'bg-slate-50 ring-1 ring-slate-200' : 'hover:bg-slate-50'
                            }`}
                            onClick={() => setSelectedAuditEventId(ev.id)}
                            title={ev.id}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <div className="text-sm font-medium text-slate-800">{ev.action}</div>
                                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700">
                                  {ev.entityType}
                                </span>
                              </div>
                              <div className="text-xs text-slate-600">{new Date(ev.createdAt).toLocaleString()}</div>
                            </div>
                            <div className="mt-1 text-xs text-slate-600">
                              <span className="font-medium">actor:</span> {ev.actor?.email ?? ev.actorUserId ?? '-'}
                              {ev.entityId ? (
                                <>
                                  {' '}
                                  · <span className="font-medium">entityId:</span> {ev.entityId}
                                </>
                              ) : null}
                            </div>
                          </button>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <button
                              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                              onClick={() => copyToClipboard(ev.id, 'Event ID')}
                            >
                              Copiar Event ID
                            </button>
                            {ev.entityId && (
                              <button
                                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                                onClick={() => copyToClipboard(ev.entityId!, 'Entity ID')}
                              >
                                Copiar Entity ID
                              </button>
                            )}
                            <button
                              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                              onClick={() => {
                                setAuditAction(ev.action)
                                setAuditEntityType(ev.entityType)
                                if (ev.entityId) setAuditEntityId(ev.entityId)
                              }}
                              title="Cargar filtros desde este evento"
                            >
                              Usar como filtro
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="mt-3">
                  <button
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    onClick={() => {
                      if (!validateAuditFilters()) return
                      auditQuery.fetchNextPage()
                    }}
                    disabled={!auditQuery.hasNextPage || auditQuery.isFetchingNextPage}
                  >
                    {auditQuery.hasNextPage ? (auditQuery.isFetchingNextPage ? 'Cargando…' : 'Cargar más') : 'No hay más'}
                  </button>
                  <div className="mt-2 text-xs text-slate-600">Mostrando {auditItems.length} evento(s)</div>
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">Detalle del evento</div>
                {!selectedAuditEventId && <div className="text-sm text-slate-600">Selecciona un evento de la lista.</div>}
                {selectedAuditEventId && (
                  <>
                    {selectedAuditEvent && (
                      <div className="mb-3 rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-medium text-slate-800">{selectedAuditEvent.action}</div>
                            <div className="text-xs text-slate-600">{selectedAuditEvent.entityType}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                              onClick={() => copyToClipboard(selectedAuditEvent.id, 'Event ID')}
                            >
                              Copiar ID
                            </button>
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-slate-600">{new Date(selectedAuditEvent.createdAt).toLocaleString()}</div>
                      </div>
                    )}
                    {auditDetailQuery.isLoading && <div className="text-sm text-slate-600">Cargando…</div>}
                    {auditDetailQuery.isError && <div className="text-sm text-red-700">Error cargando detalle</div>}
                    {auditDetailQuery.data && (
                      <div className="space-y-3">
                        <details className="rounded-md border border-slate-200 bg-white p-3" open>
                          <summary className="cursor-pointer select-none text-sm font-medium text-slate-800">
                            before
                          </summary>
                          <div className="mt-2">{renderJson((auditDetailQuery.data as any).before)}</div>
                        </details>

                        <details className="rounded-md border border-slate-200 bg-white p-3" open>
                          <summary className="cursor-pointer select-none text-sm font-medium text-slate-800">
                            after
                          </summary>
                          <div className="mt-2">{renderJson((auditDetailQuery.data as any).after)}</div>
                        </details>

                        <details className="rounded-md border border-slate-200 bg-white p-3">
                          <summary className="cursor-pointer select-none text-sm font-medium text-slate-800">
                            metadata
                          </summary>
                          <div className="mt-2">{renderJson((auditDetailQuery.data as any).metadata)}</div>
                        </details>

                        <details className="rounded-md border border-slate-200 bg-white p-3">
                          <summary className="cursor-pointer select-none text-sm font-medium text-slate-800">
                            raw event
                          </summary>
                          <div className="mt-2">{renderJson(auditDetailQuery.data)}</div>
                        </details>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {token && adminTab === 'reports' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium text-slate-700">Reportes (Phase 1)</div>
                <button
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  onClick={() => {
                    if (!validateReportsDateRange(salesFrom, salesTo)) return
                    if (!validateReportsDateRange(movesFrom, movesTo)) return
                    salesSummaryQuery.refetch()
                    topProductsQuery.refetch()
                    stockBalancesExpandedQuery.refetch()
                    stockMovementsExpandedQuery.refetch()
                    expirySummaryQuery.refetch()
                    warehousesQuery.refetch()
                  }}
                  disabled={
                    salesSummaryQuery.isFetching ||
                    topProductsQuery.isFetching ||
                    stockBalancesExpandedQuery.isFetching ||
                    stockMovementsExpandedQuery.isFetching ||
                    expirySummaryQuery.isFetching
                  }
                >
                  Refresh todo
                </button>
              </div>

              {reportsFilterError && <div className="text-sm text-red-700">{reportsFilterError}</div>}

              <div className="rounded-md border border-slate-200 p-4">
                <div className="mb-3 text-sm font-medium text-slate-800">Ventas</div>
                <div className="grid gap-2 md:grid-cols-4">
                  <input
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    type="datetime-local"
                    value={salesFrom}
                    onChange={(e) => setSalesFrom(e.target.value)}
                    title="from"
                  />
                  <input
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    type="datetime-local"
                    value={salesTo}
                    onChange={(e) => setSalesTo(e.target.value)}
                    title="to"
                  />
                  <select
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    value={salesStatus}
                    onChange={(e) => setSalesStatus(e.target.value as any)}
                    title="status"
                  >
                    <option value="ALL">ALL</option>
                    <option value="DRAFT">DRAFT</option>
                    <option value="CONFIRMED">CONFIRMED</option>
                    <option value="FULFILLED">FULFILLED</option>
                    <option value="CANCELLED">CANCELLED</option>
                  </select>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-slate-600">Top</label>
                    <input
                      className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm"
                      type="number"
                      min={1}
                      max={50}
                      value={topTake}
                      onChange={(e) => setTopTake(Number(e.target.value || 10))}
                    />
                  </div>
                </div>

                <div className="mt-3 grid gap-6 md:grid-cols-2">
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-medium text-slate-700">Resumen diario</div>
                      <button
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                        onClick={() => {
                          if (!validateReportsDateRange(salesFrom, salesTo)) return
                          salesSummaryQuery.refetch()
                        }}
                        disabled={salesSummaryQuery.isFetching}
                      >
                        Refresh
                      </button>
                    </div>
                    {salesSummaryQuery.isLoading && <div className="text-sm text-slate-600">Cargando…</div>}
                    {salesSummaryQuery.isError && <div className="text-sm text-red-700">Error cargando resumen</div>}
                    {salesSummaryQuery.data && (
                      <div className="overflow-auto rounded-md border border-slate-200">
                        <table className="min-w-full text-left text-sm">
                          <thead className="bg-slate-50 text-xs text-slate-600">
                            <tr>
                              <th className="px-3 py-2">Día</th>
                              <th className="px-3 py-2">Órdenes</th>
                              <th className="px-3 py-2">Líneas</th>
                              <th className="px-3 py-2">Qty</th>
                              <th className="px-3 py-2">Monto</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {salesSummaryQuery.data.items.length === 0 ? (
                              <tr>
                                <td className="px-3 py-3 text-slate-600" colSpan={5}>
                                  Sin datos
                                </td>
                              </tr>
                            ) : (
                              salesSummaryQuery.data.items.map((r) => (
                                <tr key={r.day}>
                                  <td className="px-3 py-2 font-medium text-slate-800">{r.day}</td>
                                  <td className="px-3 py-2">{r.ordersCount}</td>
                                  <td className="px-3 py-2">{r.linesCount}</td>
                                  <td className="px-3 py-2">{r.quantity}</td>
                                  <td className="px-3 py-2">{r.amount}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-medium text-slate-700">Top productos</div>
                      <button
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                        onClick={() => {
                          if (!validateReportsDateRange(salesFrom, salesTo)) return
                          topProductsQuery.refetch()
                        }}
                        disabled={topProductsQuery.isFetching}
                      >
                        Refresh
                      </button>
                    </div>
                    {topProductsQuery.isLoading && <div className="text-sm text-slate-600">Cargando…</div>}
                    {topProductsQuery.isError && <div className="text-sm text-red-700">Error cargando top productos</div>}
                    {topProductsQuery.data && (
                      <div className="overflow-auto rounded-md border border-slate-200">
                        <table className="min-w-full text-left text-sm">
                          <thead className="bg-slate-50 text-xs text-slate-600">
                            <tr>
                              <th className="px-3 py-2">SKU</th>
                              <th className="px-3 py-2">Nombre</th>
                              <th className="px-3 py-2">Qty</th>
                              <th className="px-3 py-2">Monto</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {topProductsQuery.data.items.length === 0 ? (
                              <tr>
                                <td className="px-3 py-3 text-slate-600" colSpan={4}>
                                  Sin datos
                                </td>
                              </tr>
                            ) : (
                              topProductsQuery.data.items.map((p) => (
                                <tr key={p.productId}>
                                  <td className="px-3 py-2 font-medium text-slate-800">{p.sku}</td>
                                  <td className="px-3 py-2">{p.name}</td>
                                  <td className="px-3 py-2">{p.quantity}</td>
                                  <td className="px-3 py-2">{p.amount}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-slate-200 p-4">
                <div className="mb-3 text-sm font-medium text-slate-800">Stock</div>
                <div className="grid gap-2 md:grid-cols-4">
                  <input
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="warehouseId (uuid)"
                    value={stockWarehouseId}
                    onChange={(e) => setStockWarehouseId(e.target.value)}
                  />
                  <input
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="locationId (uuid)"
                    value={stockLocationId}
                    onChange={(e) => setStockLocationId(e.target.value)}
                  />
                  <input
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="productId (uuid)"
                    value={stockProductId}
                    onChange={(e) => setStockProductId(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-slate-600">Take</label>
                    <input
                      className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm"
                      type="number"
                      min={1}
                      max={200}
                      value={stockTake}
                      onChange={(e) => setStockTake(Number(e.target.value || 100))}
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-medium text-slate-700">Balances (expanded)</div>
                    <button
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                      onClick={() => stockBalancesExpandedQuery.refetch()}
                      disabled={stockBalancesExpandedQuery.isFetching}
                    >
                      Refresh
                    </button>
                  </div>
                  {stockBalancesExpandedQuery.isLoading && <div className="text-sm text-slate-600">Cargando…</div>}
                  {stockBalancesExpandedQuery.isError && <div className="text-sm text-red-700">Error cargando balances</div>}
                  {stockBalancesExpandedQuery.data && (
                    <div className="max-h-96 overflow-auto rounded-md border border-slate-200">
                      <table className="min-w-full text-left text-sm">
                        <thead className="bg-slate-50 text-xs text-slate-600">
                          <tr>
                            <th className="px-3 py-2">WH</th>
                            <th className="px-3 py-2">Loc</th>
                            <th className="px-3 py-2">SKU</th>
                            <th className="px-3 py-2">Producto</th>
                            <th className="px-3 py-2">Batch</th>
                            <th className="px-3 py-2">Vence</th>
                            <th className="px-3 py-2">Días</th>
                            <th className="px-3 py-2">Estado</th>
                            <th className="px-3 py-2">Qty</th>
                            <th className="px-3 py-2">Updated</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {stockBalancesExpandedQuery.data.items.length === 0 ? (
                            <tr>
                              <td className="px-3 py-3 text-slate-600" colSpan={10}>
                                Sin datos
                              </td>
                            </tr>
                          ) : (
                            stockBalancesExpandedQuery.data.items.map((b) => (
                              (() => {
                                const expIso = b.batch?.expiresAt ?? null
                                const expDate = expIso ? new Date(expIso) : null
                                const todayUtc = startOfTodayUtc()
                                const d = expDate ? daysToExpire(expDate, todayUtc) : null
                                const st = d === null ? null : statusForDays(d)
                                return (
                              <tr key={b.id}>
                                <td className="px-3 py-2">{b.location.warehouse.code}</td>
                                <td className="px-3 py-2">{b.location.code}</td>
                                <td className="px-3 py-2 font-medium text-slate-800">{b.product.sku}</td>
                                <td className="px-3 py-2">{b.product.name}</td>
                                <td className="px-3 py-2">{b.batch?.batchNumber ?? '-'}</td>
                                <td className="px-3 py-2">{expDate ? expDate.toLocaleDateString() : '-'}</td>
                                <td className="px-3 py-2">{d === null ? '-' : d}</td>
                                <td className="px-3 py-2">{st ? expiryBadge(st) : '-'}</td>
                                <td className="px-3 py-2">{b.quantity}</td>
                                <td className="px-3 py-2">{new Date(b.updatedAt).toLocaleString()}</td>
                              </tr>
                                )
                              })()
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="mt-6">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-medium text-slate-700">Movimientos (expanded)</div>
                    <button
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                      onClick={() => {
                        if (!validateReportsDateRange(movesFrom, movesTo)) return
                        stockMovementsExpandedQuery.refetch()
                      }}
                      disabled={stockMovementsExpandedQuery.isFetching}
                    >
                      Refresh
                    </button>
                  </div>

                  <div className="grid gap-2 md:grid-cols-4">
                    <input
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                      type="datetime-local"
                      value={movesFrom}
                      onChange={(e) => setMovesFrom(e.target.value)}
                      title="from"
                    />
                    <input
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                      type="datetime-local"
                      value={movesTo}
                      onChange={(e) => setMovesTo(e.target.value)}
                      title="to"
                    />
                    <input
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="productId (uuid)"
                      value={movesProductId}
                      onChange={(e) => setMovesProductId(e.target.value)}
                    />
                    <div className="flex items-center gap-2">
                      <input
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        placeholder="locationId (uuid)"
                        value={movesLocationId}
                        onChange={(e) => setMovesLocationId(e.target.value)}
                      />
                      <input
                        className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm"
                        type="number"
                        min={1}
                        max={200}
                        value={movesTake}
                        onChange={(e) => setMovesTake(Number(e.target.value || 100))}
                        title="take"
                      />
                    </div>
                  </div>

                  {stockMovementsExpandedQuery.isLoading && <div className="mt-2 text-sm text-slate-600">Cargando…</div>}
                  {stockMovementsExpandedQuery.isError && <div className="mt-2 text-sm text-red-700">Error cargando movimientos</div>}
                  {stockMovementsExpandedQuery.data && (
                    <div className="mt-2 max-h-96 overflow-auto rounded-md border border-slate-200">
                      <table className="min-w-full text-left text-sm">
                        <thead className="bg-slate-50 text-xs text-slate-600">
                          <tr>
                            <th className="px-3 py-2">Fecha</th>
                            <th className="px-3 py-2">Tipo</th>
                            <th className="px-3 py-2">SKU</th>
                            <th className="px-3 py-2">Producto</th>
                            <th className="px-3 py-2">Batch</th>
                            <th className="px-3 py-2">Vence</th>
                            <th className="px-3 py-2">Días</th>
                            <th className="px-3 py-2">Estado</th>
                            <th className="px-3 py-2">Qty</th>
                            <th className="px-3 py-2">From</th>
                            <th className="px-3 py-2">To</th>
                            <th className="px-3 py-2">Ref</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {stockMovementsExpandedQuery.data.items.length === 0 ? (
                            <tr>
                              <td className="px-3 py-3 text-slate-600" colSpan={12}>
                                Sin datos
                              </td>
                            </tr>
                          ) : (
                            stockMovementsExpandedQuery.data.items.map((m) => (
                              (() => {
                                const expIso = m.batch?.expiresAt ?? null
                                const expDate = expIso ? new Date(expIso) : null
                                const todayUtc = startOfTodayUtc()
                                const d = expDate ? daysToExpire(expDate, todayUtc) : null
                                const st = d === null ? null : statusForDays(d)
                                return (
                              <tr key={m.id} title={m.id}>
                                <td className="px-3 py-2">{new Date(m.createdAt).toLocaleString()}</td>
                                <td className="px-3 py-2">{m.type}</td>
                                <td className="px-3 py-2 font-medium text-slate-800">{m.product.sku}</td>
                                <td className="px-3 py-2">{m.product.name}</td>
                                <td className="px-3 py-2">{m.batch?.batchNumber ?? '-'}</td>
                                <td className="px-3 py-2">{expDate ? expDate.toLocaleDateString() : '-'}</td>
                                <td className="px-3 py-2">{d === null ? '-' : d}</td>
                                <td className="px-3 py-2">{st ? expiryBadge(st) : '-'}</td>
                                <td className="px-3 py-2">{m.quantity}</td>
                                <td className="px-3 py-2">
                                  {m.fromLocation ? `${m.fromLocation.warehouse.code}/${m.fromLocation.code}` : '-'}
                                </td>
                                <td className="px-3 py-2">
                                  {m.toLocation ? `${m.toLocation.warehouse.code}/${m.toLocation.code}` : '-'}
                                </td>
                                <td className="px-3 py-2">
                                  {m.referenceType ? `${m.referenceType}${m.referenceId ? `:${m.referenceId}` : ''}` : '-'}
                                </td>
                              </tr>
                                )
                              })()
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-md border border-slate-200 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium text-slate-800">Vencimientos</div>
                  <button
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    onClick={() => expirySummaryQuery.refetch()}
                    disabled={expirySummaryQuery.isFetching}
                  >
                    Refresh
                  </button>
                </div>

                <div className="grid gap-2 md:grid-cols-4">
                  <select
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    value={expiryWarehouseId}
                    onChange={(e) => setExpiryWarehouseId(e.target.value)}
                    disabled={warehousesQuery.isLoading || warehousesQuery.isError}
                    title="warehouse"
                  >
                    <option value="">Todos los warehouses</option>
                    {(warehousesQuery.data?.items ?? []).map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code} · {w.name}
                      </option>
                    ))}
                  </select>

                  <select
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    value={expiryStatus}
                    onChange={(e) => setExpiryStatus(e.target.value as any)}
                    title="status"
                  >
                    <option value="ALL">Todos los estados</option>
                    <option value="EXPIRED">EXPIRED</option>
                    <option value="RED">RED</option>
                    <option value="YELLOW">YELLOW</option>
                    <option value="GREEN">GREEN</option>
                  </select>

                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-slate-600">Take</label>
                    <input
                      className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm"
                      type="number"
                      min={1}
                      max={200}
                      value={expiryTake}
                      onChange={(e) => setExpiryTake(Number(e.target.value || 100))}
                    />
                  </div>

                  <div className="text-xs text-slate-600">
                    {expirySummaryQuery.data?.generatedAt ? `Generado: ${new Date(expirySummaryQuery.data.generatedAt).toLocaleString()}` : ''}
                  </div>
                </div>

                {warehousesQuery.isError && <div className="mt-2 text-sm text-red-700">Error cargando warehouses</div>}
                {expirySummaryQuery.isLoading && <div className="mt-2 text-sm text-slate-600">Cargando…</div>}
                {expirySummaryQuery.isError && <div className="mt-2 text-sm text-red-700">Error cargando vencimientos</div>}

                {expirySummaryQuery.data && (
                  <div className="mt-2 max-h-96 overflow-auto rounded-md border border-slate-200">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs text-slate-600">
                        <tr>
                          <th className="px-3 py-2">Estado</th>
                          <th className="px-3 py-2">SKU</th>
                          <th className="px-3 py-2">Producto</th>
                          <th className="px-3 py-2">Lote</th>
                          <th className="px-3 py-2">Vence</th>
                          <th className="px-3 py-2">Días</th>
                          <th className="px-3 py-2">Qty</th>
                          <th className="px-3 py-2">Ubicación</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {expirySummaryQuery.data.items.length === 0 ? (
                          <tr>
                            <td className="px-3 py-3 text-slate-600" colSpan={8}>
                              Sin datos
                            </td>
                          </tr>
                        ) : (
                          [...expirySummaryQuery.data.items]
                            .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
                            .map((x) => (
                              <tr key={x.balanceId}>
                                <td className="px-3 py-2">{expiryBadge(x.status)}</td>
                                <td className="px-3 py-2 font-medium text-slate-800">{x.sku}</td>
                                <td className="px-3 py-2">{x.name}</td>
                                <td className="px-3 py-2">{x.batchNumber}</td>
                                <td className="px-3 py-2">{new Date(x.expiresAt).toLocaleDateString()}</td>
                                <td className="px-3 py-2">{x.daysToExpire}</td>
                                <td className="px-3 py-2">{x.quantity}</td>
                                <td className="px-3 py-2">
                                  <div className="text-xs text-slate-600">{x.warehouseCode}</div>
                                  <div className="text-xs text-slate-600">{x.locationCode}</div>
                                </td>
                              </tr>
                            ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {token && adminTab === 'tenants' && (
            <div className="space-y-4">
              <div className="text-sm font-medium text-slate-700">Provisioning de tenants (plataforma)</div>

              {platformTenantsQuery.isError && (
                <div className="text-sm text-slate-600">
                  {((platformTenantsQuery.error as any)?.status === 403)
                    ? 'No tienes permiso para gestionar tenants (platform:tenants:manage).'
                    : 'Error cargando tenants.'}
                </div>
              )}

              <div className="grid gap-3 rounded-md border border-slate-200 p-4">
                <div className="text-sm font-medium text-slate-700">Nuevo tenant</div>
                <label className="text-sm text-slate-700">
                  <div className="mb-1 text-xs text-slate-600">Nombre</div>
                  <input
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    value={platformTenantName}
                    onChange={(e) => setPlatformTenantName(e.target.value)}
                    placeholder="Febsa"
                  />
                </label>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm text-slate-700">
                    <div className="mb-1 text-xs text-slate-600">Sucursales (branchLimit)</div>
                    <input
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      type="number"
                      min={1}
                      max={50}
                      value={platformTenantBranchCount}
                      onChange={(e) => setPlatformTenantBranchCount(Number(e.target.value || '1'))}
                    />
                  </label>
                  <label className="text-sm text-slate-700">
                    <div className="mb-1 text-xs text-slate-600">Dominio primario (opcional)</div>
                    <input
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      value={platformTenantPrimaryDomain}
                      onChange={(e) => setPlatformTenantPrimaryDomain(e.target.value)}
                      placeholder="farmacia.febsa.com"
                    />
                  </label>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm text-slate-700">
                    <div className="mb-1 text-xs text-slate-600">Email admin inicial</div>
                    <input
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      value={platformTenantAdminEmail}
                      onChange={(e) => setPlatformTenantAdminEmail(e.target.value)}
                      placeholder="admin@febsa.com"
                    />
                  </label>
                  <label className="text-sm text-slate-700">
                    <div className="mb-1 text-xs text-slate-600">Password admin</div>
                    <input
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      type="password"
                      value={platformTenantAdminPassword}
                      onChange={(e) => setPlatformTenantAdminPassword(e.target.value)}
                      placeholder="Min. 6 chars"
                    />
                  </label>
                </div>

                <div className="flex justify-end">
                  <button
                    className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white"
                    onClick={() => createPlatformTenantMutation.mutate()}
                    disabled={createPlatformTenantMutation.isPending}
                    type="button"
                  >
                    {createPlatformTenantMutation.isPending ? 'Creando…' : 'Crear tenant'}
                  </button>
                </div>
              </div>

              <div className="rounded-md border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-200 p-3">
                  <div className="text-sm font-medium text-slate-700">Tenants</div>
                  <button
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    onClick={() => platformTenantsQuery.refetch()}
                    disabled={platformTenantsQuery.isFetching}
                    type="button"
                  >
                    Refresh
                  </button>
                </div>
                {platformTenantsQuery.isLoading && <div className="p-3 text-sm text-slate-600">Cargando…</div>}
                {platformTenantsQuery.data && (
                  <ul className="divide-y divide-slate-200">
                    {platformTenantsQuery.data.pages.flatMap((p) => p.items).map((t) => (
                      <li key={t.id} className="p-3">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium text-slate-800">{t.name}</div>
                          <div className="text-xs text-slate-600">Sucursales: {t.branchLimit}</div>
                        </div>
                        <div className="mt-1 text-xs text-slate-600">
                          {t.domains?.length ? `Dominios: ${t.domains.map((d) => d.domain).join(', ')}` : 'Dominios: -'}
                        </div>

                        <div className="mt-2">
                          <button
                            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs"
                            type="button"
                            onClick={() => {
                              setPlatformLastVerification(null)
                              setPlatformSelectedTenantId((prev) => (prev === t.id ? null : t.id))
                            }}
                          >
                            {platformSelectedTenantId === t.id ? 'Ocultar dominios' : 'Gestionar dominios'}
                          </button>
                        </div>

                        {platformSelectedTenantId === t.id && (
                          <div className="mt-3 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                            <div className="text-xs font-medium text-slate-700">Dominios del tenant</div>

                            {platformTenantDomainsQuery.isLoading && (
                              <div className="text-xs text-slate-600">Cargando dominios…</div>
                            )}

                            {platformTenantDomainsQuery.isError && (
                              <div className="text-xs text-slate-600">Error cargando dominios.</div>
                            )}

                            {platformTenantDomainsQuery.data && (
                              <div className="overflow-auto">
                                <table className="min-w-full text-left text-xs">
                                  <thead className="border-b border-slate-200 text-slate-600">
                                    <tr>
                                      <th className="px-2 py-2">Dominio</th>
                                      <th className="px-2 py-2">Primario</th>
                                      <th className="px-2 py-2">Estado</th>
                                      <th className="px-2 py-2">Acciones</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-200">
                                    {platformTenantDomainsQuery.data.items.length === 0 ? (
                                      <tr>
                                        <td className="px-2 py-2 text-slate-600" colSpan={4}>
                                          Sin dominios registrados
                                        </td>
                                      </tr>
                                    ) : (
                                      platformTenantDomainsQuery.data.items.map((d: PlatformTenantDomainListItem) => (
                                        <tr key={d.id}>
                                          <td className="px-2 py-2 font-medium text-slate-800">{d.domain}</td>
                                          <td className="px-2 py-2">{d.isPrimary ? 'Sí' : 'No'}</td>
                                          <td className="px-2 py-2">
                                            {d.verifiedAt ? (
                                              <span className="text-emerald-700">Verificado</span>
                                            ) : (
                                              <span className="text-amber-700">Pendiente</span>
                                            )}
                                          </td>
                                          <td className="px-2 py-2">
                                            {!d.verifiedAt && (
                                              <button
                                                className="rounded-md border border-slate-300 bg-white px-2 py-1"
                                                type="button"
                                                onClick={() => verifyPlatformTenantDomainMutation.mutate(d.domain)}
                                                disabled={verifyPlatformTenantDomainMutation.isPending}
                                              >
                                                {verifyPlatformTenantDomainMutation.isPending ? 'Verificando…' : 'Verificar'}
                                              </button>
                                            )}
                                          </td>
                                        </tr>
                                      ))
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            <div className="grid gap-2 rounded-md border border-slate-200 bg-white p-3">
                              <div className="text-xs font-medium text-slate-700">Agregar dominio</div>
                              <div className="grid gap-2 md:grid-cols-3">
                                <label className="md:col-span-2">
                                  <div className="mb-1 text-[11px] text-slate-600">Dominio</div>
                                  <input
                                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                    value={platformDomainInput}
                                    onChange={(e) => setPlatformDomainInput(e.target.value)}
                                    placeholder="farmacia.febsa.com"
                                  />
                                </label>
                                <label>
                                  <div className="mb-1 text-[11px] text-slate-600">Primario</div>
                                  <select
                                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                    value={platformDomainIsPrimary ? 'yes' : 'no'}
                                    onChange={(e) => setPlatformDomainIsPrimary(e.target.value === 'yes')}
                                  >
                                    <option value="yes">Sí</option>
                                    <option value="no">No</option>
                                  </select>
                                </label>
                              </div>
                              <div className="flex justify-end">
                                <button
                                  className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white"
                                  type="button"
                                  onClick={() => createPlatformTenantDomainMutation.mutate()}
                                  disabled={createPlatformTenantDomainMutation.isPending}
                                >
                                  {createPlatformTenantDomainMutation.isPending ? 'Guardando…' : 'Registrar dominio'}
                                </button>
                              </div>

                              {platformLastVerification && platformLastVerification.tenantId === t.id && (
                                <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                                  <div className="font-medium">Token de verificación</div>
                                  <div className="mt-1 break-all">Dominio: {platformLastVerification.domain}</div>
                                  <div className="mt-1 break-all">URL: {platformLastVerification.url}</div>
                                  <div className="mt-1 break-all">Token: {platformLastVerification.token}</div>
                                  <div className="mt-1 text-slate-600">Expira: {new Date(platformLastVerification.expiresAt).toLocaleString()}</div>
                                </div>
                              )}

                              <div className="text-[11px] text-slate-600">
                                Para verificar: el dominio debe apuntar a este despliegue y el backend debe poder leer el token en
                                <span className="font-medium"> /.well-known/pharmaflow-domain-verification</span>.
                              </div>
                            </div>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {platformTenantsQuery.hasNextPage && (
                  <div className="p-3">
                    <button
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                      onClick={() => platformTenantsQuery.fetchNextPage()}
                      disabled={platformTenantsQuery.isFetchingNextPage}
                      type="button"
                    >
                      {platformTenantsQuery.isFetchingNextPage ? 'Cargando…' : 'Más'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        ) : null}
      </main>
    </div>
  )
}

export default App
