-- ParcelCourier.vehicleType reuses ParcelTransportMode (see that
-- model's own comment) rather than a parallel near-duplicate enum —
-- needs two modes a pricing-suggestion bracket never used but a real
-- courier still rides.

-- AlterEnum
ALTER TYPE "ParcelTransportMode" ADD VALUE 'BICYCLE';
ALTER TYPE "ParcelTransportMode" ADD VALUE 'ON_FOOT';
