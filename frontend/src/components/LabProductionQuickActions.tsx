import { Link } from 'react-router-dom'

function QuickActionCard(props: { to: string; title: string; subtitle: string; icon: string; isActive?: boolean }) {
  return (
    <Link
      to={props.to}
      className={`group rounded-lg border p-4 transition ${
        props.isActive
          ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/20'
          : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-blue-600 dark:hover:bg-slate-800'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="text-2xl">{props.icon}</div>
        <div className="min-w-0">
          <div className={`font-semibold transition ${
            props.isActive
              ? 'text-blue-900 dark:text-blue-200'
              : 'text-slate-900 group-hover:text-blue-900 dark:text-slate-100 dark:group-hover:text-blue-200'
          }`}>
            {props.title}
          </div>
          <div className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{props.subtitle}</div>
        </div>
      </div>
    </Link>
  )
}

export function LabProductionQuickActions({ currentPath }: { currentPath: string }) {
  return (
    <div className="mb-6">
      <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Accesos rápidos</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <QuickActionCard
          to="/laboratory/recipes"
          icon="📘"
          title="Recetas"
          subtitle="Fórmulas y procesos de producción"
          isActive={currentPath === '/laboratory/recipes'}
        />
        <QuickActionCard
          to="/laboratory/production-requests"
          icon="🧩"
          title="Plan de produc"
          subtitle="Programación y planificación de lotes"
          isActive={currentPath === '/laboratory/production-requests'}
        />
        <QuickActionCard
          to="/laboratory/supplies"
          icon="🧫"
          title="Materia prima"
          subtitle="Insumos y materiales para producción"
          isActive={currentPath === '/laboratory/supplies'}
        />
        <QuickActionCard
          to="/laboratory/purchase-lists"
          icon="🧾"
          title="Listas de compra"
          subtitle="Compras y adquisiciones pendientes"
          isActive={currentPath === '/laboratory/purchase-lists'}
        />
      </div>
    </div>
  )
}