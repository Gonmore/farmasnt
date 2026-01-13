import type { NavGroup } from '../components/layout';
import { usePermissions } from './usePermissions';

export function useNavigation(): NavGroup[] {
  const { isPlatformAdmin, hasPermission, isLoading } = usePermissions();

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
    groups.push({
      title: '📦 Catálogo',
      items: [
        { to: '/catalog/products', label: '🏷️ Productos' },
        { to: '/catalog/commercial', label: '🛒 Comercial' },
        ...(hasPermission('sales:order:write') ? [{ to: '/catalog/seller', label: '🧑‍💼 Vendedor' }] : []),
      ],
    });
  }

  // Almacén
  if (hasPermission('stock:read')) {
    groups.push({
      title: '🏢 Almacén',
      items: [
        { to: '/stock/inventory', label: '📊 Inventario' },
        { to: '/warehouse/warehouses', label: '🏬 Sucursales' },
        { to: '/stock/movements', label: '🚚 Movimientos' },
        { to: '/stock/expiry', label: '⏰ Vencimientos' },
      ],
    });
  }

  // Ventas
  if (hasPermission('sales:order:read')) {
    groups.push({
      title: '💰 Ventas',
      items: [
        { to: '/sales/customers', label: '👥 Clientes' },
        { to: '/sales/quotes', label: '📝 Cotizaciones' },
        { to: '/sales/orders', label: '📋 Órdenes' },
      ],
    });
  }

  // Reportes (todos pueden ver)
  groups.push({
    title: '📈 Reportes',
    items: [
      { to: '/reports/sales', label: '💵 Ventas' },
      { to: '/reports/stock', label: '📦 Stock' },
    ],
  });

  // Sistema (admin)
  const systemItems = [];
  
  if (hasPermission('audit:read')) {
    systemItems.push({ to: '/audit/events', label: '📜 Auditoría' });
  }
  
  if (hasPermission('admin:users:manage')) {
    systemItems.push({ to: '/admin/users', label: '👤 Usuarios' });
    systemItems.push({ to: '/admin/roles', label: '🔐 Roles' });
  }
  
  // Branding siempre disponible para Tenant users (no Platform Admin)
  if (!isPlatformAdmin) {
    systemItems.push({ to: '/admin/branding', label: '🎨 Branding' });
    
    // Siempre agregar grupo Sistema para Tenant users
    groups.push({
      title: '⚙️ Sistema',
      items: systemItems,
    });
  } else if (systemItems.length > 0) {
    // Platform Admin solo ve Sistema si tiene otros permisos
    groups.push({
      title: '⚙️ Sistema',
      items: systemItems,
    });
  }

  return groups;
}

