/**
 * The counter's shared vocabulary — one booking shape, one party
 * shape, one pricing shape for both the Esoqo console counter and a
 * courier company's own counter. Two screens, one contract, so a fix
 * to what a booking carries lands in both places at once.
 */

/** What a counter booking carries, whichever portal submits it. */
export interface CounterBookInput {
  senderName: string;
  senderMsisdn: string;
  receiverName: string;
  receiverMsisdn: string;
  originLabel: string;
  destinationLabel: string;
  parcelType: string;
  weightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  declaredValueKes?: number;
  coverageTierId?: string;
  contentsDeclared: boolean;
  existingCode?: string;
  notes?: string;
  fragile?: boolean;
}

/** Somebody the network has shipped to or from before — the counter's
 *  address book row, most-frequent first. */
export interface CounterPartyOption {
  name: string;
  msisdn: string;
  lastLabel: string;
  shipments: number;
}

/** One weight bracket, so the counter can match a measured weight to
 *  its bracket without a round trip per keystroke. */
export interface CounterPricingOption {
  parcelType: string;
  weightLabel: string;
  minWeightKg: number;
  maxWeightKg: number;
  minKes: string;
  maxKes: string;
}

/** Whatever a label already carries — a blank label resolves to null,
 *  a filled one to its field notes. The counter resumes from this
 *  rather than re-asking. Every field optional: the field may only
 *  have known the item and the destination. */
export interface CounterLabelInfo {
  itemDescription?: string | null;
  destination?: string | null;
  senderName?: string | null;
  senderMsisdn?: string | null;
  receiverName?: string | null;
  receiverMsisdn?: string | null;
  itemType?: string | null;
  weightRangeKg?: string | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
}

export type CounterResult = { ok: true; code: string } | { ok: false; error: string };
export type CounterVoid = { ok: true } | { ok: false; error: string };

/** The five portal-specific wires a counter needs. Each portal passes
 *  its own session-scoped actions — the form never knows whose desk
 *  it sits on. */
export interface CounterActions {
  getLabelInfo: (code: string) => Promise<{ ok: true; info: CounterLabelInfo | null } | { ok: false; error: string }>;
  attachLabelInfo: (code: string, info: CounterLabelInfo & { itemDescription: string }) => Promise<CounterVoid>;
  bookParcel: (input: CounterBookInput) => Promise<CounterResult>;
  confirmIntake: (code: string) => Promise<CounterVoid>;
  searchParties: (q: string) => Promise<CounterPartyOption[]>;
}

/** Where the counter's exits lead. Plain hrefs (not framework links)
 *  so this component stays free of any one app's router. */
export interface CounterLinks {
  /** The counter itself — the "next customer" loop. */
  nextHref: string;
  /** A booked parcel's detail view. */
  parcelHref: (code: string) => string;
  /** The label register — where a foreign-label error sends the clerk
   *  to print a fresh Esoqo sticker. */
  labelsHref: string;
}
