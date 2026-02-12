import { useLocation } from 'react-router-dom'
import { MainLayout, PageContainer } from '../../components'
import { useNavigation } from '../../hooks'
import { LabProductionQuickActions } from '../../components/LabProductionQuickActions'

export function LabProductionPage() {
  const location = useLocation()
  const navGroups = useNavigation()

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer
        title="🧪 Laboratorio — Producción"
      >
        <LabProductionQuickActions currentPath={location.pathname} />
      </PageContainer>
    </MainLayout>
  )
}