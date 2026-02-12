import type { NavGroup } from '../components/layout';
import { usePermissions } from './usePermissions';

export function useNavigation(): NavGroup[] {
  const { isPlatformAdmin, isTenantAdmin, roles, hasPermission, isLoading } = usePermissions();
  const isLogistica = roles.some((r) => r.code === 'LOGISTICA')
  const isBranchAdmin = roles.some((r) => r.code === 'BRANCH_ADMIN')

  // Mientras carga, mostrar navegación mínima
  if (isLoading) {
    return [
      {
        title: 'General',
        items: [{ to: '/', label: 'Estado' }],
      },
    ];
  }

  const groups: NavGroup[] = [];

  // Dashboard (todos)
  groups.push({
    title: 'General',
    items: [{ to: '/', label: 'Estado' }],
  });

  // Platform Admin: solo gestión de tenants
  if (isPlatformAdmin) {
    groups.push({
      title: '🌐 Plataforma',
      items: [
        { to: '/platform/tenants', label: '🏢 Tenants' },
        { to: '/platform/contact', label: '📞 Configuración Contacto' },
      ],
    });
    return groups; // Platform Admin no ve módulos de tenant
  }

  // Tenant Admin y usuarios: navegación funcional

  // Catálogo
  if (hasPermission('catalog:read')) {
    const catalogItems = [] as Array<{ to: string; label: string }>

    // Productos + Comercial: solo admin (evitar que Ventas vea estos menús)
    if (isTenantAdmin || hasPermission('catalog:write')) {
      catalogItems.push({ to: '/catalog/products', label: '🏷️ Productos' })
      catalogItems.push({ to: '/catalog/commercial', label: '🛒 Comercial' })
    }

    // Vendedor: usuarios de ventas (requiere write de órdenes)
    if (hasPermission('sales:order:write')) {
      catalogItems.push({ to: '/catalog/seller', label: '🧑‍💼 Vendedor' })
    }

    if (catalogItems.length === 0) {
      // No mostrar grupo vacío
    } else {
    groups.push({
      title: '📦 Catálogo',
      items: catalogItems,
    });
    }
  }

  // Almacén
  if (hasPermission('stock:read')) {
    const warehouseItems = [{ to: '/stock/inventory', label: '📊 Inventario' }]

    // Sucursales: Logística + admin
    if (isTenantAdmin || isLogistica) {
      warehouseItems.push({ to: '/warehouse/warehouses', label: '🏬 Sucursales' })
    }

    // Movimientos: tenant admin + stock manage + admin de sucursal
    if (isTenantAdmin || hasPermission('stock:manage') || isBranchAdmin) {
      warehouseItems.push({ to: '/stock/movements', label: '🚚 Movimientos' })
    }

    // Vencimientos: lectura para ambos roles
    warehouseItems.push({ to: '/stock/expiry', label: '⏰ Vencimientos' })

    groups.push({
      title: '🏢 Almacén',
      items: warehouseItems,
    });
  }

  // Laboratorio (MVP: reutiliza permisos de stock)
  if (hasPermission('stock:read')) {
    const labItems = [] as Array<{ to: string; label: string }>
    labItems.push({ to: '/laboratory/labs', label: '🧪 Configuración' })
    labItems.push({ to: '/laboratory/production', label: '🏭 Producción' })
    labItems.push({ to: '/laboratory/maintenance-supplies', label: '🧫 Repuestos y materiales' })
    labItems.push({ to: '/laboratory/receipts', label: '📥 Recepciones' })
    labItems.push({ to: '/laboratory/wip', label: '🧪 Producto en proceso' })
    labItems.push({ to: '/laboratory/production-runs', label: '🏭 Corridas' })
    labItems.push({ to: '/laboratory/qc', label: '✅ QC (Cuarentena)' })

    groups.push({
      title: '🧪 Laboratorio',
      items: labItems,
    })
  }

  // Ventas
  if (hasPermission('sales:order:read') || hasPermission('sales:delivery:read')) {
    const salesItems = [] as Array<{ to: string; label: string }>

    if (hasPermission('sales:order:read')) {
      salesItems.push({ to: '/sales/customers', label: '👥 Clientes' })
      // Cotizaciones: solo ventas (write)
      if (hasPermission('sales:order:write')) {
        salesItems.push({ to: '/sales/quotes', label: '📝 Cotizaciones' })
      }
      salesItems.push({ to: '/sales/orders', label: '📋 Órdenes' })
    }

    if (hasPermission('sales:delivery:read')) {
      salesItems.push({ to: '/sales/deliveries', label: '🚚 Entregas' })
    }

    if (hasPermission('sales:order:read')) {
      salesItems.push({ to: '/sales/payments', label: '💳 Pagos' })
    }

    groups.push({
      title: '💰 Ventas',
      items: salesItems,
    });
  }

  // Reportes (según permisos)
  const reportItems = [] as Array<{ to: string; label: string }>
  if (hasPermission('report:sales:read')) reportItems.push({ to: '/reports/sales', label: '💵 Ventas' })
  if (hasPermission('report:stock:read')) reportItems.push({ to: '/reports/stock', label: '📦 Stock' })
  if (reportItems.length > 0) {
    groups.push({ title: '📈 Reportes', items: reportItems })
  }

  // Sistema (solo Tenant Admin)
  if (isTenantAdmin) {
    const systemItems = [] as Array<{ to: string; label: string }>
    if (hasPermission('audit:read')) systemItems.push({ to: '/audit/events', label: '📜 Auditoría' })
    if (hasPermission('admin:users:manage')) {
      systemItems.push({ to: '/admin/users', label: '👤 Usuarios' })
      systemItems.push({ to: '/admin/roles', label: '🔐 Roles' })
      systemItems.push({ to: '/admin/branding', label: '🎨 Branding' })
    }
    if (systemItems.length > 0) {
      groups.push({ title: '⚙️ Sistema', items: systemItems })
    }
  }

  return groups;
}

