import pkg from '/app/src/generated/prisma/index.js';
const { PrismaClient } = pkg;
const prisma = new PrismaClient();

(async () => {
  try {
    console.log('=== Investigando lote 30-26264 en CBB ===');

    // Find batch 30-26264
    const batch = await prisma.batch.findFirst({
      where: { batchNumber: '30-26264' },
      select: { id: true, batchNumber: true, productId: true, presentationId: true, status: true }
    });
    console.log('Batch:', JSON.stringify(batch, null, 2));

    if (!batch) return;

    // Get product info (including tenantId)
    const product = await prisma.product.findUnique({
      where: { id: batch.productId },
      select: { id: true, sku: true, name: true, tenantId: true }
    });
    console.log('Product:', JSON.stringify(product, null, 2));

    // Get CBB warehouse
    const cbbWarehouse = await prisma.warehouse.findFirst({
      where: { code: 'SUC-CBB' },
      select: { id: true, code: true, name: true }
    });
    console.log('CBB Warehouse:', JSON.stringify(cbbWarehouse, null, 2));

    // Get ALL locations for CBB warehouse
    const cbbLocations = await prisma.location.findMany({
      where: { warehouseId: cbbWarehouse?.id },
      select: { id: true, code: true, isActive: true }
    });
    console.log('CBB Locations:', JSON.stringify(cbbLocations, null, 2));

    const cbbLocationIds = cbbLocations.map(l => l.id);
    console.log('CBB Location IDs:', cbbLocationIds);

    // Get all inventory balances for this batch in CBB
    const balances = await prisma.inventoryBalance.findMany({
      where: {
        batchId: batch.id,
        locationId: { in: cbbLocationIds }
      },
      select: {
        id: true,
        quantity: true,
        reservedQuantity: true,
        locationId: true,
        location: {
          select: { id: true, code: true, warehouse: { select: { id: true, code: true, name: true } } }
        }
      }
    });
    console.log('Balances in CBB for batch:', JSON.stringify(balances, null, 2));

    const total = balances.reduce((sum, b) => sum + Number(b.quantity), 0);
    console.log('Total balance in CBB:', total);

    // Get all stock movements for this batch
    const movements = await prisma.stockMovement.findMany({
      where: { batchId: batch.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, number: true, createdAt: true, type: true,
        quantity: true, fromLocationId: true, toLocationId: true,
        referenceType: true, referenceId: true, note: true, batchId: true,
      }
    });
    console.log('Total movements for batch:', movements.length);

    // Get location details for all movement locations
    const allLocationIds = new Set();
    for (const m of movements) {
      if (m.fromLocationId) allLocationIds.add(m.fromLocationId);
      if (m.toLocationId) allLocationIds.add(m.toLocationId);
    }

    const allLocations = await prisma.location.findMany({
      where: { id: { in: Array.from(allLocationIds) } },
      select: { id: true, code: true, warehouse: { select: { id: true, code: true, name: true } } }
    });
    const locMap = new Map(allLocations.map(l => [l.id, l]));

    // Show CBB-affecting movements
    console.log('\n=== Movimientos que afectan CBB ===');
    for (const m of movements) {
      const fromLoc = m.fromLocationId ? locMap.get(m.fromLocationId) : null;
      const toLoc = m.toLocationId ? locMap.get(m.toLocationId) : null;
      const fromCbb = fromLoc?.warehouse?.code === 'SUC-CBB';
      const toCbb = toLoc?.warehouse?.code === 'SUC-CBB';

      if (fromCbb || toCbb) {
        console.log('MS' + m.number + ' | ' + m.type + ' | qty: ' + m.quantity + ' | desde: ' + (fromLoc ? (fromLoc.warehouse.code + '/' + fromLoc.code) : 'null') + ' | hacia: ' + (toLoc ? (toLoc.warehouse.code + '/' + toLoc.code) : 'null') + ' | ref: ' + (m.referenceType || 'null'));
      }
    }

    // Show movements with null locations
    console.log('\n=== Movimientos con fromLocationId o toLocationId NULL ===');
    for (const m of movements) {
      if (!m.fromLocationId || !m.toLocationId) {
        console.log('MS' + m.number + ' | ' + m.type + ' | qty: ' + m.quantity + ' | desde: ' + (m.fromLocationId || 'null') + ' | hacia: ' + (m.toLocationId || 'null') + ' | ref: ' + (m.referenceType || 'null'));
      }
    }

    // Show ALL movements (first 50)
    console.log('\n=== ALL movements (first 50) ===');
    for (let i = 0; i < Math.min(50, movements.length); i++) {
      const m = movements[i];
      const fromLoc = m.fromLocationId ? locMap.get(m.fromLocationId) : null;
      const toLoc = m.toLocationId ? locMap.get(m.toLocationId) : null;
      const fromCbb = fromLoc?.warehouse?.code === 'SUC-CBB';
      const toCbb = toLoc?.warehouse?.code === 'SUC-CBB';

      console.log('MS' + m.number + ' | ' + m.type + ' | qty: ' + m.quantity + ' | desde: ' + (fromLoc ? (fromLoc.warehouse.code + '/' + fromLoc.code) : 'null') + ' | hacia: ' + (toLoc ? (toLoc.warehouse.code + '/' + toLoc.code) : 'null') + ' | ref: ' + (m.referenceType || 'null') + (fromCbb || toCbb ? ' *** AFECTA CBB ***' : ''));
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
})();
