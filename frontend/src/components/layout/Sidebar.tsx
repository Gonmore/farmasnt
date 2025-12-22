import { NavLink } from 'react-router-dom'

export interface NavItem {
  to: string
  label: string
  icon?: React.ReactNode
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

export function Sidebar({ groups }: { groups: NavGroup[] }) {
  return (
    <aside className="w-64 border-r border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <nav className="h-full space-y-6 overflow-y-auto p-4">
        {groups.map((group) => (
          <div key={group.title}>
            <h3 className="mb-2 px-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
              {group.title}
            </h3>
            <div className="space-y-1">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-[var(--pf-primary)] text-white'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`
                  }
                >
                  {item.icon}
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  )
}
