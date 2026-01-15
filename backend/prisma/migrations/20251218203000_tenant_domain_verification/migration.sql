ALTER TABLE "TenantDomain" ADD COLUMN IF NOT EXISTS "verificationToken" TEXT;
ALTER TABLE "TenantDomain" ADD COLUMN IF NOT EXISTS "verificationTokenExpiresAt" TIMESTAMPTZ;
