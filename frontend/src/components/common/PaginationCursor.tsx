import { Button } from './Button'
import { ChevronLeftIcon, ChevronRightIcon, ArrowPathIcon } from '@heroicons/react/24/outline'

export interface PaginationCursorProps {
  hasMore: boolean
  onLoadMore: () => void
  loading?: boolean
  currentCount?: number
  currentPage?: number
  take?: number
  onGoToStart?: () => void
  canGoBack?: boolean
  onGoBack?: () => void
}

export function PaginationCursor({
  hasMore,
  onLoadMore,
  loading,
  currentCount,
  currentPage = 1,
  take = 20,
  onGoToStart,
  canGoBack,
  onGoBack
}: PaginationCursorProps) {
  const hasNavigation = onGoToStart || (canGoBack && onGoBack) || hasMore

  if (!hasNavigation) return null

  // Calcular el rango correcto
  const startRange = ((currentPage - 1) * take) + 1
  const endRange = currentCount ? startRange + currentCount - 1 : startRange + take - 1

  return (
    <div className="mt-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        {currentCount !== undefined && currentCount > 0 && (
          <span className="text-sm text-slate-600 dark:text-slate-400">
            Mostrando del {startRange} al {endRange}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {onGoToStart && (
          <Button
            variant="outline"
            size="sm"
            onClick={onGoToStart}
            icon={<ArrowPathIcon className="w-4 h-4" />}
          >
            Inicio
          </Button>
        )}

        {canGoBack && onGoBack && (
          <Button
            variant="outline"
            size="sm"
            onClick={onGoBack}
            icon={<ChevronLeftIcon className="w-4 h-4" />}
          >
            Anterior
          </Button>
        )}

        {hasMore && (
          <Button
            onClick={onLoadMore}
            loading={loading}
            variant="outline"
            size="sm"
            icon={<ChevronRightIcon className="w-4 h-4" />}
          >
            Cargar más
          </Button>
        )}
      </div>
    </div>
  )
}
