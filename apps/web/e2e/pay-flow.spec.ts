import { test, expect } from '@playwright/test';

const PORT = Number(process.env.PAY_PORT ?? 3123);
const BASE = process.env.PAY_BASE ?? `http://localhost:${PORT}`;

/**
 * The /pay flow as a customer actually meets it, against a real dev
 * server and a real database — console M-Pesa, so the confirmation is
 * the one the app itself performs rather than a webhook nobody sends.
 *
 * Not part of the render/a11y smoke suite: the second test here writes a
 * CONFIRMED payment and a balanced journal entry, which is the whole
 * point and also why it has to be asked for. Run it with
 *
 *   pnpm --filter @esoqo/web test:pay
 *
 * which sets PAY_E2E=1 and starts the dev server in console mode.
 * Without that it skips, so it can never move money in CI by accident.
 *
 * The business codes below are the ones the seed issues; if the seed
 * changes, so does this file.
 */
const PAYEE = 'kilimani482';
const PERSON = 'amina482';
const PAYER = '0712345678';

/** Nothing this file creates is left in the database.
 *
 *  The entry has to be deleted before the payment: the foreign key runs
 *  the other way, so removing the payment would leave the entry and its
 *  two postings behind, still counted against the account balances.
 *  Postings cascade from the entry. */
test.afterAll(async () => {
  const { prisma } = await import('@esoqo/db');
  const msisdn = `+${PAYER.replace(/^0/, '254')}`;
  const rows = await prisma.businessPayment.findMany({
    where: { payerMsisdn: msisdn },
    select: { id: true, journalEntryId: true },
  });
  const entryIds = rows.flatMap((r) => (r.journalEntryId ? [r.journalEntryId] : []));
  if (entryIds.length > 0) {
    await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
  }
  await prisma.businessPayment.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  await prisma.$disconnect();
});

test.describe('/pay', () => {
  test.skip(!process.env.PAY_E2E, 'set PAY_E2E=1 (pnpm test:pay) — this writes real payments');

  test('a scanned stand opens on the payee with the amount prefilled', async ({ page }) => {
    await page.goto(`${BASE}/pay?to=${PAYEE}&amount=1500`);

    await expect(page.getByRole('heading', { name: /Pay Kilimani Chama/ })).toBeVisible();
    await expect(page.getByText('BUSINESS FOUND')).toBeVisible();
    await expect(page.getByLabel('Amount (KES)')).toHaveValue('1500');
    await expect(page.getByText(PAYEE).first()).toBeVisible();
  });

  test('a payer pays with M-Pesa and gets a receipt', async ({ page }) => {
    await page.goto(`${BASE}/pay?to=${PAYEE}&amount=1500`);
    await page.getByLabel('Your M-Pesa number').fill(PAYER);
    await page.getByRole('button', { name: /^Pay KES/ }).click();

    await expect(page.getByRole('heading', { name: 'Payment received' })).toBeVisible({ timeout: 45000 });
    await expect(page.getByText('1,500')).toBeVisible();
    await expect(page.getByText(/paid to Kilimani Chama/)).toBeVisible();

    const esoqo = await page.locator('text=ESOQO RECEIPT').locator('xpath=following-sibling::p[1]').innerText();
    const mpesa = await page.locator('text=M-PESA RECEIPT').locator('xpath=following-sibling::p[1]').innerText();
    expect(esoqo).toMatch(/^BP-[A-Z0-9]{8,}$/);
    expect(mpesa).toMatch(/^CNS[A-Z0-9]+$/);
    // Esoqo's reference and Safaricom's are different references.
    expect(esoqo).not.toBe(mpesa);
  });

  test('the page can be started from a typed name', async ({ page }) => {
    // /pay/business, not /pay. /pay is the hub now — it answers "what
    // can I pay?" and has no lookup form on it — while ?to= still
    // short-circuits straight to the payee, and this test is about the
    // lookup step rather than about where it lives.
    await page.goto(`${BASE}/pay/business`);
    await page.getByLabel('Business identifier').fill('Umoja Boda');
    await page.getByRole('button', { name: 'Find' }).click();
    await expect(page.getByText('BUSINESS FOUND')).toBeVisible();
    await expect(page.getByText('Umoja Boda').first()).toBeVisible();
  });

  // The hub replaced the lookup form on /pay, and this is the contract
  // that made that safe: a printed QR and a texted link open the payee
  // directly, with no menu in the way. If this breaks, every stand in
  // the country stops working.
  test('a scanned link still goes straight to the payee, not the hub', async ({ page }) => {
    await page.goto(`${BASE}/pay?to=${PAYEE}`);
    await expect(page.getByRole('heading', { name: /Pay Kilimani Chama/ })).toBeVisible();
    await expect(page.getByText('BUSINESS FOUND')).toBeVisible();
    // The hub's own heading must not be on the page behind it.
    await expect(page.getByRole('heading', { name: 'Pay anyone on Esoqo' })).toHaveCount(0);
  });

  test('the short link /pay/<ID> still forwards', async ({ page }) => {
    await page.goto(`${BASE}/pay/${PAYEE}`);
    await expect(page.getByRole('heading', { name: /Pay Kilimani Chama/ })).toBeVisible({ timeout: 20000 });
  });

  test('/pay without a payee is the hub, and every destination works', async ({ page }) => {
    await page.goto(`${BASE}/pay`);
    await expect(page.getByRole('heading', { name: 'Pay anyone on Esoqo' })).toBeVisible();
    // No lookup form on the hub: arriving with no destination should
    // offer a choice of jobs, not an empty search box.
    await expect(page.getByLabel('Business identifier')).toHaveCount(0);
  });

  test("a personal Esoqo ID says why it cannot be paid", async ({ page }) => {
    await page.goto(`${BASE}/pay?to=${PERSON}`);
    await expect(page.getByText(/not a business that can take payments/)).toBeVisible();
  });

  // The button is the guard, not an error message after the fact: a
  // customer on a phone with a flaky connection should not be able to
  // press Pay and then be told they were wrong. The handlers still check
  // — a tampered form submit is not the same as a disabled button.
  test('Pay stays disabled until there is an amount and a number', async ({ page }) => {
    await page.goto(`${BASE}/pay?to=${PAYEE}`);
    const pay = page.getByRole('button', { name: /^Pay KES/ });
    await expect(pay).toBeDisabled();

    await page.getByLabel('Amount (KES)').fill('500');
    await expect(pay).toBeDisabled();

    await page.getByLabel('Your M-Pesa number').fill(PAYER);
    await expect(pay).toBeEnabled();

    await page.getByLabel('Amount (KES)').fill('');
    await expect(pay).toBeDisabled();
  });
});
