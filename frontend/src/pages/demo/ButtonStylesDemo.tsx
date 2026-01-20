import { 
  PencilIcon, 
  EyeIcon, 
  TrashIcon, 
  PlusIcon, 
  CheckIcon,
  XMarkIcon,
  ArrowPathIcon,
  DocumentArrowDownIcon,
  ShareIcon,
  UserGroupIcon,
  CogIcon,
  PowerIcon,
  KeyIcon
} from '@heroicons/react/24/outline'
import { Button } from '../../components/common/Button'

export function ButtonStylesDemo() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Sistema de Botones - Estilo Moderno Linear
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Componente Button con Heroicons • Diseño limpio y minimalista
          </p>
        </div>

        <div className="space-y-8">
          
          {/* Variantes de Botones */}
          <section className="space-y-4">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              Variantes de Botones
            </h2>
            
            <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow space-y-8">
              
              {/* Botones Primarios (Primary) */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Primary (Acciones Principales)</h3>
                <div className="flex flex-wrap gap-3">
                  <Button variant="primary" icon={<PlusIcon />}>
                    Crear Nuevo
                  </Button>
                  <Button variant="primary" icon={<CheckIcon />}>
                    Guardar
                  </Button>
                  <Button variant="primary" icon={<CheckIcon />} size="lg">
                    Confirmar Pedido
                  </Button>
                  <Button variant="primary" icon={<PlusIcon />} loading>
                    Guardando...
                  </Button>
                </div>
              </div>

              {/* Botones Success */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Success (Acciones Positivas)</h3>
                <div className="flex flex-wrap gap-3">
                  <Button variant="success" icon={<CheckIcon />}>
                    Aprobar
                  </Button>
                  <Button variant="success" icon={<CheckIcon />}>
                    Confirmar
                  </Button>
                  <Button variant="success" icon={<PowerIcon />}>
                    Activar
                  </Button>
                </div>
              </div>

              {/* Botones Danger */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Danger (Acciones Destructivas)</h3>
                <div className="flex flex-wrap gap-3">
                  <Button variant="danger" icon={<TrashIcon />}>
                    Eliminar
                  </Button>
                  <Button variant="danger" icon={<XMarkIcon />}>
                    Cancelar Pedido
                  </Button>
                  <Button variant="danger" icon={<PowerIcon />}>
                    Desactivar
                  </Button>
                </div>
              </div>

              {/* Botones Outline */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Outline (Acciones Secundarias)</h3>
                <div className="flex flex-wrap gap-3">
                  <Button variant="outline" icon={<EyeIcon />}>
                    Ver Detalles
                  </Button>
                  <Button variant="outline" icon={<PencilIcon />}>
                    Editar
                  </Button>
                  <Button variant="outline" icon={<XMarkIcon />}>
                    Cancelar
                  </Button>
                  <Button variant="outline" icon={<DocumentArrowDownIcon />}>
                    Exportar
                  </Button>
                </div>
              </div>

              {/* Botones Ghost (PARA TABLAS) */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Ghost (Para Acciones en Tablas) ⭐</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">Estos son los que usaremos en todas las columnas de "Acciones"</p>
                <div className="flex flex-wrap gap-3">
                  <Button variant="ghost" size="sm" icon={<EyeIcon />}>
                    Ver
                  </Button>
                  <Button variant="ghost" size="sm" icon={<PencilIcon />}>
                    Editar
                  </Button>
                  <Button variant="ghost" size="sm" icon={<ShareIcon />}>
                    Compartir
                  </Button>
                  <Button variant="ghost" size="sm" icon={<DocumentArrowDownIcon />}>
                    Exportar
                  </Button>
                  <Button variant="ghost" size="sm" icon={<UserGroupIcon />}>
                    Usuarios
                  </Button>
                  <Button variant="ghost" size="sm" icon={<CogIcon />}>
                    Configurar
                  </Button>
                  <Button variant="ghost" size="sm" icon={<ArrowPathIcon />}>
                    Actualizar
                  </Button>
                  <Button variant="ghost" size="sm" icon={<KeyIcon />}>
                    Permisos
                  </Button>
                  <Button variant="ghost" size="sm" icon={<PowerIcon />}>
                    Activar
                  </Button>
                  <Button variant="ghost" size="sm" icon={<TrashIcon />}>
                    Eliminar
                  </Button>
                </div>
              </div>

              {/* Solo Iconos (Sin Texto) */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Solo Iconos (Compacto)</h3>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" size="sm" icon={<EyeIcon />} title="Ver" />
                  <Button variant="ghost" size="sm" icon={<PencilIcon />} title="Editar" />
                  <Button variant="ghost" size="sm" icon={<ShareIcon />} title="Compartir" />
                  <Button variant="ghost" size="sm" icon={<TrashIcon />} title="Eliminar" />
                  <Button variant="primary" size="sm" icon={<PlusIcon />} title="Agregar" />
                  <Button variant="danger" size="sm" icon={<XMarkIcon />} title="Cerrar" />
                </div>
              </div>

              {/* Tamaños */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Tamaños</h3>
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="primary" size="sm" icon={<PlusIcon />}>
                    Small
                  </Button>
                  <Button variant="primary" size="md" icon={<PlusIcon />}>
                    Medium (Default)
                  </Button>
                  <Button variant="primary" size="lg" icon={<PlusIcon />}>
                    Large
                  </Button>
                </div>
              </div>

              {/* Estados */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Estados</h3>
                <div className="flex flex-wrap gap-3">
                  <Button variant="primary" icon={<CheckIcon />}>
                    Normal
                  </Button>
                  <Button variant="primary" icon={<CheckIcon />} loading>
                    Cargando...
                  </Button>
                  <Button variant="primary" icon={<CheckIcon />} disabled>
                    Deshabilitado
                  </Button>
                </div>
              </div>

            </div>
          </section>

          {/* Ejemplo en Tabla */}
          <section className="space-y-4">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              Ejemplo en Tabla (Uso Real)
            </h2>
            
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Producto</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">SKU</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Stock</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="py-3 px-4 text-sm text-gray-900 dark:text-gray-100">Paracetamol 500mg</td>
                    <td className="py-3 px-4 text-sm text-gray-600 dark:text-gray-400">PAR-500</td>
                    <td className="py-3 px-4 text-sm text-gray-600 dark:text-gray-400">245 unidades</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" icon={<EyeIcon />}>Ver</Button>
                        <Button variant="ghost" size="sm" icon={<PencilIcon />}>Editar</Button>
                        <Button variant="ghost" size="sm" icon={<ArrowPathIcon />}>Mover</Button>
                      </div>
                    </td>
                  </tr>
                  <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="py-3 px-4 text-sm text-gray-900 dark:text-gray-100">Ibuprofeno 400mg</td>
                    <td className="py-3 px-4 text-sm text-gray-600 dark:text-gray-400">IBU-400</td>
                    <td className="py-3 px-4 text-sm text-gray-600 dark:text-gray-400">89 unidades</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" icon={<EyeIcon />}>Ver</Button>
                        <Button variant="ghost" size="sm" icon={<PencilIcon />}>Editar</Button>
                        <Button variant="ghost" size="sm" icon={<ArrowPathIcon />}>Mover</Button>
                      </div>
                    </td>
                  </tr>
                  <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="py-3 px-4 text-sm text-gray-900 dark:text-gray-100">Amoxicilina 500mg</td>
                    <td className="py-3 px-4 text-sm text-gray-600 dark:text-gray-400">AMO-500</td>
                    <td className="py-3 px-4 text-sm text-gray-600 dark:text-gray-400">156 unidades</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" icon={<EyeIcon />}>Ver</Button>
                        <Button variant="ghost" size="sm" icon={<PencilIcon />}>Editar</Button>
                        <Button variant="ghost" size="sm" icon={<ArrowPathIcon />}>Mover</Button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Nota Final */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-2">
              ✅ Estilo Seleccionado: Moderno Linear
            </h3>
            <p className="text-blue-800 dark:text-blue-200 mb-3">
              Este componente Button ya está listo para usarse en toda la aplicación.
            </p>
            <div className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
              <p><strong>Para tablas:</strong> Usar <code className="bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded">variant="ghost" size="sm"</code></p>
              <p><strong>Para CTAs:</strong> Usar <code className="bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded">variant="primary"</code> o <code className="bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded">variant="success"</code></p>
              <p><strong>Para acciones destructivas:</strong> Usar <code className="bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded">variant="danger"</code></p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
