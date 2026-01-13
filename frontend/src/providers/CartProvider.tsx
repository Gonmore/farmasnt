import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export type CartItem = {
  id: string
  sku: string
  name: string
  price: number
  quantity: number
  discountPct?: number
  photoUrl: string | null
}

type CartContextType = {
  items: CartItem[]
  itemCount: number
  total: number
  addItem: (item: Omit<CartItem, 'quantity'> & { quantity?: number }) => void
  removeItem: (productId: string) => void
  updateQuantity: (productId: string, quantity: number) => void
  updatePrice: (productId: string, price: number) => void
  updateDiscountPct: (productId: string, discountPct: number) => void
  clearCart: () => void
}

const CartContext = createContext<CartContextType | null>(null)

const CART_STORAGE_KEY = 'farmasnt_cart'

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

  const addItem = (item: Omit<CartItem, 'quantity'> & { quantity?: number }) => {
    setItems(prev => {
      const existingIndex = prev.findIndex(i => i.id === item.id)
      
      if (existingIndex >= 0) {
        // Item exists, update quantity
        const updated = [...prev]
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: updated[existingIndex].quantity + (item.quantity || 1),
          // If caller provides a discount, keep it; otherwise preserve existing
          discountPct: item.discountPct ?? updated[existingIndex].discountPct,
        }
        return updated
      } else {
        // New item
        return [...prev, {
          ...item,
          quantity: item.quantity || 1,
          discountPct: item.discountPct ?? 0,
        }]
      }
    })
  }

  const removeItem = (productId: string) => {
    setItems(prev => prev.filter(item => item.id !== productId))
  }

  const updateQuantity = (productId: string, quantity: number) => {
    const nextQty = Number.isFinite(quantity) ? quantity : 0

    if (nextQty <= 0) {
      removeItem(productId)
      return
    }

    setItems(prev => {
      const updated = [...prev]
      const index = updated.findIndex(i => i.id === productId)
      if (index >= 0) {
        updated[index] = { ...updated[index], quantity: nextQty }
      }
      return updated
    })
  }

  const updatePrice = (productId: string, price: number) => {
    const nextPrice = Number.isFinite(price) ? Math.max(0, price) : 0
    setItems(prev => {
      const updated = [...prev]
      const index = updated.findIndex(i => i.id === productId)
      if (index >= 0) {
        updated[index] = { ...updated[index], price: nextPrice }
      }
      return updated
    })
  }

  const updateDiscountPct = (productId: string, discountPct: number) => {
    const pct = Number.isFinite(discountPct) ? Math.min(100, Math.max(0, discountPct)) : 0
    setItems(prev => {
      const updated = [...prev]
      const index = updated.findIndex(i => i.id === productId)
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
        updateQuantity,
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
