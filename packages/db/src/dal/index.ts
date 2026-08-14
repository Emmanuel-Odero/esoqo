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
export * from './store';
export * from './product';
export * from './store-order';
export * from './pos';
export * from './supplier';
export * from './merchant-reports';
export * from './customer';
export * from './cashier';
export * from './shift';
export * from './receipt';
export * from './pricing';
export * from './auth-credential';
export * from './jamii-page';
export * from './jamii-post';
export * from './jamii-program';
export * from './jamii-team';
export * from './jamii-interest';
export * from './campaign';
export * from './donation';
export * from './attestation';
