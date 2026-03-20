import type { ReactNode } from 'react'
import { useState, useEffect } from 'react'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { Footer } from './Footer'
import type { NavGroup, SidebarViewMode } from './Sidebar'

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'pf-sidebar-collapsed'
const SIDEBAR_VIEW_MODE_STORAGE_KEY = 'pf-sidebar-view-mode'

export interface MainLayoutProps {
  children: ReactNode
  navGroups?: NavGroup[]
}

export function MainLayout({ children, navGroups }: MainLayoutProps) {
  const groups = navGroups ?? []
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [sidebarViewMode, setSidebarViewMode] = useState<SidebarViewMode>('grouped')

  useEffect(() => {
    if (typeof window === 'undefined') return

    setIsSidebarCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true')

    const storedViewMode = window.localStorage.getItem(SIDEBAR_VIEW_MODE_STORAGE_KEY)
    if (storedViewMode === 'grouped' || storedViewMode === 'classic') {
      setSidebarViewMode(storedViewMode)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(isSidebarCollapsed))
  }, [isSidebarCollapsed])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(SIDEBAR_VIEW_MODE_STORAGE_KEY, sidebarViewMode)
  }, [sidebarViewMode])

  useEffect(() => {
    const checkScreenSize = () => {
      const mobile = window.innerWidth < 600
      setIsMobile(mobile)
      // Auto-close sidebar on mobile, auto-open on desktop
      if (mobile) {
        setSidebarOpen(false)
      } else {
        setSidebarOpen(true)
      }
    }

    checkScreenSize()
    window.addEventListener('resize', checkScreenSize)
    return () => window.removeEventListener('resize', checkScreenSize)
  }, [])

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen)
  }

  return (
    <div className="flex h-screen flex-col">
      <Header onMenuClick={toggleSidebar} showMenuButton={isMobile} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar 
          groups={groups} 
          isOpen={sidebarOpen} 
          isMobile={isMobile}
          isCollapsed={!isMobile && isSidebarCollapsed}
          viewMode={sidebarViewMode}
          onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
          onViewModeChange={setSidebarViewMode}
          onClose={() => setSidebarOpen(false)}
        />
        <main className="flex flex-1 flex-col overflow-auto bg-slate-50 dark:bg-slate-950">
          <div className="flex-1">{children}</div>
        </main>
      </div>
      <Footer />
    </div>
  )
}
