import { MainLayout, PageContainer } from '../../components'
import { useNavigation } from '../../hooks'

export function SalesReportsPage() {
  const navGroups = useNavigation()
  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="Reportes de Ventas">
        <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
          <p className="text-slate-600 dark:text-slate-400">
            Los reportes de ventas estarán disponibles próximamente. Aquí se mostrarán resumen diario, top productos, etc.
          </p>
        </div>
      </PageContainer>
    </MainLayout>
  )
}
