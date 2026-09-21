import { useState } from 'react'
import { Button } from './Button'
import { ChevronLeftIcon, ChevronRightIcon, ArrowPathIcon } from '@heroicons/react/24/outline'

export interface PaginationCursorProps {
  hasMore: boolean
  onLoadMore: () => void
  loading?: boolean
  currentCount?: number
  currentPage?: number
  maxPage?: number
  take?: number
  canGoBack?: boolean
  onGoToStart?: () => void
  onGoBack?: () => void
  onGoToPage?: (page: number) => void
}

export function PaginationCursor({
  hasMore,
  onLoadMore,
  loading,
  currentCount,
  currentPage = 1,
  maxPage,
  take = 20,
  onGoToStart,
  canGoBack = false,
  onGoBack,
  onGoToPage,
}: PaginationCursorProps) {
  const [pageInput, setPageInput] = useState('')

  const hasNavigation = onGoToStart || (canGoBack && onGoBack) || hasMore || onGoToPage

  if (!hasNavigation) return null

  const startRange = ((currentPage - 1) * take) + 1
  const endRange = currentCount ? startRange + currentCount - 1 : startRange + take - 1

  const handlePageInput = () => {
    const page = parseInt(pageInput)
    if (!isNaN(page) && onGoToPage) {
      onGoToPage(page)
    }
    setPageInput('')
  }

  const handlePageInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handlePageInput()
    }
  }

  return (
    <div className="mt-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        {currentCount !== undefined && currentCount > 0 && (
          <span className="text-sm text-slate-600 dark:text-slate-400">
            Mostrando del {startRange} al {endRange}
          </span>
        )}
        {maxPage !== undefined && maxPage > 1 && (
          <span className="text-sm text-slate-600 dark:text-slate-400">
            Página {currentPage}
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

        {onGoToPage && (
          <div className="flex items-center gap-1">
            <input
              type="number"
              min="1"
              max={maxPage ?? ''}
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onKeyDown={handlePageInputKeyDown}
              placeholder={String(currentPage)}
              className="w-14 px-2 py-1 text-sm text-center border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handlePageInput}
              disabled={!pageInput.trim()}
            >
              Ir
            </Button>
          </div>
        )}

        {hasMore && (
          <Button
            onClick={onLoadMore}
            loading={loading}
            variant="outline"
            size="sm"
            icon={<ChevronRightIcon className="w-4 h-4" />}
          >
            Siguiente
          </Button>
        )}
      </div>
    </div>
  )
}
