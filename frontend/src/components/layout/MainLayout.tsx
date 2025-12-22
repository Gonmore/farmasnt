import type { ReactNode } from 'react'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { Footer } from './Footer'
import type { NavGroup } from './Sidebar'

export interface MainLayoutProps {
  children: ReactNode
  navGroups: NavGroup[]
}

export function MainLayout({ children, navGroups }: MainLayoutProps) {
  return (
    <div className="flex h-screen flex-col">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar groups={navGroups} />
        <main className="flex flex-1 flex-col overflow-auto bg-slate-50 dark:bg-slate-950">
          <div className="flex-1">{children}</div>
          <Footer />
        </main>
      </div>
    </div>
  )
}
