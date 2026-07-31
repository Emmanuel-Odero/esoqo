-- DropIndex
DROP INDEX "registration_msisdn_idx";

-- CreateIndex
CREATE INDEX "registration_msisdn_status_idx" ON "registration"("msisdn", "status");
