import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/adapters/db/prisma.js';
import { Permissions } from '../src/application/security/permissions.js';
const DEFAULT_MODULES = ['WAREHOUSE', 'SALES'];
async function main() {
    const db = prisma();
    const tenantName = process.env.SEED_TENANT_NAME ?? 'Demo Pharma';
    const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@demo.local';
    const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Admin123!';
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    const tenant = await db.tenant.upsert({
        where: { id: '00000000-0000-0000-0000-000000000001' },
        update: { name: tenantName },
        create: {
            id: '00000000-0000-0000-0000-000000000001',
            name: tenantName,
            createdBy: null,
        },
    });
    for (const module of DEFAULT_MODULES) {
        await db.tenantModule.upsert({
            where: { tenantId_module: { tenantId: tenant.id, module } },
            update: { enabled: true },
            create: { tenantId: tenant.id, module, enabled: true, createdBy: null },
        });
    }
    const permissionSpecs = [
        { code: Permissions.CatalogRead, module: 'WAREHOUSE' },
        { code: Permissions.CatalogWrite, module: 'WAREHOUSE' },
        { code: Permissions.StockRead, module: 'WAREHOUSE' },
        { code: Permissions.StockMove, module: 'WAREHOUSE' },
        { code: Permissions.SalesOrderRead, module: 'SALES' },
        { code: Permissions.SalesOrderWrite, module: 'SALES' },
        { code: Permissions.AdminUsersManage, module: 'SALES' },
    ];
    for (const p of permissionSpecs) {
        await db.permission.upsert({
            where: { code: p.code },
            update: { module: p.module },
            create: { code: p.code, module: p.module, description: p.code, isSystem: true },
        });
    }
    const adminRole = await db.role.upsert({
        where: { tenantId_code: { tenantId: tenant.id, code: 'TENANT_ADMIN' } },
        update: { name: 'Tenant Admin' },
        create: {
            tenantId: tenant.id,
            code: 'TENANT_ADMIN',
            name: 'Tenant Admin',
            isSystem: true,
            createdBy: null,
        },
    });
    const perms = await db.permission.findMany({
        where: { code: { in: permissionSpecs.map((x) => x.code) } },
        select: { id: true },
    });
    for (const perm of perms) {
        await db.rolePermission.upsert({
            where: { roleId_permissionId: { roleId: adminRole.id, permissionId: perm.id } },
            update: {},
            create: { roleId: adminRole.id, permissionId: perm.id },
        });
    }
    const adminUser = await db.user.upsert({
        where: { tenantId_email: { tenantId: tenant.id, email: adminEmail } },
        update: { passwordHash, isActive: true },
        create: {
            tenantId: tenant.id,
            email: adminEmail,
            passwordHash,
            isActive: true,
            createdBy: null,
        },
        select: { id: true },
    });
    await db.userRole.upsert({
        where: { userId_roleId: { userId: adminUser.id, roleId: adminRole.id } },
        update: {},
        create: { userId: adminUser.id, roleId: adminRole.id },
    });
    // Basic warehouse/location for immediate stock tests
    const wh = await db.warehouse.upsert({
        where: { tenantId_code: { tenantId: tenant.id, code: 'WH-01' } },
        update: { name: 'Almacén Central' },
        create: { tenantId: tenant.id, code: 'WH-01', name: 'Almacén Central', createdBy: adminUser.id },
    });
    await db.location.upsert({
        where: { tenantId_warehouseId_code: { tenantId: tenant.id, warehouseId: wh.id, code: 'BIN-01' } },
        update: {},
        create: { tenantId: tenant.id, warehouseId: wh.id, code: 'BIN-01', type: 'BIN', createdBy: adminUser.id },
    });
    // eslint-disable-next-line no-console
    console.log('Seed completed:', { tenantId: tenant.id, adminEmail });
}
main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
});
//# sourceMappingURL=seed.js.map