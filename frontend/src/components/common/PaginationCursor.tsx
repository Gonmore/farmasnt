import { Button } from './Button'
import { ChevronLeftIcon, ChevronRightIcon, ArrowPathIcon } from '@heroicons/react/24/outline'

export interface PaginationCursorProps {
  hasMore: boolean
  onLoadMore: () => void
  loading?: boolean
  currentCount?: number
  onGoToStart?: () => void
  canGoBack?: boolean
  onGoBack?: () => void
}

export function PaginationCursor({
  hasMore,
  onLoadMore,
  loading,
  currentCount,
  onGoToStart,
  canGoBack,
  onGoBack
}: PaginationCursorProps) {
  const hasNavigation = onGoToStart || (canGoBack && onGoBack) || hasMore

  if (!hasNavigation) return null

  return (
    <div className="mt-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        {currentCount !== undefined && currentCount > 0 && (
          <span className="text-sm text-slate-600 dark:text-slate-400">
            Mostrando del 1 al {currentCount}
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
