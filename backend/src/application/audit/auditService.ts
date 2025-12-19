import type { PrismaClient } from '../../generated/prisma/client.js'

export type AuditEventInput = {
  tenantId: string
  actorUserId?: string | null
  action: string
  entityType: string
  entityId?: string | null
  before?: unknown
  after?: unknown
  metadata?: Record<string, unknown>
}

export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async append(event: AuditEventInput): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        tenantId: event.tenantId,
        actorUserId: event.actorUserId ?? null,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId ?? null,
        before: event.before as any,
        after: event.after as any,
        metadata: event.metadata as any,
        createdBy: event.actorUserId ?? null,
      },
    })
  }
}
