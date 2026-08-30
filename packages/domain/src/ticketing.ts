import { z } from 'zod';
import { msisdnSchema } from './phone';

/** ONE definition of every ticketing input, shared by the client form
 *  and the Server Action's boundary validation. See
 *  docs/proposals/esoko-ticketing-platform.md. */

const kesSchema = z.coerce.number().positive('Enter an amount above zero').max(10_000_000);
const nameSchema = z.string().trim().min(2, 'Enter a name').max(120);

export const createTicketOrgSchema = z.object({
  enterpriseId: z.string().uuid(),
  name: nameSchema,
  vertical: z.enum(['EVENTS', 'TRANSPORT']),
  contactPhone: msisdnSchema.optional(),
  contactEmail: z.string().trim().email().optional(),
});
export type CreateTicketOrgInput = z.infer<typeof createTicketOrgSchema>;

export const createVenueSchema = z.object({
  orgId: z.string().uuid(),
  name: nameSchema,
  address: z.string().trim().max(200).optional(),
  county: z.string().trim().max(60).optional(),
  capacity: z.coerce.number().int().positive().optional(),
});
export type CreateVenueInput = z.infer<typeof createVenueSchema>;

export const createRouteSchema = z.object({
  orgId: z.string().uuid(),
  originName: z.string().trim().min(2).max(80),
  destinationName: z.string().trim().min(2).max(80),
  distanceKm: z.coerce.number().int().positive().optional(),
});
export type CreateRouteInput = z.infer<typeof createRouteSchema>;

export const createListingSchema = z.object({
  orgId: z.string().uuid(),
  title: nameSchema,
  description: z.string().trim().max(2000).optional(),
  coverImageUrl: z.string().trim().url().optional(),
  venueId: z.string().uuid().optional(),
  routeId: z.string().uuid().optional(),
});
export type CreateListingInput = z.infer<typeof createListingSchema>;

/** Fixed perk tags a ticket class can offer — a closed set so the
 *  public listing renders consistent badges instead of parsing
 *  arbitrary buyer-facing copy. Anything else goes in amenityNote. */
export const AMENITY_TAGS = ['WIFI', 'SNACKS', 'CHARGING', 'RECLINING', 'EXTRA_LEGROOM', 'BLANKET'] as const;
export type AmenityTag = (typeof AMENITY_TAGS)[number];

export const createTicketClassSchema = z.object({
  listingId: z.string().uuid(),
  name: z.string().trim().min(2).max(60),
  priceKes: kesSchema,
  capacity: z.coerce.number().int().positive().max(5000),
  seated: z.coerce.boolean().optional(),
  amenities: z.array(z.enum(AMENITY_TAGS)).max(AMENITY_TAGS.length).optional(),
  amenityNote: z.string().trim().max(120).optional(),
});
export type CreateTicketClassInput = z.infer<typeof createTicketClassSchema>;

/// "1+1" | "2+1" | "2+2" | "3+2" — seats either side of the aisle.
export const SEAT_MAP_PATTERNS = ['1+1', '2+1', '2+2', '3+2'] as const;
export type SeatMapPattern = (typeof SEAT_MAP_PATTERNS)[number];

export const saveSeatMapSchema = z.object({
  listingId: z.string().uuid(),
  rows: z.coerce.number().int().min(1).max(60),
  pattern: z.enum(SEAT_MAP_PATTERNS),
  seats: z.array(z.object({
    label: z.string().trim().min(1).max(10),
    ticketClassId: z.string().uuid(),
  })).min(1, 'Paint at least one seat').max(600),
});
export type SaveSeatMapInput = z.infer<typeof saveSeatMapSchema>;

/** Seat columns either side of the aisle for a pattern — "2+2" is A,B
 *  | aisle | C,D. Column letters run continuously left to right, so
 *  "3B" always means row 3, second seat from the left. Shared by the
 *  organiser's seat-map builder and the public booking page's seat
 *  picker, so a buyer sees exactly the layout the organiser painted. */
const SEAT_COLUMN_LETTERS = 'ABCDEFG';
export function columnsForPattern(pattern: string): { left: string[]; right: string[] } {
  const [l, r] = pattern.split('+').map(Number);
  const left = SEAT_COLUMN_LETTERS.slice(0, l || 0).split('');
  const right = SEAT_COLUMN_LETTERS.slice(l || 0, (l || 0) + (r || 0)).split('');
  return { left, right };
}

export const createScheduleSchema = z.object({
  listingId: z.string().uuid(),
  departAt: z.coerce.date(),
  arriveAt: z.coerce.date().optional(),
  gateInfo: z.string().trim().max(120).optional(),
  vehicleOrHallLabel: z.string().trim().max(80).optional(),
});
export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;

/** "Lipia pole pole" installment plans. A trip must be at least this
 *  many hours away to open a plan, and every payment (deposit or
 *  top-up) is at least MIN_INSTALLMENT_KES. */
export const INSTALLMENT_MIN_LEAD_HOURS = 48;
export const MIN_INSTALLMENT_KES = 100;

/** Smallest deposit that opens a plan — `percent` of the total, never
 *  below MIN_INSTALLMENT_KES. `percent` is the organiser's
 *  TicketOrg.minDepositPercent. */
export function minDepositKes(totalKes: number, percent: number): number {
  return Math.max(MIN_INSTALLMENT_KES, Math.ceil((totalKes * percent) / 100));
}

export const bookingPaymentPlanSchema = z.object({
  plan: z.enum(['FULL', 'INSTALLMENT']).default('FULL'),
  /** Required (and only used) when plan is INSTALLMENT. */
  depositKes: z.coerce.number().positive().optional(),
});

export const payBookingBalanceSchema = z.object({
  bookingId: z.string().uuid(),
  amountKes: kesSchema,
});
export type PayBookingBalanceInput = z.infer<typeof payBookingBalanceSchema>;

export const bookingLineSchema = z.object({
  ticketClassId: z.string().uuid(),
  seatId: z.string().uuid().optional(),
  holderName: z.string().trim().max(120).optional(),
  holderMsisdn: z.string().trim().max(20).optional(),
});

export const createBookingSchema = z.object({
  scheduleId: z.string().uuid(),
  buyerName: nameSchema,
  buyerMsisdn: msisdnSchema,
  buyerEmail: z.string().trim().toLowerCase().email('Enter a valid email address').max(160).optional().or(z.literal('')),
  paymentMethod: z.enum(['MPESA_STK', 'CASH']),
  lines: z.array(bookingLineSchema).min(1, 'Add at least one ticket').max(20),
  /** Omitted = pay the full amount now (the default). `INSTALLMENT`
   *  opens a "lipia pole pole" plan — see dal/ticketing.ts createBooking. */
  payment: bookingPaymentPlanSchema.optional(),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const createTicketOrgStaffSchema = z.object({
  orgId: z.string().uuid(),
  name: nameSchema,
  pin: z.string().trim().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits'),
  role: z.enum(['ADMIN', 'MANAGER', 'SCANNER']),
});
export type CreateTicketOrgStaffInput = z.infer<typeof createTicketOrgStaffSchema>;

export const ticketOrgStaffSignInSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(80),
  pin: z.string().regex(/^\d{4,6}$/, 'Enter your PIN'),
});
export type TicketOrgStaffSignInInput = z.infer<typeof ticketOrgStaffSignInSchema>;

export const checkInTicketSchema = z.object({
  orgId: z.string().uuid(),
  code: z.string().trim().min(4).max(40),
});
export type CheckInTicketInput = z.infer<typeof checkInTicketSchema>;
