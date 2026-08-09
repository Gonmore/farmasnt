import { PrismaClient } from './src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter, log: ['warn', 'error'] });

(async () => {
  try {
    const batch = await prisma.batch.findFirst({
      where: { batchNumber: '30-26264' },
      select: { id: true, productId: true }
    });
    if (!batch) return;

    const product = await prisma.product.findUnique({
      where: { id: batch.productId },
      select: { tenantId: true, sku: true, name: true }
    });
    const tenantId = product.tenantId;

    // Get CBB InventoryBalance for this batch
    const balance = await prisma.inventoryBalance.findFirst({
      where: { batchId: batch.id, location: { warehouse: { code: 'SUC-CBB', tenantId } } },
      select: { id: true, quantity: true, reservedQuantity: true, locationId: true, version: true }
    });
    console.log('Current CBB balance id:', balance?.id, 'qty:', balance?.quantity);

    // Look for inventoryBalance-related audit events
    // Check all audit event types for this balance
    console.log('\n=== Looking for ALL audit events where this balance (da695eb8) is modified ===');
    const balanceAudits = await prisma.AuditEvent.findMany({
      where: {
        tenantId,
        OR: [
          { entityId: balance?.id },
        ]
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        after: true,
        createdAt: true,
      },
    });
    console.log('Audit events for balance:', balanceAudits.length);
    for (const ae of balanceAudits) {
      const qtyAfter = ae.after?.quantity;
      console.log(`  ${ae.action} | ${ae.entityType} | qty_after: ${qtyAfter} | ${ae.createdAt.toISOString()}`);
    }

    // Also check ALL audit events where batch is involved
    console.log('\n=== ALL audit events involving batch 029b9abd ===');
    const allAudits = await prisma.AuditEvent.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        after: true,
        createdAt: true,
      },
    });

    // Filter: batchId in after/after.movement.batchId
    let count = 0;
    for (const ae of allAudits) {
      const after = ae.after;
      if (!after) continue;
      const batchId = after.batchId || after.movement?.batchId;
      if (batchId === batch.id) {
        count++;
        const qtyAfter = after.quantity;
        const locId = after.locationId || after.toLocationId || after.fromLocationId;
        const movementType = after.movement?.type;
        const ref = after.movement?.referenceType || after.referenceType;
        console.log(`  ${ae.action} | ${ae.entityType} | qty: ${qtyAfter || 'N/A'} | loc: ${locId || 'N/A'} | movement: ${movementType || 'N/A'} | ref: ${ref || 'N/A'} | ${ae.createdAt.toISOString()}`);
      }
    }
    console.log(`Total: ${count}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
})();
