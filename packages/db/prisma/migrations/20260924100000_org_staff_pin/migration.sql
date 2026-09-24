-- Create org_staff_pin table for PIN-based authentication
-- This allows org staff to authenticate using a PIN code instead of full credentials
-- Stored as hash for security (bcrypt/scrypt depending on implementation)

CREATE TABLE "org_staff_pin" (
  "id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "staffId" UUID NOT NULL REFERENCES "org_staff"("id") ON DELETE CASCADE,
  "pinHash" TEXT NOT NULL,                       -- Hashed PIN (bcrypt/scrypt)
  "pinSalt" TEXT NOT NULL,                       -- Salt used for hashing
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,  -- Track failed PIN attempts for lockout
  "lockedUntil" TIMESTAMP,                       -- Account lockout time if too many failures
  "lastUsedAt" TIMESTAMP,                        -- Track when PIN was last used
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE("staffId")
);

CREATE INDEX "org_staff_pin_staff_id_idx" ON "org_staff_pin"("staffId");
CREATE INDEX "org_staff_pin_locked_until_idx" ON "org_staff_pin"("lockedUntil") WHERE "lockedUntil" IS NOT NULL;