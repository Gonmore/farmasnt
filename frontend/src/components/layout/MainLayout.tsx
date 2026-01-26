import type { ReactNode } from 'react'
import { useState, useEffect } from 'react'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { Footer } from './Footer'
import type { NavGroup } from './Sidebar'

export interface MainLayoutProps {
  children: ReactNode
  navGroups: NavGroup[]
}

export function MainLayout({ children, navGroups }: MainLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

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
          groups={navGroups} 
          isOpen={sidebarOpen} 
          isMobile={isMobile}
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
