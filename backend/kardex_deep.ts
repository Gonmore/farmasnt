import { PrismaClient } from './src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter, log: ['warn', 'error'] });

(async () => {
  try {
    console.log('=== Deep investigation of batch 30-26264 ===');

    const batch = await prisma.batch.findFirst({
      where: { batchNumber: '30-26264' },
      select: { id: true, batchNumber: true, productId: true }
    });

    if (!batch) return;

    const product = await prisma.product.findUnique({
      where: { id: batch.productId },
      select: { id: true, sku: true, name: true, tenantId: true }
    });

    const tenantId = product.tenantId;
    const cbbWarehouse = await prisma.warehouse.findFirst({
      where: { code: 'SUC-CBB', tenantId },
      select: { id: true, code: true }
    });

    // 1. Current InventoryBalance for this batch in CBB
    const balances = await prisma.inventoryBalance.findMany({
      where: { batchId: batch.id, location: { warehouseId: cbbWarehouse.id } },
      select: { id: true, quantity: true, reservedQuantity: true, locationId: true, location: { select: { id: true, code: true } } }
    });
    console.log('Current InventoryBalance in CBB:');
    for (const b of balances) {
      console.log(`  ${b.location.code}: qty=${b.quantity}, reserved=${b.reservedQuantity}`);
    }
    const totalCurrent = balances.reduce((sum, b) => sum + Number(b.quantity), 0);
    console.log('Total:', totalCurrent);

    // 2. Check ALL movements with referenceId linking to MSMS2026-668 and MSMS2026-669
    console.log('\n=== Checking MOVEMENT_REQUEST_RECEIPT relationships ===');
    const receiptMovements = await prisma.stockMovement.findMany({
      where: {
        referenceId: { in: ['414765e3-3735-43c0-a7f6-02d271659e2c', '4e608036-1127-486a-a655-9088504ef43b'] },
        tenantId: product.tenantId,
      },
      select: { id: true, number: true, type: true, quantity: true, fromLocationId: true, toLocationId: true, referenceType: true, referenceId: true, createdAt: true }
    });
    console.log('Receipt movements:', JSON.stringify(receiptMovements, null, 2));

    // 3. Get ALL movements for this product (not just this batch) to see if there are more
    // Actually, let's look at ALL movements where fromLocationId or toLocationId is CBB locations
    const cbbLocations = await prisma.location.findMany({
      where: { tenantId, warehouseId: cbbWarehouse.id },
      select: { id: true, code: true }
    });
    const cbbLocationIds = cbbLocations.map(l => l.id);

    // Get all stockMovements where batchId = batch.id AND (fromLocationId or toLocationId is a CBB location)
    // Include movements with null from/to (which the code treats as warehouse-independent)
    const allBatchMovements = await prisma.$queryRaw`
      SELECT 
        sm.id, sm.number, sm."createdAt", sm.type, sm.quantity, 
        sm."fromLocationId", sm."toLocationId",
        sm."referenceType", sm."referenceId", sm.note,
        sm."batchId", sm."productId",
        fl.code as from_code, fl.warehouse_code as from_wh,
        tl.code as to_code, tl.warehouse_code as to_wh
      FROM "StockMovement" sm
      LEFT JOIN (
        SELECT l.id, l.code, w.code as warehouse_code 
        FROM "Location" l 
        LEFT JOIN "Warehouse" w ON l."warehouseId" = w.id
      ) fl ON sm."fromLocationId" = fl.id
      LEFT JOIN (
        SELECT l.id, l.code, w.code as warehouse_code 
        FROM "Location" l 
        LEFT JOIN "Warehouse" w ON l."warehouseId" = w.id
      ) tl ON sm."toLocationId" = tl.id
      WHERE sm."batchId" = ${batch.id}
      ORDER BY sm."createdAt" ASC
    `;

    console.log('\n=== ALL batch movements with full location info ===');
    for (const m of allBatchMovements) {
      console.log(`MS${m.number} | ${m.type} | qty: ${m.quantity} | desde: ${m.from_wh || 'null'}/${m.from_code || 'null'} | hacia: ${m.to_wh || 'null'}/${m.to_code || 'null'} | ref: ${m.referenceType || 'null'}/${m.referenceId || 'null'}`);
    }

    // 4. Check if there are any movements NOT linked to this batch but affecting CBB balance
    // Look at audit events for this batch
    console.log('\n=== Audit events for batch movements ===');
    const auditEvents = await prisma.auditEvent.findMany({
      where: {
        tenantId,
        action: 'stock.movement.create',
        entityId: { in: allBatchMovements.map((m: any) => m.id) },
      },
      select: { entityId: true, after: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    console.log('Audit events found:', auditEvents.length);
    for (const ae of auditEvents) {
      const after = ae.after;
      console.log(`Movement ${ae.entityId}:`);
      console.log(`  fromBalance: ${JSON.stringify(ae.after.fromBalance)}`);
      console.log(`  toBalance: ${JSON.stringify(ae.after.toBalance)}`);
    }

    // 5. Check inventoryBalance history
    console.log('\n=== All InventoryBalance records for this batch in CBB (historical) ===');
    
    // Actually, InventoryBalance is typically a upsert (current state), not historical
    // Let's check if there's an audit trail for inventoryBalance changes
    const balanceAudits = await prisma.auditEvent.findMany({
      where: {
        tenantId,
        action: { in: ['inventory.balance.create', 'inventory.balance.update', 'inventoryBalance.create', 'inventoryBalance.update'] },
        entityId: { in: balances.map(b => b.id) },
      },
      select: { entityId: true, action: true, after: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    console.log('Balance audit events:', balanceAudits.length);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
})();
