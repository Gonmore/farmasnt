import { MainLayout, PageContainer } from '../../components'

export function BulkFulfillRequestsPage() {
  console.log('BulkFulfillRequestsPage loaded')
  return (
    <MainLayout>
      <PageContainer title="Atender solicitudes">
        <div className="p-4 bg-blue-100 text-blue-800 rounded">
          Página de Atender solicitudes - funcionando
        </div>
      </PageContainer>
    </MainLayout>
  )
}