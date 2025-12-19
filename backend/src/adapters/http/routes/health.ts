import type { FastifyInstance } from 'fastify'

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/health', async () => {
    return {
      status: 'ok',
      service: 'pharmaflow-backend',
      time: new Date().toISOString(),
    }
  })
}
