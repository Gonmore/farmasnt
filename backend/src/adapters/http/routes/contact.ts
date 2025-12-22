import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { requireAuth } from '../../../application/security/rbac.js'
import { AuditService } from '../../../application/audit/auditService.js'

const updateContactInfoSchema = z.object({
  modalHeader: z.string().trim().min(1).max(200),
  modalBody: z.string().trim().min(1).max(1000),
})

export async function registerContactRoutes(app: FastifyInstance): Promise<void> {
  const db = prisma()
  const audit = new AuditService(db)

  // GET /api/v1/contact/info - público, obtiene la configuración de contacto
  app.get('/api/v1/contact/info', async (request, reply) => {
    // Buscar el primer (y único) registro de ContactInfo
    let contactInfo = await db.contactInfo.findFirst({
      select: {
        id: true,
        modalHeader: true,
        modalBody: true,
      },
    })

    // Si no existe, crear uno con valores por defecto
    if (!contactInfo) {
      contactInfo = await db.contactInfo.create({
        data: {
          modalHeader: 'Contactos',
          modalBody: 'Únete a este sistema o solicita el tuyo personalizado:\n- 📧 contactos@supernovatel.com\n- � WhatsApp: +591 65164773',
        },
        select: {
          id: true,
          modalHeader: true,
          modalBody: true,
        },
      })
    }

    return reply.send(contactInfo)
  })

  // PATCH /api/v1/contact/info - solo usuarios @supernovatel.com pueden editar
  app.patch(
    '/api/v1/contact/info',
    { preHandler: [requireAuth()] },
    async (request, reply) => {
      const actor = request.auth!

      // Validar que el usuario sea de @supernovatel.com
      const user = await db.user.findFirst({
        where: { id: actor.userId },
        select: { email: true },
      })

      if (!user || !user.email.endsWith('@supernovatel.com')) {
        return reply.status(403).send({ message: 'Solo usuarios @supernovatel.com pueden editar la configuración de contacto' })
      }

      const parsed = updateContactInfoSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ message: 'Invalid request', issues: parsed.error.issues })
      }

      const { modalHeader, modalBody } = parsed.data

      // Buscar el primer registro o crear uno nuevo
      let contactInfo = await db.contactInfo.findFirst({ select: { id: true } })

      if (!contactInfo) {
        contactInfo = await db.contactInfo.create({
          data: { modalHeader, modalBody, updatedBy: actor.userId },
          select: { id: true, modalHeader: true, modalBody: true },
        })
      } else {
        contactInfo = await db.contactInfo.update({
          where: { id: contactInfo.id },
          data: { modalHeader, modalBody, updatedBy: actor.userId },
          select: { id: true, modalHeader: true, modalBody: true },
        })
      }

      await audit.append({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'contact.info.update',
        entityType: 'ContactInfo',
        entityId: contactInfo.id,
        metadata: { modalHeader, modalBody },
      })

      return reply.send(contactInfo)
    },
  )
}
