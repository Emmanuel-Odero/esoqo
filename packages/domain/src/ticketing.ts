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

export const createTicketClassSchema = z.object({
  listingId: z.string().uuid(),
  name: z.string().trim().min(2).max(60),
  priceKes: kesSchema,
  capacity: z.coerce.number().int().positive().max(5000),
  seated: z.coerce.boolean().optional(),
});
export type CreateTicketClassInput = z.infer<typeof createTicketClassSchema>;

export const createScheduleSchema = z.object({
  listingId: z.string().uuid(),
  departAt: z.coerce.date(),
  arriveAt: z.coerce.date().optional(),
  gateInfo: z.string().trim().max(120).optional(),
  vehicleOrHallLabel: z.string().trim().max(80).optional(),
});
export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;

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
  paymentMethod: z.enum(['MPESA_STK', 'CASH']),
  lines: z.array(bookingLineSchema).min(1, 'Add at least one ticket').max(20),
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
