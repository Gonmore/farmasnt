import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

export interface Column<T> {
  header: ReactNode
  accessor: (item: T, index: number) => ReactNode
  className?: string
  width?: string
}

export interface TableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyExtractor: (item: T) => string
  rowClassName?: (item: T) => string
  onRowClick?: (item: T) => void
  /**
   * Shows a sticky horizontal scrollbar at the top (synced with the table scroll),
   * so users can scroll horizontally without needing to reach the bottom.
   */
  alwaysVisibleHorizontalScroll?: boolean
}

export function Table<T>({ columns, data, keyExtractor, rowClassName, onRowClick, alwaysVisibleHorizontalScroll = false }: TableProps<T>) {
  const hasExplicitWidths = columns.some((c) => typeof c.width === 'string' && c.width.trim().length > 0)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const mirrorScrollRef = useRef<HTMLDivElement | null>(null)
  const isSyncingRef = useRef(false)

  const [stickyWidth, setStickyWidth] = useState(0)
  const [showSticky, setShowSticky] = useState(false)
  const [isInView, setIsInView] = useState(false)
  const [mirrorLeft, setMirrorLeft] = useState(0)
  const [mirrorWidth, setMirrorWidth] = useState(0)
  const [mirrorBottom, setMirrorBottom] = useState(0)

  const scrollbarClasses = useMemo(
    () =>
      'scrollbar scrollbar-thumb-slate-400 scrollbar-track-slate-200 dark:scrollbar-thumb-slate-500 dark:scrollbar-track-slate-700',
    []
  )

  useEffect(() => {
    if (!alwaysVisibleHorizontalScroll) return

    const scroller = scrollRef.current
    const mirror = mirrorScrollRef.current
    const root = rootRef.current
    if (!scroller || !mirror || !root) return

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        setIsInView(!!entry?.isIntersecting)
      },
      { root: null, threshold: 0.05 }
    )
    io.observe(root)

    const update = () => {
      const nextWidth = scroller.scrollWidth
      const hasOverflow = scroller.scrollWidth > scroller.clientWidth + 1
      setStickyWidth(nextWidth)
      setShowSticky(hasOverflow)

      const rect = scroller.getBoundingClientRect()
      setMirrorLeft(rect.left)
      setMirrorWidth(rect.width)

      const footerEl = document.querySelector('footer') as HTMLElement | null
      const footerH = footerEl ? footerEl.getBoundingClientRect().height : 0
      setMirrorBottom(footerH)

      if (hasOverflow && mirror.scrollLeft !== scroller.scrollLeft) {
        mirror.scrollLeft = scroller.scrollLeft
      }
    }

    update()
    const raf1 = requestAnimationFrame(update)
    const raf2 = requestAnimationFrame(update)

    const onScrollMain = () => {
      if (isSyncingRef.current) return
      isSyncingRef.current = true
      mirror.scrollLeft = scroller.scrollLeft
      requestAnimationFrame(() => {
        isSyncingRef.current = false
      })
    }

    const onScrollMirror = () => {
      if (isSyncingRef.current) return
      isSyncingRef.current = true
      scroller.scrollLeft = mirror.scrollLeft
      requestAnimationFrame(() => {
        isSyncingRef.current = false
      })
    }

    scroller.addEventListener('scroll', onScrollMain, { passive: true })
    mirror.addEventListener('scroll', onScrollMirror, { passive: true })

    const ro = new ResizeObserver(() => update())
    ro.observe(scroller)

    window.addEventListener('resize', update)

    return () => {
      scroller.removeEventListener('scroll', onScrollMain)
      mirror.removeEventListener('scroll', onScrollMirror)
      ro.disconnect()
      window.removeEventListener('resize', update)
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      io.disconnect()
    }
  }, [alwaysVisibleHorizontalScroll, columns, data])

  return (
    <div ref={rootRef} className="w-full">
      <div ref={scrollRef} className={`overflow-x-auto ${scrollbarClasses}`}>
        <table className="w-full min-w-max" style={{ tableLayout: hasExplicitWidths ? 'fixed' : 'auto' }}>
        <thead className="bg-slate-50 dark:bg-slate-800">
          <tr className="border-b-2 border-slate-200 dark:border-slate-700">
            {columns.map((col, idx) => (
              <th
                key={idx}
                className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 ${col.className ?? ''}`}
                style={{ width: col.width }}
              >
                <div className="whitespace-nowrap">{col.header}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-slate-900">
          {data.map((item, rowIndex) => (
            <tr
              key={keyExtractor(item)}
              className={`border-b border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50 ${onRowClick ? 'cursor-pointer' : ''} ${rowClassName ? rowClassName(item) : ''}`}
              onClick={onRowClick ? () => onRowClick(item) : undefined}
            >
              {columns.map((col, idx) => (
                <td 
                  key={idx} 
                  className={`px-4 py-3 text-sm text-slate-900 dark:text-slate-100 ${col.className ?? ''}`}
                  style={{ width: col.width }}
                >
                  <div className={`whitespace-nowrap ${col.className?.includes('wrap') ? 'whitespace-normal' : ''}`}>{col.accessor(item, rowIndex)}</div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {alwaysVisibleHorizontalScroll && showSticky && isInView && (
        <div
          ref={mirrorScrollRef}
          className={`fixed z-50 h-6 overflow-x-auto border-t border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 ${scrollbarClasses}`}
          style={{ left: mirrorLeft, width: mirrorWidth, bottom: mirrorBottom }}
          aria-hidden
        >
          <div style={{ width: stickyWidth, height: 1 }} />
        </div>
      )}
    </div>
  )
}
