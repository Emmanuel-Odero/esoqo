export { prisma } from './client';
export * from './dal';
export { recordAudit, verifyChain } from './audit';
// Re-exported directly (not just via the `export * from './dal'` above) for
// the same reason verifyChain is: services/core runs under plain tsx/Node
// ESM, not a bundler, and a request for a name several `export *` hops deep
// in the dal barrel doesn't reliably resolve there. Bundled apps (Next.js)
// are unaffected either way.
export { confirmStoreOrderPayment, confirmStoreOrderCod, StoreOrderError } from './dal/store-order';
export {
  confirmRegistrationPaymentByCheckoutId, confirmRegistrationPaymentByPesapalOrderId,
  attachRegistrationCheckoutRequestId, attachRegistrationPesapalOrder,
  declarePayment, deferPayment,
} from './dal/payments';
export {
  startRegistration, updateRegistration, markMsisdnVerified, getRegistrationDetail,
} from './dal/registration';
export {
  completeCecfRegistration, addCecfMemberRoster, trySetCecfJoinFee, uploadCecfDocument,
  cecfRegistrantOrgRole, CECF_JOIN_FEE_KES,
} from './dal/cecf-ingest';
export { confirmDonationPayment, DonationError } from './dal/donation';
export { confirmBookingPayment, TicketingError } from './dal/ticketing';
export {
  listDomainsNeedingReconciliation, markDomainVerifying, markDomainActive,
  markDomainFailed, touchDomainCheck, finaliseRemovedDomain,
} from './dal/jamii-domain';
export {
  listActiveMediaAssets, listMediaAssetsForStaff, setMediaAssetActive, updateMediaAssetLabel,
} from './dal/jamii-media';
export * from './capabilities';
export type { VerifyResult } from './dal/reference';
export * from './storage';
// compressImage deliberately does NOT get re-exported here — every app
// in the monorepo imports something from '@esoko/db' (the main entry
// this file is), so re-exporting it here would put sharp (a native
// binary addon) in every one of those apps' Server Component/Action
// build graphs, not just apps/jamii's. Import it from the dedicated
// '@esoko/db/image-compression' subpath instead — see that file's own
// header, and apps/jamii's next.config.mjs's serverExternalPackages
// entry, which is still needed for the one app that actually does.
export type { MemberRole, OrgKind } from '@prisma/client';
export type {
  StoreStatus, StoreRoutingMode, StoreOrderStatus, StoreOrderPaymentMethod,
  PosSyncStatus, PosPaymentMethod,
  JamiiPageStatus, PublishStatus, JamiiTeamRole, CampaignStatus, DonationStatus,
  JamiiInterestStatus, JamiiMediaCategory, JamiiContactMessageStatus,
  TicketVertical, TicketOrgStatus, ListingStatus, ScheduleStatus, SeatStatus,
  BookingStatus, BookingPaymentMethod, TicketStatus,
} from '@prisma/client';
