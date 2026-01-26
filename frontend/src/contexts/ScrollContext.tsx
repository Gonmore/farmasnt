import { createContext, useContext, useState, type ReactNode } from 'react'

interface ScrollContextType {
  scrollLeft: number
  setScrollLeft: (left: number) => void
  maxScroll: number
  setMaxScroll: (max: number) => void
}

const ScrollContext = createContext<ScrollContextType | undefined>(undefined)

export function ScrollProvider({ children }: { children: ReactNode }) {
  const [scrollLeft, setScrollLeft] = useState(0)
  const [maxScroll, setMaxScroll] = useState(0)

  return (
    <ScrollContext.Provider value={{ scrollLeft, setScrollLeft, maxScroll, setMaxScroll }}>
      {children}
    </ScrollContext.Provider>
  )
}

export function useScroll() {
  const context = useContext(ScrollContext)
  if (!context) {
    throw new Error('useScroll must be used within ScrollProvider')
  }
  return context
}