-- AlterTable
ALTER TABLE "organisation" ADD COLUMN "mallSlug" TEXT;
CREATE UNIQUE INDEX "organisation_mallSlug_key" ON "organisation"("mallSlug");

-- CreateTable
CREATE TABLE "mall_tenancy" (
    "id" UUID NOT NULL,
    "mallOrgId" UUID NOT NULL,
    "tenantEnterpriseId" UUID NOT NULL,
    "unitLabel" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "mall_tenancy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mall_tenancy_mallOrgId_tenantEnterpriseId_key" ON "mall_tenancy"("mallOrgId", "tenantEnterpriseId");
CREATE INDEX "mall_tenancy_tenantEnterpriseId_idx" ON "mall_tenancy"("tenantEnterpriseId");

-- AddForeignKey
ALTER TABLE "mall_tenancy" ADD CONSTRAINT "mall_tenancy_mallOrgId_fkey" FOREIGN KEY ("mallOrgId") REFERENCES "organisation"("partyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mall_tenancy" ADD CONSTRAINT "mall_tenancy_tenantEnterpriseId_fkey" FOREIGN KEY ("tenantEnterpriseId") REFERENCES "enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
