import { PrismaClient } from '@prisma/client';

/**
 * The ONLY place a PrismaClient is constructed.
 *
 * Nothing outside this package may import @prisma/client — see the
 * `no-restricted-imports` rule in packages/config/eslint. That rule is
 * the reason the Data Access Layer cannot be quietly bypassed by a
 * future contributor who is in a hurry.
 */
const globalForPrisma = globalThis as unknown as { __esokoPrisma?: PrismaClient };

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
