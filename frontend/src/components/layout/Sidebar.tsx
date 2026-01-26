import { NavLink, useLocation } from 'react-router-dom'
import { useEffect, useRef } from 'react'

export interface NavItem {
  to: string
  label: string
  icon?: React.ReactNode
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

interface SidebarProps {
  groups: NavGroup[]
  isOpen: boolean
  isMobile: boolean
  onClose: () => void
}

export function Sidebar({ groups, isOpen, isMobile, onClose }: SidebarProps) {
  const location = useLocation()
  const navRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const activeLink = navRef.current?.querySelector('.sidebar-active')
    if (activeLink) {
      activeLink.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [location.pathname])

  return (
    <>
      {/* Mobile overlay */}
      {isMobile && isOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black bg-opacity-50 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        ${isMobile ? 'fixed left-0 top-16 z-50' : 'relative'}
        ${isMobile && !isOpen ? '-translate-x-full' : 'translate-x-0'}
        w-64 border-r border-slate-200 bg-white transition-transform duration-300 ease-in-out dark:border-slate-700 dark:bg-slate-900
        ${isMobile ? 'h-[calc(100vh-4rem)]' : 'h-full'}
      `}>
        <nav ref={navRef} className="h-full space-y-6 overflow-y-auto p-4">
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
                    onClick={isMobile ? onClose : undefined}
                    className={({ isActive }) =>
                      `flex items-center gap-2 rounded px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'sidebar-active bg-slate-100 text-slate-900 dark:bg-[var(--pf-primary)] dark:text-white'
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
    </>
  )
}
