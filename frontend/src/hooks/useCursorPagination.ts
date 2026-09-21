import { useState, useCallback } from 'react'

export function useCursorPagination() {
  const [history, setHistory] = useState<string[]>([])
  const [pageIndex, setPageIndex] = useState(0)

  const currentCursor = pageIndex > 0 ? history[pageIndex - 1] : undefined
  const canGoBack = pageIndex > 0
  const currentPage = pageIndex + 1
  const maxVisitedPage = history.length + 1

  const goForward = useCallback((nextCursor: string | null) => {
    if (!nextCursor) return
    setHistory((prev) => [...prev.slice(0, pageIndex), nextCursor])
    setPageIndex((prev) => prev + 1)
  }, [pageIndex])

  const goBack = useCallback(() => {
    if (pageIndex > 0) setPageIndex((prev) => prev - 1)
  }, [pageIndex])

  const goToStart = useCallback(() => {
    setHistory([])
    setPageIndex(0)
  }, [])

  const goToPage = useCallback((page: number) => {
    if (page < 1) {
      goToStart()
      return
    }
    const targetIdx = page - 1
    if (targetIdx > history.length) return
    setPageIndex(targetIdx)
  }, [goToStart, history.length])

  const reset = useCallback(() => {
    setHistory([])
    setPageIndex(0)
  }, [])

  return {
    currentCursor,
    canGoBack,
    currentPage,
    maxVisitedPage,
    goForward,
    goBack,
    goToStart,
    goToPage,
    reset,
  }
}
