import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Button, Input, IconButton, Loading, ErrorState, EmptyState, Modal, Table } from '../../components'
import { apiFetch } from '../../lib/api'
import { parseEmails, ScheduleItem, ScheduleListResponse, ReportFrequency } from './reportsUtils'

interface ReportSchedulesManagerProps {
  accessToken: string | null
  segment: 'sales' | 'stock'
  reportKey: string
  scheduleModalOpen: boolean
  setScheduleModalOpen: (open: boolean) => void
}

export function ReportSchedulesManager({
  accessToken,
  segment,
  reportKey,
  scheduleModalOpen,
  setScheduleModalOpen,
}: ReportSchedulesManagerProps) {
  const [scheduleRecipientsRaw, setScheduleRecipientsRaw] = useState('')
  const [scheduleFrequency, setScheduleFrequency] = useState<ReportFrequency>('WEEKLY')
  const [scheduleHour, setScheduleHour] = useState(8)
  const [scheduleMinute, setScheduleMinute] = useState(0)
  const [scheduleDayOfWeek, setScheduleDayOfWeek] = useState(1)
  const [scheduleDayOfMonth, setScheduleDayOfMonth] = useState(1)

  const baseUrl = `/api/v1/reports/${segment}/schedules`

  const schedulesQuery = useQuery({
    queryKey: ['reports', segment, 'schedules'],
    queryFn: () => apiFetch<ScheduleListResponse>(baseUrl, { token: accessToken! }),
    enabled: !!accessToken && scheduleModalOpen,
  })

  const createScheduleMutation = useMutation({
    mutationFn: async () => {
      const recipients = parseEmails(scheduleRecipientsRaw)
      if (recipients.length === 0) throw new Error('Ingresa al menos un correo en destinatarios')

      await apiFetch(baseUrl, {
        token: accessToken!,
        method: 'POST',
        body: JSON.stringify({
          reportKey,
          frequency: scheduleFrequency,
          hour: scheduleHour,
          minute: scheduleMinute,
          dayOfWeek: scheduleFrequency === 'WEEKLY' ? scheduleDayOfWeek : undefined,
          dayOfMonth: scheduleFrequency === 'MONTHLY' ? scheduleDayOfMonth : undefined,
          recipients,
          enabled: true,
        }),
      })
    },
    onSuccess: async () => {
      window.alert('Envío programado creado')
      await schedulesQuery.refetch()
      setScheduleRecipientsRaw('')
    },
    onError: (err: any) => window.alert(err?.message ?? 'No se pudo crear el envío programado'),
  })

  const toggleScheduleMutation = useMutation({
    mutationFn: async (vars: { id: string; enabled: boolean }) => {
      await apiFetch(`${baseUrl}/${encodeURIComponent(vars.id)}`, {
        token: accessToken!,
        method: 'PATCH',
        body: JSON.stringify({ enabled: vars.enabled }),
      })
    },
    onSuccess: async () => {
      await schedulesQuery.refetch()
    },
  })

  const deleteScheduleMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`${baseUrl}/${encodeURIComponent(id)}`, {
        token: accessToken!,
        method: 'DELETE',
      })
    },
    onSuccess: async () => {
      await schedulesQuery.refetch()
    },
  })

  useEffect(() => {
    if (scheduleModalOpen) {
      setScheduleRecipientsRaw('')
    }
  }, [scheduleModalOpen])

  return (
    <Modal isOpen={scheduleModalOpen} onClose={() => setScheduleModalOpen(false)} title="Programar envíos" maxWidth="xl">
      <div className="flex flex-col max-h-[70vh]">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
          El backend enviará un correo con el enlace del reporte (con filtros y rango). Desde la vista puedes exportar a PDF.
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="w-full">
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Frecuencia</label>
            <select
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[var(--pf-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--pf-primary)] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              value={scheduleFrequency}
              onChange={(e) => setScheduleFrequency(e.target.value as ReportFrequency)}
            >
              <option value="DAILY">Diario (último día)</option>
              <option value="WEEKLY">Semanal (últimos 7 días)</option>
              <option value="MONTHLY">Mensual (mes anterior)</option>
            </select>
          </div>

          <Input label="Hora" type="number" min={0} max={23} value={String(scheduleHour)} onChange={(e) => setScheduleHour(Number(e.target.value))} />
          <Input label="Min" type="number" min={0} max={59} value={String(scheduleMinute)} onChange={(e) => setScheduleMinute(Number(e.target.value))} />

          {scheduleFrequency === 'WEEKLY' && (
            <Input
              label="Día semana (0=Dom..6=Sáb)"
              type="number"
              min={0}
              max={6}
              value={String(scheduleDayOfWeek)}
              onChange={(e) => setScheduleDayOfWeek(Number(e.target.value))}
            />
          )}

          {scheduleFrequency === 'MONTHLY' && (
            <Input
              label="Día mes (1..31)"
              type="number"
              min={1}
              max={31}
              value={String(scheduleDayOfMonth)}
              onChange={(e) => setScheduleDayOfMonth(Number(e.target.value))}
            />
          )}
        </div>

        <Input
          label="Destinatarios (emails separados por coma/espacio)"
          placeholder="admin@empresa.com, ventas@empresa.com"
          value={scheduleRecipientsRaw}
          onChange={(e) => setScheduleRecipientsRaw(e.target.value)}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" loading={createScheduleMutation.isPending} onClick={() => createScheduleMutation.mutate()}>
            Crear envío para pestaña actual ({reportKey})
          </Button>
          <Button variant="ghost" onClick={() => schedulesQuery.refetch()}>
            Refrescar
          </Button>
        </div>

        <div className="flex-1 overflow-auto">
          <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Envíos programados</h3>

            {schedulesQuery.isLoading && <Loading />}
            {schedulesQuery.isError && (
              <ErrorState message={(schedulesQuery.error as any)?.message ?? 'No se pudo cargar los envíos programados'} />
            )}
            {!schedulesQuery.isLoading && !schedulesQuery.isError && (schedulesQuery.data?.items?.length ?? 0) === 0 && (
              <EmptyState message="No hay envíos programados aún." />
            )}

            {!schedulesQuery.isLoading && !schedulesQuery.isError && (schedulesQuery.data?.items?.length ?? 0) > 0 && (
              <Table
                columns={[
                  { header: 'Reporte', accessor: (r) => r.reportKey },
                  { header: 'Frecuencia', accessor: (r) => r.frequency },
                  { header: 'Hora', accessor: (r) => `${String(r.hour).padStart(2, '0')}:${String(r.minute).padStart(2, '0')}` },
                  { header: 'Destinatarios', accessor: (r) => r.recipients.join(', ') },
                  { header: 'Próximo', accessor: (r) => (r.nextRunAt ? new Date(r.nextRunAt).toLocaleString() : '-') },
                  {
                    header: 'Acciones',
                    className: 'text-center w-auto',
                    accessor: (r) => (
                      <div className="flex items-center justify-center gap-1">
                        <IconButton
                          label={r.enabled ? 'Desactivar' : 'Activar'}
                          icon={'⏻'}
                          variant={r.enabled ? 'ghost' : 'primary'}
                          loading={toggleScheduleMutation.isPending}
                          onClick={() => toggleScheduleMutation.mutate({ id: r.id, enabled: !r.enabled })}
                          className={r.enabled ? 'text-red-600 dark:text-red-300' : ''}
                        />
                        <IconButton
                          label="Eliminar"
                          icon={'🗑️'}
                          variant="danger"
                          loading={deleteScheduleMutation.isPending}
                          onClick={() => {
                            if (window.confirm('¿Eliminar este envío programado?')) deleteScheduleMutation.mutate(r.id)
                          }}
                        />
                      </div>
                    ),
                  },
                ]}
                data={schedulesQuery.data?.items ?? []}
                keyExtractor={(r) => r.id}
              />
            )}
          </div>
        </div>

        <div className="flex-shrink-0">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Nota: para que esto funcione debes aplicar la migración nueva y configurar SMTP en el backend.
          </p>
        </div>
      </div>
    </Modal>
  )
}
