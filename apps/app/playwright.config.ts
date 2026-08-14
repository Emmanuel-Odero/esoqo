import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke/a11y config.
 *
 * These are not a full end-to-end suite — no test here submits a Server
 * Action or touches the database. They exist to catch "the page doesn't
 * render" and "a screen reader can't operate this" before either ships,
 * without needing seeded data or a live DB connection to run.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
