import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export type CartItem = {
  id: string
  productId: string
  sku: string
  name: string
  price: number
  // Base units quantity (used for totals/math).
  quantity: number
  // Presentation (for display + payload). When null, treat as units.
  presentationId: string | null
  presentationName?: string | null
  unitsPerPresentation: number
  // Quantity expressed in the selected presentation (e.g. 2 cajas).
  presentationQuantity: number
  discountPct?: number
  photoUrl: string | null
}

type CartContextType = {
  items: CartItem[]
  itemCount: number
  total: number
  addItem: (item: Omit<CartItem, 'quantity' | 'presentationQuantity'> & { presentationQuantity?: number }) => void
  removeItem: (cartLineId: string) => void
  updatePresentationQuantity: (cartLineId: string, presentationQuantity: number) => void
  updatePrice: (cartLineId: string, price: number) => void
  updateDiscountPct: (cartLineId: string, discountPct: number) => void
  clearCart: () => void
}

const CartContext = createContext<CartContextType | null>(null)

const CART_STORAGE_KEY = 'farmasnt_cart'

function clampPos(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, n)
}

function baseFromPresentation(presentationQuantity: number, unitsPerPresentation: number): number {
  const pq = clampPos(presentationQuantity)
  const u = clampPos(unitsPerPresentation)
  if (pq <= 0 || u <= 0) return 0
  return pq * u
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => {
    // Load cart from localStorage on init
    try {
      const stored = localStorage.getItem(CART_STORAGE_KEY)
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })

  // Save cart to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items))
    } catch (error) {
      console.error('Error saving cart to localStorage:', error)
    }
  }, [items])

  const addItem = (item: Omit<CartItem, 'quantity' | 'presentationQuantity'> & { presentationQuantity?: number }) => {
    setItems(prev => {
      const existingIndex = prev.findIndex(i => i.id === item.id)

      const nextPresentationQty = clampPos(item.presentationQuantity ?? 1)
      const nextBaseQty = baseFromPresentation(nextPresentationQty, clampPos(item.unitsPerPresentation))
      
      if (existingIndex >= 0) {
        // Item exists, update quantity
        const updated = [...prev]
        updated[existingIndex] = {
          ...updated[existingIndex],
          presentationQuantity: updated[existingIndex].presentationQuantity + nextPresentationQty,
          quantity: updated[existingIndex].quantity + nextBaseQty,
          // If caller provides a discount, keep it; otherwise preserve existing
          discountPct: item.discountPct ?? updated[existingIndex].discountPct,
        }
        return updated
      } else {
        // New item
        return [...prev, {
          ...item,
          presentationQuantity: nextPresentationQty,
          quantity: nextBaseQty,
          discountPct: item.discountPct ?? 0,
        }]
      }
    })
  }

  const removeItem = (cartLineId: string) => {
    setItems(prev => prev.filter(item => item.id !== cartLineId))
  }

  const updatePresentationQuantity = (cartLineId: string, presentationQuantity: number) => {
    const nextPresentationQty = clampPos(presentationQuantity)

    if (nextPresentationQty <= 0) {
      removeItem(cartLineId)
      return
    }

    setItems(prev => {
      const updated = [...prev]
      const index = updated.findIndex(i => i.id === cartLineId)
      if (index >= 0) {
        const unitsPer = clampPos(updated[index].unitsPerPresentation)
        updated[index] = {
          ...updated[index],
          presentationQuantity: nextPresentationQty,
          quantity: baseFromPresentation(nextPresentationQty, unitsPer),
        }
      }
      return updated
    })
  }

  const updatePrice = (cartLineId: string, price: number) => {
    const nextPrice = Number.isFinite(price) ? Math.max(0, price) : 0
    setItems(prev => {
      const updated = [...prev]
      const index = updated.findIndex(i => i.id === cartLineId)
      if (index >= 0) {
        updated[index] = { ...updated[index], price: nextPrice }
      }
      return updated
    })
  }

  const updateDiscountPct = (cartLineId: string, discountPct: number) => {
    const pct = Number.isFinite(discountPct) ? Math.min(100, Math.max(0, discountPct)) : 0
    setItems(prev => {
      const updated = [...prev]
      const index = updated.findIndex(i => i.id === cartLineId)
      if (index >= 0) {
        updated[index] = { ...updated[index], discountPct: pct }
      }
      return updated
    })
  }

  const clearCart = () => {
    setItems([])
  }

  const itemCount = items.reduce((total, item) => total + item.quantity, 0)
  const total = items.reduce((sum, item) => {
    const disc = Number.isFinite(item.discountPct) ? Math.min(100, Math.max(0, item.discountPct ?? 0)) : 0
    return sum + (item.price * item.quantity * (1 - disc / 100))
  }, 0)

  return (
    <CartContext.Provider
      value={{
        items,
        itemCount,
        total,
        addItem,
        removeItem,
        updatePresentationQuantity,
        updatePrice,
        updateDiscountPct,
        clearCart
      }}
    >
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  const context = useContext(CartContext)
  if (!context) {
    throw new Error('useCart must be used within a CartProvider')
  }
  return context
}
