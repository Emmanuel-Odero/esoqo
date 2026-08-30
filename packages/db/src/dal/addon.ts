import { prisma } from '../client';
import { type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { assertOwnsOrg, TicketingError } from './ticketing';

/**
 * Paid ticket add-ons — "WiFi KES 100", "Snacks KES 200", "Lunch KES
 * 500". Organiser-defined per listing (dal/ticketing.ts's amenities
 * are the free, baked-into-the-price perks; an Addon is its own paid
 * line item a buyer opts a specific ticket into at checkout). Same
 * write boundary as a ticket class — 'ticketclass.write' — since this
 * is the same kind of listing-configuration action.
 */

export interface CreateAddonInput {
  name: string;
  priceKes: number;
}

export async function createAddon(ctx: Ctx, listingId: string, input: CreateAddonInput) {
  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) throw new TicketingError('Listing not found', 'NOT_FOUND');
  await assertOwnsOrg(ctx, listing.orgId, 'ticketclass.write');
  if (input.priceKes <= 0) throw new TicketingError('Price must be above zero', 'BAD_INPUT');

  const addon = await prisma.addon.create({
    data: { listingId, name: input.name, priceKes: input.priceKes },
  });
  await recordAudit(ctx, { action: 'addon.created', targetType: 'addon', targetId: addon.id, payload: { listingId } });
  return addon;
}

export async function setAddonActive(ctx: Ctx, addonId: string, active: boolean) {
  const addon = await prisma.addon.findUnique({ where: { id: addonId }, include: { listing: true } });
  if (!addon) throw new TicketingError('Package not found', 'NOT_FOUND');
  await assertOwnsOrg(ctx, addon.listing.orgId, 'ticketclass.write');

  const updated = await prisma.addon.update({ where: { id: addonId }, data: { active } });
  await recordAudit(ctx, { action: 'addon.status_changed', targetType: 'addon', targetId: addonId, payload: { active } });
  return updated;
}
