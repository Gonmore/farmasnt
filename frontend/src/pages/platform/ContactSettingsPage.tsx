import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { Button, Input } from '../../components'

interface ContactInfo {
  id: string
  modalHeader: string
  modalBody: string
}

export function ContactSettingsPage() {
  const queryClient = useQueryClient()
  const [modalHeader, setModalHeader] = useState('')
  const [modalBody, setModalBody] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const { data: contactInfo, isLoading } = useQuery({
    queryKey: ['contactInfo'],
    queryFn: async () => {
      const response = await api.get<ContactInfo>('/api/v1/contact/info')
      return response.data
    },
  })

  // Inicializar valores cuando se carga la data
  useEffect(() => {
    if (contactInfo) {
      setModalHeader(contactInfo.modalHeader)
      setModalBody(contactInfo.modalBody)
    }
  }, [contactInfo])

  const updateMutation = useMutation({
    mutationFn: async (data: { modalHeader: string; modalBody: string }) => {
      const response = await api.patch<ContactInfo>('/api/v1/contact/info', data)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contactInfo'] })
      setMessage({ type: 'success', text: 'Configuración de contacto actualizada correctamente' })
      setTimeout(() => setMessage(null), 5000)
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.message || 'Error al actualizar la configuración'
      setMessage({ type: 'error', text: errorMsg })
      setTimeout(() => setMessage(null), 5000)
    },
  })

  const handleSave = () => {
    if (!modalHeader.trim() || !modalBody.trim()) {
      setMessage({ type: 'error', text: 'Todos los campos son obligatorios' })
      setTimeout(() => setMessage(null), 3000)
      return
    }

    updateMutation.mutate({ modalHeader, modalBody })
  }

  const handleReset = () => {
    if (contactInfo) {
      setModalHeader(contactInfo.modalHeader)
      setModalBody(contactInfo.modalBody)
      setMessage(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Configuración de Contacto
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Personaliza el contenido del modal de contacto que se muestra en el footer
        </p>
      </div>

      {message && (
        <div
          className={`rounded-lg border px-4 py-3 ${
            message.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200'
              : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="space-y-6">
          {/* Header del Modal */}
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Título del Modal
            </label>
            <Input
              type="text"
              value={modalHeader}
              onChange={(e) => setModalHeader(e.target.value)}
              placeholder="Ej: Contactos"
              maxLength={200}
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Este texto aparecerá como título del modal (máximo 200 caracteres)
            </p>
          </div>

          {/* Body del Modal */}
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Contenido del Modal
            </label>
            <textarea
              value={modalBody}
              onChange={(e) => setModalBody(e.target.value)}
              placeholder="Ej: Únete a este sistema o solicita el tuyo personalizado:&#10;- 📧 contactos@supernovatel.com&#10;- � WhatsApp: +591 65164773"
              rows={8}
              maxLength={1000}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:placeholder-slate-500"
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Usa saltos de línea para separar el contenido. Puedes incluir emojis (máximo 1000 caracteres)
            </p>
          </div>

          {/* Preview */}
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Vista Previa
            </label>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
              <h3 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
                {modalHeader || '(Título del modal)'}
              </h3>
              <div className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
                {modalBody || '(Contenido del modal)'}
              </div>
            </div>
          </div>

          {/* Botones */}
          <div className="flex gap-3 border-t border-slate-200 pt-6 dark:border-slate-700">
            <Button
              onClick={handleSave}
              variant="primary"
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Guardando...' : 'Guardar Cambios'}
            </Button>
            <Button onClick={handleReset} variant="secondary">
              Restablecer
            </Button>
          </div>
        </div>
      </div>

      {/* Información adicional */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
        <h4 className="mb-2 text-sm font-semibold text-blue-900 dark:text-blue-200">
          ℹ️ Información
        </h4>
        <ul className="space-y-1 text-xs text-blue-800 dark:text-blue-300">
          <li>• El modal de contacto se muestra cuando cualquier usuario hace clic en el footer</li>
          <li>• Solo usuarios con email @supernovatel.com pueden editar esta configuración</li>
          <li>• Los cambios son globales y afectan a todos los usuarios del sistema</li>
          <li>• Puedes usar emojis copiándolos y pegándolos directamente en el contenido</li>
        </ul>
      </div>
    </div>
  )
}
