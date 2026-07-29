import { getProductDisplayName } from './productName'

type ProductLike = {
  name: string
  genericName?: string | null
}

export function sortProductsByDisplayName<T extends ProductLike>(products: T[]): T[] {
  return [...products].sort((left, right) =>
    getProductDisplayName(left).localeCompare(getProductDisplayName(right), 'es', {
      sensitivity: 'base',
      numeric: true,
    }),
  )
}