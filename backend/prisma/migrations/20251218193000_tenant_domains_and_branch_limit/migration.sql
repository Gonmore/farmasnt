-- Add branch limit to tenant
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "branchLimit" INTEGER NOT NULL DEFAULT 1;

-- TenantDomain table for custom domains
CREATE TABLE IF NOT EXISTS "TenantDomain" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "verifiedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdBy" TEXT,

  CONSTRAINT "TenantDomain_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TenantDomain_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "TenantDomain_domain_key" ON "TenantDomain"("domain");
CREATE INDEX IF NOT EXISTS "TenantDomain_tenantId_idx" ON "TenantDomain"("tenantId");
