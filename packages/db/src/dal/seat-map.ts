import { prisma } from '../client';
import { type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { assertOwnsOrg } from './ticketing';
import { TicketingError } from './ticketing';

/**
 * The bus/coach seat-map builder — a one-time layout per listing
 * ("11 rows of 2+2") that createSchedule (dal/ticketing.ts) replays
 * onto every new occurrence, and the org console re-renders to let the
 * organiser repaint which ticket class owns which seat (all one price,
 * or a few rows carved out as a pricier comfort class).
 */

export interface SaveSeatMapInput {
  rows: number;
  pattern: string;
  /** One entry per painted seat — a seat left out of this list simply
   *  doesn't exist on the map (e.g. an aisle-side blank the organiser
   *  chose not to sell). */
  seats: { label: string; ticketClassId: string }[];
}

/** Replaces the whole map in one go — simplest correct model for a
 *  builder UI that submits the full grid each save, and cheap enough
 *  (a few dozen rows) not to bother diffing. Only touches *future*
 *  schedules; seats already generated for an existing occurrence are
 *  untouched, same as a TicketClass price edit never rewriting past
 *  bookings. */
export async function saveSeatMap(ctx: Ctx, listingId: string, input: SaveSeatMapInput) {
  const listing = await prisma.listing.findUnique({ where: { id: listingId }, include: { ticketClasses: true } });
  if (!listing) throw new TicketingError('Listing not found', 'NOT_FOUND');
  await assertOwnsOrg(ctx, listing.orgId, 'ticketclass.write');

  if (input.rows < 1 || input.rows > 60) throw new TicketingError('Rows must be between 1 and 60', 'BAD_INPUT');
  if (input.seats.length === 0) throw new TicketingError('Paint at least one seat', 'BAD_INPUT');

  const classIds = new Set(listing.ticketClasses.filter((c) => c.seated).map((c) => c.id));
  for (const s of input.seats) {
    if (!classIds.has(s.ticketClassId)) throw new TicketingError('One of these ticket classes is not a seated class on this listing', 'BAD_INPUT');
  }

  const seatMap = await prisma.$transaction(async (tx) => {
    const map = await tx.seatMap.upsert({
      where: { listingId },
      update: { rows: input.rows, pattern: input.pattern },
      create: { listingId, rows: input.rows, pattern: input.pattern },
    });

    // Full replace — delete then recreate, same reasoning as the
    // module comment above.
    await tx.seatMapSeat.deleteMany({ where: { seatMapId: map.id } });
    await tx.seatMapSeat.createMany({
      data: input.seats.map((s) => ({ seatMapId: map.id, ticketClassId: s.ticketClassId, label: s.label })),
    });

    // Keep TicketClass.capacity in sync with what the map actually
    // assigns, so the "N seats per occurrence" summary stays honest —
    // a class painted onto 8 seats shouldn't still claim capacity 44
    // from before the map existed.
    const countByClass = new Map<string, number>();
    for (const s of input.seats) countByClass.set(s.ticketClassId, (countByClass.get(s.ticketClassId) ?? 0) + 1);
    for (const [ticketClassId, count] of countByClass) {
      await tx.ticketClass.update({ where: { id: ticketClassId }, data: { capacity: count } });
    }

    return map;
  });

  await recordAudit(ctx, { action: 'seatmap.saved', targetType: 'seat_map', targetId: seatMap.id, payload: { listingId, seatCount: input.seats.length } });
  return seatMap;
}

export async function getSeatMap(ctx: Ctx, listingId: string) {
  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) throw new TicketingError('Listing not found', 'NOT_FOUND');
  await assertOwnsOrg(ctx, listing.orgId, 'ticketclass.write');

  return prisma.seatMap.findUnique({ where: { listingId }, include: { seats: true } });
}
