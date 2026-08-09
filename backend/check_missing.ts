import { PrismaClient } from './src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter, log: ['warn', 'error'] });

(async () => {
  try {
    // Check if MS2026-955 and MS2026-957 exist in StockMovement
    console.log('=== Checking specific movement IDs from audit ===');
    
    const m1 = await prisma.stockMovement.findUnique({
      where: { id: '45cfaf9b-7aaf-45f2-8e38-79682c48fbb8' },
    });
    console.log('MS2026-955 (45cfaf9b):', JSON.stringify(m1, null, 2));

    const m2 = await prisma.stockMovement.findUnique({
      where: { id: 'afda1bc4-e373-43ca-b0d7-4e5236762294' },
    });
    console.log('MS2026-957 (afda1bc4):', JSON.stringify(m2, null, 2));

    const batch = await prisma.batch.findFirst({
      where: { batchNumber: '30-26264' },
      select: { id: true, productId: true }
    });

    // Check ALL StockMovement records for this batch
    const allMovements = await prisma.stockMovement.findMany({
      where: { batchId: batch.id },
      select: { id: true, number: true, type: true, quantity: true, createdAt: true, fromLocationId: true, toLocationId: true, referenceType: true }
    });
    console.log('\n=== All StockMovement records for batch (count: ' + allMovements.length + ') ===');
    for (const m of allMovements) {
      console.log(`MS${m.number} | id: ${m.id} | ${m.type} | qty: ${m.quantity} | ${m.createdAt.toISOString()}`);
    }

    // Check if there are movements with these numbers
    const byNum = await prisma.stockMovement.findMany({
      where: { number: { in: ['MS2026-955', 'MS2026-957'] } },
      select: { id: true, number: true, type: true, quantity: true, createdAt: true, fromLocationId: true, toLocationId: true, referenceType: true, batchId: true }
    });
    console.log('\n=== Movements by number MS2026-955/957 ===');
    for (const m of byNum) {
      console.log(`MS${m.number} | id: ${m.id} | type: ${m.type} | qty: ${m.quantity} | batchId: ${m.batchId || 'null'} | ${m.createdAt.toISOString()}`);
    }

    // Check the InventoryBalance history through version field
    console.log('\n=== Checking version history ===');
    // Let's query the raw audit data for this balance
    const auditEvents = await prisma.auditEvent.findMany({
      where: {
        entityId: 'da695eb8-b9c5-45fa-83f8-fc06a8eea9fd',
        action: { in: ['stock.movement.create', 'inventory.balance.create', 'inventory.balance.update', 'inventoryBalance.create', 'inventoryBalance.update'] }
      },
      orderBy: { createdAt: 'asc' },
      select: {
        action: true,
        entityId: true,
        after: true,
        createdAt: true,
      },
    });
    console.log('Balance audit events:', auditEvents.length);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
})();
