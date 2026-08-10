import { PrismaClient } from '@prisma/client';
import { appEnv } from '@esoko/domain';

/**
 * Run-mode database selection.
 *
 * APP_ENV=LOCAL_TEST_PROD rehearses a production release from a dev box:
 * the production URL every app .env already carries as PROD_DATABASE_URL
 * is swapped in before anything else reads DATABASE_URL. Prisma reads its
 * datasource url from process.env at client construction — this module is
 * the only place a client is built, so normalising here is safe.
 */
export function selectDatabaseUrl(): void {
  if (appEnv() === 'LOCAL_TEST_PROD' && process.env.PROD_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.PROD_DATABASE_URL;
    process.env.DIRECT_DATABASE_URL ??= process.env.PROD_DATABASE_URL;
  }
}

const LOCAL_DB_HOSTS = ['localhost', '127.0.0.1', '::1', 'pgbouncer', 'postgres', 'db'];

/**
 * The ONLY place a PrismaClient is constructed.
 *
 * Nothing outside this package may import @prisma/client — see the
 * `no-restricted-imports` rule in packages/config/eslint. That rule is
 * the reason the Data Access Layer cannot be quietly bypassed by a
 * future contributor who is in a hurry.
 */
const globalForPrisma = globalThis as unknown as { __esokoPrisma?: PrismaClient };

selectDatabaseUrl();

// A dev box must never write to production: development is the only mode
// allowed to run against a clearly-local host. The alternative is a
// destroyed production table from one stray `npx prisma migrate`. Switch
// to APP_ENV=LOCAL_TEST_PROD (or production) to run against the real DB.
if (appEnv() === 'development') {
  const host = /@([^:/?#]+)/.exec(process.env.DATABASE_URL ?? '')?.[1];
  if (host && !LOCAL_DB_HOSTS.includes(host)) {
    throw new Error(
      `APP_ENV=development forbids a remote DATABASE_URL (host "${host}"). ` +
        'Set APP_ENV=LOCAL_TEST_PROD to test against the production database.',
    );
  }
}

export const prisma =
  globalForPrisma.__esokoPrisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.__esokoPrisma = prisma;

export type { Prisma } from '@prisma/client';
