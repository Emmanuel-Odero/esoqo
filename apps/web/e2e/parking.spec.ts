import { test, expect } from '@playwright/test';

/**
 * The parking flow end to end, against a real dev server and a real
 * database — console M-Pesa, so the confirmation is the one the app
 * itself performs.
 *
 * Opt-in for the same reason as pay-flow.spec.ts, and for a sharper
 * reason: this one does not just write a payment, it writes a parking
 * session, moves it through OPEN → QUOTED → PAID, and leaves a balanced
 * journal entry. Run with
 *
 *   pnpm --filter @esoqo/web test:parking
 *
 * The lot code below is whatever `pnpm --filter @esoqo/db seed:parking`
 * minted. It is read from the database rather than pasted in, because a
 * hard-coded PRK code would be wrong the moment anyone re-seeded.
 */

// Deliberately not 0712345678. pay-flow.spec.ts uses that number and
// deletes every payment for it when it finishes, and the two files run
// in parallel — sharing it means that file's teardown can delete this
// file's confirmed parking payment while a driver is still staring at
// "check your phone". The number is part of the fixture.
const PAYER = '0722000111';
const FREE_PAYER = '0722000222';
const asMsisdn = (p: string) => `+${p.replace(/^0/, '254')}`;

/** Removes everything this file created. Sessions before payments is not
 *  a preference: a BusinessPayment references the session, and the lot
 *  cannot go while either is standing. Entries before payments for the
 *  same reason the business suite does it.
 *
 *  Both numbers are cleaned, not just PAYER: the grace-period test parks
 *  under its own number so that the two tests cannot collide on the
 *  operator's chase list, and a self-cleaning suite that cleans one of
 *  its own two numbers is not self-cleaning. */
test.afterAll(async () => {
  const { prisma } = await import('@esoqo/db');
  const sessions = await prisma.parkingSession.findMany({
    where: { msisdn: { in: [asMsisdn(PAYER), asMsisdn(FREE_PAYER)] } },
    select: { id: true },
  });
  const ids = sessions.map((s) => s.id);
  const payments = await prisma.businessPayment.findMany({
    where: { parkingSessionId: { in: ids } },
    select: { id: true, journalEntryId: true },
  });
  const entryIds = payments.flatMap((p) => (p.journalEntryId ? [p.journalEntryId] : []));
  if (entryIds.length > 0) await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
  if (payments.length > 0) await prisma.businessPayment.deleteMany({ where: { id: { in: payments.map((p) => p.id) } } });
  if (ids.length > 0) await prisma.parkingSession.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

async function lotCode(): Promise<string> {
  const { prisma } = await import('@esoqo/db');
  const lot = await prisma.parkingLot.findFirst({ where: { active: true }, select: { code: true }, orderBy: { createdAt: 'asc' } });
  await prisma.$disconnect();
  if (!lot) throw new Error('no active parking lot — run: pnpm --filter @esoqo/db seed:parking');
  return lot.code;
}

test.describe('/pay/parking', () => {
  test.skip(!process.env.PAY_E2E, 'set PAY_E2E=1 (pnpm test:parking) — this writes real payments');

  test('the hub offers parking, and the nav survives every page', async ({ page }) => {
    await page.goto('/pay');
    await expect(page.getByRole('heading', { name: 'Pay anyone on Esoqo' })).toBeVisible();
    await page.getByRole('link', { name: /Pay for parking/ }).first().click();
    await expect(page).toHaveURL(/\/pay\/parking$/);
    await expect(page.getByRole('heading', { name: 'Pay for parking' })).toBeVisible();

    // The sub-nav is the reason the layout exists: every destination one
    // tap away, and Parking lit because we are on it.
    const nav = page.getByRole('navigation', { name: 'Payments' });
    for (const label of ['Overview', 'Pay a business', 'Pay a group', 'Transport', 'Parking', 'Help']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
    await expect(nav.getByRole('link', { name: 'Parking' })).toHaveClass(/on/);
  });

  test('a scanned lot code goes straight to check-in, showing the tariff', async ({ page }) => {
    const code = await lotCode();
    await page.goto(`/pay/parking/${code}`);
    await expect(page.getByRole('heading', { name: /Park here/ })).toBeVisible();
    // The rate is the driver's first question at a gate, so it is on
    // screen before any form.
    await expect(page.getByText(/KES \d+ an hour/)).toBeVisible();
  });

  test('a code that is not a car park is refused, not guessed at', async ({ page }) => {
    await page.goto('/pay/parking/nonsense');
    await expect(page.getByText('This page could not be found')).toBeVisible();
  });

  test('check in, get a ticket, check out, pay, and the stay is settled', async ({ page }) => {
    const code = await lotCode();

    // ── check in ────────────────────────────────────────────────────
    await page.goto(`/pay/parking/${code}`);
    await page.getByLabel('M-Pesa number').fill(PAYER);
    await page.getByLabel(/Number plate/).fill('KCB 123A');
    await page.getByRole('button', { name: /Park and text my ticket/ }).click();

    const ticket = page.getByTestId('parking-ticket');
    await expect(ticket).toBeVisible({ timeout: 20_000 });
    const ticketCode = (await ticket.innerText()).trim();
    expect(ticketCode).toMatch(/^PRT-[A-Z2-9]{4}-[A-Z2-9]{2}$/);

    // The ticket is the only credential on this flow, so the page has to
    // be able to show it and not only text it.
    await expect(page.getByRole('button', { name: /Copy ticket/ })).toBeVisible();

    // Backdate the stay *before* quoting it. A session seconds old is
    // inside the grace period, which is a real outcome but the wrong one
    // to test here — the whole point of this case is the money path, and
    // deciding that by which branch a stopwatch happened to fall into
    // makes a test that passes without testing anything. The free case is
    // its own test below.
    {
      const { prisma } = await import('@esoqo/db');
      await prisma.parkingSession.updateMany({
        where: { ticketCode },
        data: { checkedInAt: new Date(Date.now() - (4 * 60 * 60 * 1000)) },
      });
      await prisma.$disconnect();
    }

    // ── the same ticket, found again from the entry page ───────────
    // The path a driver takes when the SMS did not arrive.
    await page.goto('/pay/parking');
    await page.getByLabel('Parking ticket code').fill(ticketCode);
    await page.getByRole('button', { name: /Find my ticket/ }).click();
    await expect(page.getByRole('heading', { name: 'Your parking charge' })).toBeVisible({ timeout: 20_000 });

    // ── pay it ─────────────────────────────────────────────────────
    // Four hours less a ten-minute grace is four commenced hours.
    await expect(page.getByText('KES 200')).toBeVisible();
    await page.getByLabel('Pay with M-Pesa number').fill(PAYER);
    await page.getByRole('button', { name: 'Pay now' }).click();
    // Console M-Pesa confirms itself, so this resolves without a webhook.
    await expect(page.getByRole('heading', { name: 'Parking paid' })).toBeVisible({ timeout: 30_000 });

    // ── and the database agrees ────────────────────────────────────
    const { prisma } = await import('@esoqo/db');
    const session = await prisma.parkingSession.findUnique({
      where: { ticketCode },
      select: { status: true, amountKes: true, payment: { select: { status: true, journalEntryId: true } } },
    });
    expect(session?.status).toBe('PAID');
    expect(Number(session?.amountKes)).toBe(200);
    expect(session?.payment?.status).toBe('CONFIRMED');
    expect(session?.payment?.journalEntryId).toBeTruthy();

    // A settled stay leaves the operator's chase list, which is the
    // difference between a paid car and a car that drove away.
    const { listUnpaidParkingSessions } = await import('@esoqo/db');
    const unpaid = await listUnpaidParkingSessions(code);
    expect(unpaid.map((u) => u.ticketCode)).not.toContain(ticketCode);
    await prisma.$disconnect();
  });

  test('a stay inside the grace period is free and never asks for money', async ({ page }) => {
    const code = await lotCode();
    await page.goto(`/pay/parking/${code}`);
    await page.getByLabel('M-Pesa number').fill(FREE_PAYER);
    await page.getByRole('button', { name: /Park and text my ticket/ }).click();
    const ticket = (await page.getByTestId('parking-ticket').innerText()).trim();

    await page.getByRole('button', { name: /I’m leaving now/ }).click();
    await expect(page.getByRole('heading', { name: 'Nothing to pay' })).toBeVisible();
    // No amount field anywhere on a free stay: there is nothing to enter.
    await expect(page.getByLabel('Pay with M-Pesa number')).toHaveCount(0);
    await expect(page.getByText('KES 0')).toBeVisible();
    expect(ticket).toMatch(/^PRT-/);
  });

  test('a ticket that does not exist says so plainly', async ({ page }) => {
    await page.goto('/pay/parking');
    await page.getByLabel('Parking ticket code').fill('PRT-0000-00');
    await page.getByRole('button', { name: /Find my ticket/ }).click();
    await expect(page.getByText(/cannot find that ticket/i)).toBeVisible();
  });

  test('a lot code is not a ticket', async ({ page }) => {
    const code = await lotCode();
    await page.goto('/pay/parking');
    await page.getByLabel('Parking ticket code').fill(code);
    await page.getByRole('button', { name: /Find my ticket/ }).click();
    // A PRK code must not check a car out of a lot it was never issued
    // for, and must not be mistaken for a valid ticket.
    await expect(page.getByText(/cannot find that ticket/i)).toBeVisible();
  });
});
