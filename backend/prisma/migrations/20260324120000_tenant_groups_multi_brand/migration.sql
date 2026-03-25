-- CreateTable
CREATE TABLE "TenantGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "TenantGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantGroupMember" (
    "groupId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "TenantGroupMember_pkey" PRIMARY KEY ("groupId","tenantId")
);

-- CreateTable
CREATE TABLE "UserTenantAccess" (
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "UserTenantAccess_pkey" PRIMARY KEY ("userId","tenantId")
);

-- CreateIndex
CREATE INDEX "TenantGroupMember_groupId_idx" ON "TenantGroupMember"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantGroupMember_tenantId_key" ON "TenantGroupMember"("tenantId");

-- CreateIndex
CREATE INDEX "UserTenantAccess_userId_idx" ON "UserTenantAccess"("userId");

-- CreateIndex
CREATE INDEX "UserTenantAccess_tenantId_idx" ON "UserTenantAccess"("tenantId");

-- AddForeignKey
ALTER TABLE "TenantGroupMember" ADD CONSTRAINT "TenantGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TenantGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantGroupMember" ADD CONSTRAINT "TenantGroupMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTenantAccess" ADD CONSTRAINT "UserTenantAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTenantAccess" ADD CONSTRAINT "UserTenantAccess_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
