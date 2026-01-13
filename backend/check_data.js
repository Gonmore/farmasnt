import { prisma } from './src/adapters/db/prisma.js';
import 'dotenv/config';

async function checkData() {
  const db = prisma();

  try {
    const customerCount = await db.customer.count({
      where: { tenantId: '00000000-0000-0000-0000-000000000002' }
    });

    const productCount = await db.product.count({
      where: { tenantId: '00000000-0000-0000-0000-000000000002' }
    });

    const warehouseCount = await db.warehouse.count({
      where: { tenantId: '00000000-0000-0000-0000-000000000002' }
    });

    console.log('=== DATOS EN LA BASE DE DATOS ===');
    console.log(`Clientes: ${customerCount}`);
    console.log(`Productos: ${productCount}`);
    console.log(`Sucursales: ${warehouseCount}`);

    if (customerCount > 0 || productCount > 0 || warehouseCount > 0) {
      console.log('\n✅ TUS DATOS SIGUEN EXISTIENDO - El seed NO los borró');
    } else {
      console.log('\n❌ No se encontraron datos de negocio');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.$disconnect();
  }
}

checkData();