/**
 * Database liveness.
 *
 * Exists so a service's restart probe can ask "can I reach the
 * database?" without importing the Prisma client directly. The ESLint
 * rule in @esoqo/config forbids that import outside this package
 * (see the note at the top of dal/index.ts), and the rule is right: a
 * component or a route handler that knows about the client is a
 * component or a route handler one schema change away from being wrong.
 *
 * The exception this function carves out is narrow and deliberate. A
 * probe has to run before there is any authenticated subject, against a
 * database whose schema may not have been migrated yet, and it must not
 * touch a single table — "the migration never ran" and "the server is
 * down" are different failures and a probe that queries a table reports
 * both as the same thing. `SELECT 1` is the one statement that answers
 * reachability and nothing else.
 *
 * Deliberately NOT exported as a raw `$queryRaw` escape hatch: the point
 * is that a caller gets reachability, not a general-purpose handle.
 */
import { prisma } from '../client';

export type DatabaseHealth = {
  reachable: boolean;
  /** Only ever the failure text — a driver error can carry a hostname,
   *  a connection string fragment, or a schema name, none of which
   *  belong in a probe response that Render stores and displays. */
  error?: string;
};

export async function pingDatabase(): Promise<DatabaseHealth> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { reachable: true };
  } catch (e) {
    // Message only, and a fixed shape. The caller turns this into a 503
    // with a stable `reason`, never into a passthrough of the driver's
    // own words.
    return { reachable: false, error: e instanceof Error ? e.message : 'unknown database error' };
  }
}