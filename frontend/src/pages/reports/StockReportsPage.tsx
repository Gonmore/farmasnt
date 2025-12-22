import { MainLayout, PageContainer } from '../../components'
import { useNavigation } from '../../hooks'

export function StockReportsPage() {
  const navGroups = useNavigation()
  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="Reportes de Stock">
        <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
          <p className="text-slate-600 dark:text-slate-400">
            Los reportes de stock estarán disponibles próximamente. Aquí se mostrarán balances expanded, movimientos expanded, etc.
          </p>
        </div>
      </PageContainer>
    </MainLayout>
  )
}
