/**
 * The Data Access Layer.
 *
 * EVERY read and write passes through here. No component, Server Action,
 * route handler or service may import the Prisma client directly — the
 * ESLint rule in @esoko/config enforces it and CI fails on violation.
 * See ADR-0003.
 */
export * from './registration';
export * from './party';
export * from './reference';
export * from './reporting';
export * from './audit-read';
export * from './documents';
export * from './payments';
export * from './staff';
export * from './groups';
export * from './subject';
