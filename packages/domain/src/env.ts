/**
 * Deployment context selector — the single switch that decides whether
 * external services (database, file storage, SMS, M-Pesa) hit local
 * throwaway targets or the production ones, so a dev box can never
 * accidentally write to production.
 *
 *   APP_ENV=development      (default) — local database, local file
 *     storage, console SMS and M-Pesa. Stays local even when production
 *     credentials are present in .env.
 *   APP_ENV=LOCAL_TEST_PROD  — run locally against production details:
 *     production database (PROD_DATABASE_URL), real R2 (sandbox OTP /
 *     M-Pesa). For rehearsing a production release before the switch.
 *   APP_ENV=production       — real everything (Render).
 */
export type AppEnv = 'development' | 'LOCAL_TEST_PROD' | 'production';

let cached: AppEnv | undefined;

export function appEnv(): AppEnv {
  if (cached) return cached;
  switch ((process.env.APP_ENV ?? 'development').trim().toUpperCase()) {
    case 'LOCAL_TEST_PROD':
    case 'LOCAL_TEST_PRODUCTION':
      cached = 'LOCAL_TEST_PROD';
      break;
    case 'PRODUCTION':
    case 'PROD':
      cached = 'production';
      break;
    default:
      cached = 'development';
  }
  return cached;
}

/** True in LOCAL_TEST_PROD — testing production details from a dev box. */
export function isTestingProduction(): boolean {
  return appEnv() === 'LOCAL_TEST_PROD';
}

/** True only in real production (Render). */
export function isProduction(): boolean {
  return appEnv() === 'production';
}