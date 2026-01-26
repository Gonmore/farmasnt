export const Permissions = {
  CatalogRead: 'catalog:read',
  CatalogWrite: 'catalog:write',
  StockRead: 'stock:read',
  StockManage: 'stock:manage',
  StockMove: 'stock:move',
  SalesOrderRead: 'sales:order:read',
  SalesOrderWrite: 'sales:order:write',
  SalesDeliveryRead: 'sales:delivery:read',
  SalesDeliveryWrite: 'sales:delivery:write',
  ReportSalesRead: 'report:sales:read',
  ReportStockRead: 'report:stock:read',
  AdminUsersManage: 'admin:users:manage',
  AuditRead: 'audit:read',
  PlatformTenantsManage: 'platform:tenants:manage',
} as const

export type PermissionCode = (typeof Permissions)[keyof typeof Permissions]
