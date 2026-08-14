import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Smoke test for /join. Covers step 1 only (WhoAndName) — enough to
 * catch a broken page, a broken merge conflict resolution, or a step
 * component that fails to render, without needing a database.
 */
test.describe('/join', () => {
  test('renders step 1 and lets you pick how you are joining', async ({ page }) => {
    await page.goto('/join');

    await expect(page.getByRole('heading', { name: 'Join Esoko' })).toBeVisible();
    await expect(page.getByText('Step 1 of 4')).toBeVisible();
    await expect(page.getByRole('heading', { name: "Who's joining, and what's your name?" })).toBeVisible();

    // "Continue" starts disabled — nothing picked yet.
    const continueBtn = page.getByRole('button', { name: 'Continue' });
    await expect(continueBtn).toBeDisabled();

    // Picking "Myself" reveals the name fields and unlocks Continue.
    await page.getByRole('button', { name: /^Myself/ }).click();
    await expect(page.getByLabel('Official name')).toBeVisible();
    await expect(continueBtn).toBeEnabled();
  });

  test('picking "A group" reveals the group role field, not a group name field', async ({ page }) => {
    await page.goto('/join');
    await page.getByRole('button', { name: /^A group/ }).click();
    // The group's own name/type/location is resolved later, in step 3's
    // search-before-create — step 1 only asks the registrant's own name
    // and their role, so nobody types the group's name twice.
    await expect(page.getByLabel('Your role in the group')).toBeVisible();
    await expect(page.getByLabel('Official name of the group')).toHaveCount(0);
    await expect(page.getByLabel('Official name')).toBeVisible();
  });

  test('picking an institution routes to the "not here" screen', async ({ page }) => {
    await page.goto('/join');
    await page.getByRole('button', { name: /^A bank, county, buyer or agency/ }).click();
    await expect(page.getByRole('heading', { name: 'Institutions do not register here' })).toBeVisible();
  });

  test('has no automatically detectable accessibility violations', async ({ page }) => {
    await page.goto('/join');
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
