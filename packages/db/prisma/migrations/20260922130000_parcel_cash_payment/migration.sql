-- Who confirmed a cash payment at the counter — same audit shape as
-- refundedByStaffId/cancelledByStaffId. Null for MPESA_STK/ESOKO_POINTS.
ALTER TABLE "parcel" ADD COLUMN "paidByStaffId" UUID;
