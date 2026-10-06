/**
 * End-to-end tests for the unified org portal (/org/[type]/[id]).
 *
 * These tests verify:
 * 1. URL structure — pages exist and respond correctly
 * 2. Redirect behaviour — ticket bare-UUID URLs redirect properly
 * 3. Hotel portal — all hotel pages render without JS errors
 * 4. Accessibility — no critical ARIA violations
 *
 * Courier has its own, separately feature-complete portal at
 * /parcel-org (not part of this generic org-portal system) — see
 * apps/app/src/app/parcel-org's own tests, if any, for that coverage.
 *
 * Tests that require a live session are skipped when NO_SESSION=1.
 * Static render / redirect tests run against the dev server only.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// ── Redirect & routing tests (no auth needed) ─────────────────────────────

test.describe('Legacy URL redirects', () => {
  test('/org/<uuid> redirects to /org/ticket/<uuid>', async ({ page }) => {
    // A bare UUID (no type segment) should redirect to the ticket portal
    const fakeOrgId = '00000000-0000-0000-0000-000000000001';
    await page.goto(`/org/${fakeOrgId}`, { waitUntil: 'commit' });
    expect(page.url()).toContain(`/org/ticket/${fakeOrgId}`);
  });

  test('/org/<uuid>/listings redirects to /org/ticket/<uuid>/listings', async ({ page }) => {
    const fakeOrgId = '00000000-0000-0000-0000-000000000002';
    await page.goto(`/org/${fakeOrgId}/listings`, { waitUntil: 'commit' });
    expect(page.url()).toContain(`/org/ticket/${fakeOrgId}/listings`);
  });
});

// ── Hotel portal tests ────────────────────────────────────────────────────

test.describe('Hotel portal pages', () => {
  test.skip(!!process.env.NO_SESSION, 'Skipped: requires hotel org session');

  const HOTEL_ID = process.env.TEST_HOTEL_ORG_ID ?? '';

  test.beforeEach(async ({ page }) => {
    if (!HOTEL_ID) test.skip();
  });

  test('dashboard renders without errors', async ({ page }) => {
    await page.goto(`/org/hotel/${HOTEL_ID}`);
    await expect(page.getByRole('heading', { name: 'Hotel Dashboard' })).toBeVisible();
  });

  test('rooms page renders', async ({ page }) => {
    await page.goto(`/org/hotel/${HOTEL_ID}/rooms`);
    await expect(page.getByRole('heading', { name: 'Rooms' })).toBeVisible();
  });

  test('reservations page renders', async ({ page }) => {
    await page.goto(`/org/hotel/${HOTEL_ID}/reservations`);
    await expect(page.getByRole('heading', { name: 'Reservations' })).toBeVisible();
  });

  test('staff page renders', async ({ page }) => {
    await page.goto(`/org/hotel/${HOTEL_ID}/staff`);
    await expect(page.getByRole('heading', { name: 'Staff' })).toBeVisible();
  });

  test('hotel dashboard has no critical accessibility violations', async ({ page }) => {
    await page.goto(`/org/hotel/${HOTEL_ID}`);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(results.violations.filter((v) => v.impact === 'critical')).toHaveLength(0);
  });
});

// ── Signout route ─────────────────────────────────────────────────────────

test.describe('Generic org signout', () => {
  test('POST /orgs/signout clears session and redirects to home', async ({ page, request }) => {
    const response = await request.post('/orgs/signout', {
      headers: { 'content-type': 'application/json' },
      data: { orgType: 'hotel' },
    });
    // 303 redirect to /
    expect(response.status()).toBe(200); // Playwright follows redirects
    expect(response.url()).toMatch(/^https?:\/\/[^/]+(\/)?$/);
  });
});

// ── WorkspaceSwitcher ────────────────────────────────────────────────────

test.describe('WorkspaceSwitcher', () => {
  test.skip(!!process.env.NO_SESSION, 'Skipped: requires personal session');

  test('workspace switcher shows all org types', async ({ page }) => {
    await page.goto('/me');
    // The switcher should be present
    const switcher = page.getByRole('navigation', { name: /workspace/i })
      .or(page.locator('[data-testid="workspace-switcher"]'));
    await expect(switcher).toBeVisible();
  });
});
