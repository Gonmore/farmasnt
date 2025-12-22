import { Button } from './Button'

export interface PaginationCursorProps {
  hasMore: boolean
  onLoadMore: () => void
  loading?: boolean
}

export function PaginationCursor({ hasMore, onLoadMore, loading }: PaginationCursorProps) {
  if (!hasMore) return null
  
  return (
    <div className="mt-4 flex justify-center">
      <Button onClick={onLoadMore} loading={loading} variant="secondary" size="sm">
        Cargar más
      </Button>
    </div>
  )
}
