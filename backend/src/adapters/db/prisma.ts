import { PrismaClient } from '../../generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

let prismaSingleton: PrismaClient | undefined

export function prisma(): PrismaClient {
  if (!prismaSingleton) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL is required')

    const pool = new Pool({ connectionString })
    const adapter = new PrismaPg(pool)

    prismaSingleton = new PrismaClient({
      adapter,
      log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
    })
  }
  return prismaSingleton
}
