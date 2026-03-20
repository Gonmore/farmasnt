import { NavLink, useLocation } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'

export type SidebarViewMode = 'grouped' | 'classic'

const AUTO_COLLAPSE_DELAY_MS = 5000

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
  isCollapsed: boolean
  viewMode: SidebarViewMode
  onToggleCollapse: () => void
  onViewModeChange: (mode: SidebarViewMode) => void
  onClose: () => void
}

function cleanNavLabel(label: string) {
  const [prefix, ...rest] = label.trim().split(/\s+/)

  if (rest.length === 0) {
    return label
  }

  const looksLikeIcon = prefix.length <= 3 || /[^\p{L}\p{N}]/u.test(prefix)
  return looksLikeIcon ? rest.join(' ') : label
}

function SidebarLineIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <SidebarLineIcon>
      <path d="M4 5.5h16" />
      <path d="M4 18.5h16" />
      <path d={collapsed ? 'M15 9 19 12l-4 3' : 'M9 9 5 12l4 3'} />
      <path d={collapsed ? 'M9 7v10' : 'M15 7v10'} />
    </SidebarLineIcon>
  )
}

function GroupedIcon() {
  return (
    <SidebarLineIcon>
      <rect x="4" y="5" width="7" height="6" rx="1.5" />
      <rect x="13" y="5" width="7" height="6" rx="1.5" />
      <rect x="4" y="13" width="16" height="6" rx="1.5" />
    </SidebarLineIcon>
  )
}

function ClassicIcon() {
  return (
    <SidebarLineIcon>
      <path d="M7 7.5h11" />
      <path d="M7 12h11" />
      <path d="M7 16.5h11" />
      <circle cx="4.5" cy="7.5" r=".8" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r=".8" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="16.5" r=".8" fill="currentColor" stroke="none" />
    </SidebarLineIcon>
  )
}

function getGroupIcon(title: string) {
  switch (title) {
    case 'Estado':
      return (
        <SidebarLineIcon>
          <path d="M4 19h16" />
          <path d="M7 15V9" />
          <path d="M12 15V5" />
          <path d="M17 15v-3" />
        </SidebarLineIcon>
      )
    case 'Catalogo':
      return (
        <SidebarLineIcon>
          <path d="M6 5.5h9a3 3 0 0 1 3 3V19H9a3 3 0 0 0-3 3z" />
          <path d="M6 5.5v16.5" />
          <path d="M9 8h6" />
          <path d="M9 11h6" />
        </SidebarLineIcon>
      )
    case 'Almacen':
      return (
        <SidebarLineIcon>
          <path d="M3 9.5 12 4l9 5.5" />
          <path d="M5 10.5V20h14v-9.5" />
          <path d="M9 20v-5h6v5" />
        </SidebarLineIcon>
      )
    case 'Laboratorio':
      return (
        <SidebarLineIcon>
          <path d="M10 3v5l-5.5 9.5A2.5 2.5 0 0 0 6.7 21h10.6a2.5 2.5 0 0 0 2.2-3.5L14 8V3" />
          <path d="M8 13h8" />
        </SidebarLineIcon>
      )
    case 'Ventas':
      return (
        <SidebarLineIcon>
          <path d="M4 17.5h16" />
          <path d="M6.5 14 10 10.5l3 3 4.5-6" />
          <path d="M15.5 7.5H17.5V9.5" />
        </SidebarLineIcon>
      )
    case 'Reportes':
      return (
        <SidebarLineIcon>
          <rect x="4" y="4" width="16" height="16" rx="2.5" />
          <path d="M8 15V11" />
          <path d="M12 15V8" />
          <path d="M16 15v-2" />
        </SidebarLineIcon>
      )
    case 'Sistema':
      return (
        <SidebarLineIcon>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1 1 0 0 1 0 1.4l-1.1 1.1a1 1 0 0 1-1.4 0l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a1 1 0 0 1-1 1h-1.8a1 1 0 0 1-1-1v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a1 1 0 0 1-1.4 0l-1.1-1.1a1 1 0 0 1 0-1.4l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a1 1 0 0 1-1-1v-1.8a1 1 0 0 1 1-1h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a1 1 0 0 1 0-1.4l1.1-1.1a1 1 0 0 1 1.4 0l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4a1 1 0 0 1 1-1h1.8a1 1 0 0 1 1 1v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a1 1 0 0 1 1.4 0l1.1 1.1a1 1 0 0 1 0 1.4l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6h.2a1 1 0 0 1 1 1v1.8a1 1 0 0 1-1 1h-.2a1 1 0 0 0-.9.6Z" />
        </SidebarLineIcon>
      )
    default:
      return (
        <SidebarLineIcon>
          <circle cx="12" cy="12" r="7" />
          <path d="M12 8v4l2.5 2.5" />
        </SidebarLineIcon>
      )
  }
}

function SidebarControlButton({
  label,
  icon,
  isActive,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  isActive?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-colors ${
        isActive
          ? 'border-[var(--pf-primary)]/30 bg-[var(--pf-primary)]/12 text-[var(--pf-primary)] dark:bg-[var(--pf-primary)]/20 dark:text-white'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
      }`}
    >
      {icon}
    </button>
  )
}

export function Sidebar({
  groups,
  isOpen,
  isMobile,
  isCollapsed,
  viewMode,
  onToggleCollapse,
  onViewModeChange,
  onClose,
}: SidebarProps) {
  const location = useLocation()
  const navRef = useRef<HTMLElement>(null)
  const autoCollapseTimeoutRef = useRef<number | null>(null)
  const collapsed = !isMobile && isCollapsed
  const activeGroupTitles = useMemo(
    () => new Set(groups.filter((group) => group.items.some((item) => item.to === location.pathname)).map((group) => group.title)),
    [groups, location.pathname],
  )
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [pendingAutoCollapse, setPendingAutoCollapse] = useState(false)
  const [pendingExpandGroup, setPendingExpandGroup] = useState<string | null>(null)

  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev }
      for (const group of groups) {
        if (!(group.title in next)) {
          next[group.title] = activeGroupTitles.has(group.title) || group.title === 'Estado'
        }
      }
      for (const title of Object.keys(next)) {
        if (!groups.some((group) => group.title === title)) delete next[title]
      }
      for (const title of activeGroupTitles) {
        next[title] = true
      }
      return next
    })
  }, [groups, activeGroupTitles])

  useEffect(() => {
    const activeLink = navRef.current?.querySelector('.sidebar-active')
    if (activeLink) {
      activeLink.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [location.pathname])

  useEffect(() => {
    return () => {
      if (autoCollapseTimeoutRef.current !== null) {
        window.clearTimeout(autoCollapseTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (collapsed || !pendingAutoCollapse) {
      if (autoCollapseTimeoutRef.current !== null) {
        window.clearTimeout(autoCollapseTimeoutRef.current)
        autoCollapseTimeoutRef.current = null
      }
      return
    }

    if (pendingExpandGroup) {
      setOpenGroups((prev) => ({ ...prev, [pendingExpandGroup]: true }))
      setPendingExpandGroup(null)
    }

    autoCollapseTimeoutRef.current = window.setTimeout(() => {
      onToggleCollapse()
      setPendingAutoCollapse(false)
    }, AUTO_COLLAPSE_DELAY_MS)

    return () => {
      if (autoCollapseTimeoutRef.current !== null) {
        window.clearTimeout(autoCollapseTimeoutRef.current)
        autoCollapseTimeoutRef.current = null
      }
    }
  }, [collapsed, onToggleCollapse, pendingAutoCollapse, pendingExpandGroup])

  const handleCollapsedGroupClick = (groupTitle: string) => {
    setPendingExpandGroup(groupTitle)
    setPendingAutoCollapse(true)
    onToggleCollapse()
  }

  const renderNavItem = (item: NavItem) => {
    const text = cleanNavLabel(item.label)

    return (
      <NavLink
        key={item.to}
        to={item.to}
        title={text}
        onClick={isMobile ? onClose : undefined}
        className={({ isActive }) =>
          `flex items-center rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
            isActive
              ? 'sidebar-active bg-white text-slate-950 ring-1 ring-[var(--pf-primary)]/20 dark:bg-[var(--pf-primary)] dark:text-white dark:ring-0'
              : 'text-slate-700 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-900'
          }`
        }
      >
        <span className="truncate">{text}</span>
      </NavLink>
    )
  }

  return (
    <>
      {isMobile && isOpen && (
        <div className="fixed inset-0 z-40 bg-black bg-opacity-50 md:hidden" onClick={onClose} />
      )}

      <aside
        className={`
        ${isMobile ? 'fixed left-0 top-16 z-50' : 'relative'}
        ${isMobile && !isOpen ? '-translate-x-full' : 'translate-x-0'}
        ${collapsed ? 'w-20' : 'w-72'} border-r border-slate-200 bg-white transition-all duration-300 ease-in-out dark:border-slate-700 dark:bg-slate-900
        ${isMobile ? 'h-[calc(100vh-4rem)]' : 'h-full'}
      `}
      >
        <nav ref={navRef} className="h-full space-y-3 overflow-y-auto p-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-2 shadow-sm dark:border-slate-800 dark:bg-slate-950/40">
            <div className={`flex ${collapsed ? 'flex-col gap-2' : 'items-center justify-center gap-2'}`}>
              <SidebarControlButton
                label={collapsed ? 'Expandir menu' : 'Replegar menu'}
                icon={<CollapseIcon collapsed={collapsed} />}
                onClick={onToggleCollapse}
              />
              <SidebarControlButton
                label="Menu agrupado"
                icon={<GroupedIcon />}
                isActive={viewMode === 'grouped'}
                onClick={() => onViewModeChange('grouped')}
              />
              <SidebarControlButton
                label="Menu clasico"
                icon={<ClassicIcon />}
                isActive={viewMode === 'classic'}
                onClick={() => onViewModeChange('classic')}
              />
            </div>
          </div>

          {collapsed && (
            <div className="space-y-3">
              {groups.map((group) => {
                const isActiveGroup = activeGroupTitles.has(group.title)

                return (
                  <button
                    key={group.title}
                    type="button"
                    title={group.title}
                    aria-label={group.title}
                    onClick={() => handleCollapsedGroupClick(group.title)}
                    className={`flex w-full items-center justify-center rounded-2xl border-2 p-3 shadow-sm transition-colors ${
                      isActiveGroup
                        ? 'border-[var(--pf-primary)]/35 bg-[var(--pf-primary)]/12 text-[var(--pf-primary)] dark:bg-[var(--pf-primary)]/20 dark:text-white'
                        : 'border-slate-300 bg-slate-50/80 text-slate-700 hover:bg-white dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-200 dark:hover:bg-slate-900'
                    }`}
                  >
                    {getGroupIcon(group.title)}
                  </button>
                )
              })}
            </div>
          )}

          {!collapsed &&
            (viewMode === 'grouped'
              ? groups.map((group) => {
                  const isActiveGroup = activeGroupTitles.has(group.title)
                  const isOpenGroup = openGroups[group.title] ?? false

                  return (
                    <div key={group.title} className="rounded-2xl border-2 border-slate-300 bg-slate-50/80 p-2 shadow-sm dark:border-slate-700 dark:bg-slate-950/40">
                      <button
                        type="button"
                        onClick={() => setOpenGroups((prev) => ({ ...prev, [group.title]: !isOpenGroup }))}
                        className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left transition-colors ${
                          isActiveGroup
                            ? 'bg-[var(--pf-primary)]/12 text-[var(--pf-primary)] dark:bg-[var(--pf-primary)]/20 dark:text-white'
                            : 'text-slate-800 hover:bg-white dark:text-slate-100 dark:hover:bg-slate-900'
                        }`}
                        aria-expanded={isOpenGroup}
                        aria-controls={`sidebar-group-${group.title}`}
                        title={group.title}
                      >
                        <div>
                          <div className="flex items-center gap-2 text-sm font-semibold tracking-wide">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                              {getGroupIcon(group.title)}
                            </span>
                            <span>{group.title}</span>
                          </div>
                          <div className={`pl-10 text-xs ${isActiveGroup ? 'text-[var(--pf-primary)]/80 dark:text-slate-200' : 'text-slate-500 dark:text-slate-400'}`}>
                            {group.items.length} vistas disponibles
                          </div>
                        </div>
                        <span
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition-transform ${
                            isActiveGroup
                              ? 'border-[var(--pf-primary)]/30 bg-white/70 dark:border-white/20 dark:bg-white/10'
                              : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                          } ${isOpenGroup ? 'rotate-180' : 'rotate-0'}`}
                        >
                          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 7.5 10 12.5 15 7.5" />
                          </svg>
                        </span>
                      </button>

                      <div id={`sidebar-group-${group.title}`} className={`${isOpenGroup ? 'mt-2 block' : 'hidden'}`}>
                        <div className="space-y-1 px-1 pb-1">{group.items.map(renderNavItem)}</div>
                      </div>
                    </div>
                  )
                })
              : groups.map((group) => (
                  <div key={group.title} className="rounded-2xl border-2 border-slate-300 bg-slate-50/80 p-2 shadow-sm dark:border-slate-700 dark:bg-slate-950/40">
                    <div className="flex items-center gap-2 px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                        {getGroupIcon(group.title)}
                      </span>
                      <span>{group.title}</span>
                    </div>
                    <div className="space-y-1 px-1 pb-1">{group.items.map(renderNavItem)}</div>
                  </div>
                )))}
        </nav>
      </aside>
    </>
  )
}
