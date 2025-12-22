import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import { MainLayout, PageContainer, Button, Input, Select } from '../../components'
import { useNavigation } from '../../hooks'

async function createMovement(
  token: string,
  data: {
    type: string
    productId: string
    batchId?: string
    fromLocationId?: string
    toLocationId?: string
    quantity: string
    referenceType?: string
    referenceId?: string
    note?: string
  },
): Promise<any> {
  return apiFetch(`/api/v1/stock/movements`, {
    method: 'POST',
    token,
    body: JSON.stringify(data),
  })
}

export function MovementsPage() {
  const auth = useAuth()
  const navGroups = useNavigation()
  const queryClient = useQueryClient()

  const [type, setType] = useState('IN')
  const [productId, setProductId] = useState('')
  const [batchId, setBatchId] = useState('')
  const [fromLocationId, setFromLocationId] = useState('')
  const [toLocationId, setToLocationId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [note, setNote] = useState('')

  const movementMutation = useMutation({
    mutationFn: (data: any) => createMovement(auth.accessToken!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['balances'] })
      alert('Movimiento creado exitosamente')
      // Reset form
      setProductId('')
      setBatchId('')
      setFromLocationId('')
      setToLocationId('')
      setQuantity('')
      setNote('')
    },
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    movementMutation.mutate({
      type,
      productId,
      batchId: batchId || undefined,
      fromLocationId: fromLocationId || undefined,
      toLocationId: toLocationId || undefined,
      quantity,
      note: note || undefined,
    })
  }

  return (
    <MainLayout navGroups={navGroups}>
      <PageContainer title="Crear Movimiento de Stock">
        <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Select
              label="Tipo de Movimiento"
              value={type}
              onChange={(e) => setType(e.target.value)}
              options={[
                { value: 'IN', label: 'Entrada (IN)' },
                { value: 'OUT', label: 'Salida (OUT)' },
                { value: 'TRANSFER', label: 'Transferencia (TRANSFER)' },
                { value: 'ADJUSTMENT', label: 'Ajuste (ADJUSTMENT)' },
              ]}
              disabled={movementMutation.isPending}
            />
            <Input
              label="Product ID (UUID)"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              required
              disabled={movementMutation.isPending}
              placeholder="UUID del producto"
            />
            <Input
              label="Batch ID (UUID, opcional)"
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              disabled={movementMutation.isPending}
              placeholder="UUID del lote (opcional)"
            />
            {(type === 'OUT' || type === 'TRANSFER' || type === 'ADJUSTMENT') && (
              <Input
                label="From Location ID (UUID)"
                value={fromLocationId}
                onChange={(e) => setFromLocationId(e.target.value)}
                required={type === 'OUT' || type === 'TRANSFER'}
                disabled={movementMutation.isPending}
                placeholder="UUID de ubicación origen"
              />
            )}
            {(type === 'IN' || type === 'TRANSFER' || type === 'ADJUSTMENT') && (
              <Input
                label="To Location ID (UUID)"
                value={toLocationId}
                onChange={(e) => setToLocationId(e.target.value)}
                required={type === 'IN' || type === 'TRANSFER'}
                disabled={movementMutation.isPending}
                placeholder="UUID de ubicación destino"
              />
            )}
            <Input
              label="Cantidad"
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
              disabled={movementMutation.isPending}
              placeholder="0"
            />
            <Input
              label="Nota (opcional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={movementMutation.isPending}
              placeholder="Descripción del movimiento"
            />
            <div className="flex gap-2">
              <Button type="submit" loading={movementMutation.isPending}>
                Crear Movimiento
              </Button>
              {movementMutation.error && (
                <span className="text-sm text-red-600">
                  {movementMutation.error instanceof Error ? movementMutation.error.message : 'Error'}
                </span>
              )}
            </div>
          </form>

          <div className="mt-6 rounded bg-blue-50 p-4 text-sm dark:bg-blue-900/20">
            <p className="font-medium text-blue-900 dark:text-blue-200">Nota:</p>
            <p className="mt-1 text-blue-800 dark:text-blue-300">
              Para obtener los UUIDs, consulta los endpoints de productos, batches, y ubicaciones. Esta UI simplificada
              requiere ingresar IDs manualmente.
            </p>
          </div>
        </div>
      </PageContainer>
    </MainLayout>
  )
}
