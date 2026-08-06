import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Smoke test for /signin. Only exercises client-side state (button
 * enable/disable) — no test here calls actionSignIn, so it needs no
 * database or seeded account to run.
 */
test.describe('/signin', () => {
  test('renders the sign-in form', async ({ page }) => {
    await page.goto('/signin');

    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByLabel('Phone number or email')).toBeVisible();
    await expect(page.getByLabel('PIN')).toBeVisible();

    const signInBtn = page.getByRole('button', { name: /Sign in/ });
    await expect(signInBtn).toBeDisabled();

    await page.getByLabel('Phone number or email').fill('+254712345678');
    await page.getByLabel('PIN').fill('123456');
    await expect(signInBtn).toBeEnabled();
  });

  test('links to "Set your PIN"', async ({ page }) => {
    await page.goto('/signin');
    await page.getByRole('link', { name: /Set your PIN/ }).click();
    await expect(page).toHaveURL(/\/signin\/set-pin$/);
  });

  test('has no automatically detectable accessibility violations', async ({ page }) => {
    await page.goto('/signin');
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
