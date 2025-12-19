import type { PrismaClient } from '../../generated/prisma/client.js'

export async function ensureAuditTrailImmutability(prismaClient: PrismaClient): Promise<void> {
  // Enforces append-only for the "AuditEvent" table (GxP-friendly).
  // Safe to run repeatedly.
  await prismaClient.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION prevent_audit_event_mutations()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'AuditEvent is immutable (append-only).';
    END;
    $$ LANGUAGE plpgsql;
  `)

  await prismaClient.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_event_no_update'
      ) THEN
        -- already exists
      ELSE
        CREATE TRIGGER trg_audit_event_no_update
        BEFORE UPDATE ON "AuditEvent"
        FOR EACH ROW
        EXECUTE FUNCTION prevent_audit_event_mutations();
      END IF;

      IF EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_event_no_delete'
      ) THEN
        -- already exists
      ELSE
        CREATE TRIGGER trg_audit_event_no_delete
        BEFORE DELETE ON "AuditEvent"
        FOR EACH ROW
        EXECUTE FUNCTION prevent_audit_event_mutations();
      END IF;
    END $$;
  `)
}
