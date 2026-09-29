/**
 * The Data Access Layer.
 *
 * EVERY read and write passes through here. No component, Server Action,
 * route handler or service may import the Prisma client directly — the
 * ESLint rule in @esoqo/config enforces it and CI fails on violation.
 * See ADR-0003.
 */
export * from './registration';
export * from './party';
export * from './reference';
export * from './reporting';
export * from './audit-read';
export * from './platform-revenue';
export * from './site-visit';
export * from './sms-spend';
export * from './retention';
export * from './group-alerts';
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
export * from './parcel-pricing';
export * from './fees';
export * from './wallet-withdrawal';
export * from './esoqo-transfer';
export * from './thirdparty-payout';
export * from './auth-credential';
export * from './jamii-page';
export * from './jamii-page-block';
export * from './jamii-site-page';
export * from './jamii-nav-item';
export * from './jamii-domain';
export * from './jamii-media';
export * from './jamii-post';
export * from './jamii-program';
export * from './jamii-team';
export * from './jamii-interest';
export * from './support-ticket';
export * from './jamii-contact';
export * from './campaign';
export * from './donation';
export * from './attestation';
export * from './treasury';
export * from './payment-id';
export * from './esoqo-id-purchase';
export * from './national-id';
export * from './business-payment';
export * from './wallet-topup';
export * from './group-projects';
export * from './parking';
// Ticketing reads/writes (ticketing, seat-map, ticket-customer, addon)
// moved to services/core-go — see dbx/ticket_orgs.go, ticketing.go,
// ticketing_installment.go and fleet.go. This barrel intentionally no
// longer re-exports them; the Next.js console calls Go over HTTP.
export * from './cecf-ingest';
export * from './mall';
export * from './warehouse';
