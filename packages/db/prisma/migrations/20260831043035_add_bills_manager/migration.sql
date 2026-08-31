-- CreateTable
CREATE TABLE "bill" (
    "id" UUID NOT NULL,
    "partyId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "accountRef" TEXT,
    "amountKes" DECIMAL(12,2),
    "cycle" TEXT NOT NULL,
    "nextDueAt" TIMESTAMP(3) NOT NULL,
    "reminderDaysBefore" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_payment" (
    "id" UUID NOT NULL,
    "billId" UUID NOT NULL,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "bill_payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bill_partyId_status_idx" ON "bill"("partyId", "status");

-- CreateIndex
CREATE INDEX "bill_payment_billId_paidAt_idx" ON "bill_payment"("billId", "paidAt");

-- AddForeignKey
ALTER TABLE "bill" ADD CONSTRAINT "bill_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payment" ADD CONSTRAINT "bill_payment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
