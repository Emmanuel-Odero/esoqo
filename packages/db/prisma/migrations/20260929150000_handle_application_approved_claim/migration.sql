-- Adds the claim type used when staff approve a business/chama/
-- organisation's application to claim its own esoqo ID handle (see
-- dal/handle-application.ts). Distinct from ORG_PAGE_VERIFIED, which is
-- about a Jamii community page, not a payment handle.

-- AlterEnum
ALTER TYPE "ClaimType" ADD VALUE IF NOT EXISTS 'HANDLE_APPLICATION_APPROVED';
