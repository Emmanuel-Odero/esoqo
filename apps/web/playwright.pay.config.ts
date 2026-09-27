import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PAY_PORT ?? 3123);
const BASE = process.env.PAY_BASE ?? `http://localhost:${PORT}`;

/**
 * /pay browser checks.
 *
 * Separate from the render/a11y smoke suite on purpose. Those tests, in
 * apps/app, exist to catch "the page doesn't render" without seeded data
 * or a database — this one does the opposite: it fills in an amount, a
 * phone number, presses Pay, and leaves a CONFIRMED row with a balanced
 * journal entry in whatever database the dev server is pointed at. That
 * is the only way to prove the chain works, and it is also the reason it
 * must not run by accident alongside a lint-and-render pass.
 *
 * So it is opt-in via PAY_E2E=1 (see the test:pay script) and skips
 * itself otherwise, and the dev server it starts is pinned to the
 * console M-Pesa provider so a test run cannot push a prompt at
 * Safaricom. The sandbox provider is the reason this needs saying: it
 * accepts a push and then never calls back, because nothing approves
 * the prompt, so the payer page correctly waits and then times out.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.PAY_E2E
    ? {
        // The port is one value in two places, on purpose: a command that
        // starts a server on a different port than the config then waits
        // for fails with a bare "process was not able to start", which
        // says nothing about the real problem.
        command: `MPESA_PROVIDER=console npx next dev -p ${PORT}`,
        url: BASE,
        // Not `!process.env.CI`. A dev server left over from earlier in
        // the day is listening on this port, Playwright reuses it, and
        // the suite quietly asserts against whatever that process last
        // compiled — which is how a run reports four failures for code
        // that passes the next four times. A payment suite has to be
        // testing the code on disk, so always boot a fresh one and pay
        // the ~10s.
        reuseExistingServer: false,
        timeout: 90_000,
      }
    : undefined,
});
