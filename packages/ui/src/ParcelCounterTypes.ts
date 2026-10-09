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

/** A failure, with core-go's own error code when there was one.
 *
 *  The code is what lets a caller branch on *which* failure happened.
 *  Without it the only signal is `error`, and the one place that has to
 *  branch — the offline queue's "was this label already spent, meaning
 *  our earlier attempt got through?" test — was reduced to matching the
 *  message text with a regex. Optional because a thrown non-Error, an
 *  expired session or a network fault has no server code to carry. */
export interface CounterFailure {
  ok: false;
  error: string;
  /** core-go's error code.
   *
   *  Named errorCode, not code, because every success shape in this file
   *  already has a `code` meaning a *parcel* code. One field name with
   *  two meanings depending on a sibling boolean is the kind of thing
   *  that reads fine and gets misused six months later. */
  errorCode?: string;
}

export type CounterResult = { ok: true; code: string } | CounterFailure;
export type CounterVoid = { ok: true } | CounterFailure;

/** A code that scanned into an existing parcel rather than a blank
 *  label. The counter's rule for "one box, every purpose" — a spent
 *  label or a fresh tracking code never dead-ends; it opens its
 *  parcel. */
export interface CounterParcelRef {
  code: string;
  status: string;
}

/** What scanning a code turned out to be: a blank label (info null), a
 *  filled-in label to resume from, or — additively — a parcel that
 *  already exists, which the counter shows the door to instead of
 *  erroring. */
export type CounterLabelLookup =
  | { ok: true; info: CounterLabelInfo | null; parcel?: CounterParcelRef | null }
  | CounterFailure;

/** The five portal-specific wires a counter needs. Each portal passes
 *  its own session-scoped actions — the form never knows whose desk
 *  it sits on. */
export interface CounterActions {
  getLabelInfo: (code: string) => Promise<CounterLabelLookup>;
  attachLabelInfo: (code: string, info: CounterLabelInfo & { itemDescription: string }) => Promise<CounterVoid>;
  bookParcel: (input: CounterBookInput) => Promise<CounterResult>;
  confirmIntake: (code: string) => Promise<CounterVoid>;
  searchParties: (q: string) => Promise<CounterPartyOption[]>;
  /** Resolve a code's genuine-print signature, so the label printed at
   *  the moment of booking has the QR that verifies as real. Optional:
   *  a portal that can't resolve sigs prints an unverified label, which
   *  still scans — it just verifies as plain rather than genuine. */
  getLabelSig?: (code: string) => Promise<string | undefined>;
  /** Settle the booking fare at the desk in cash. */
  settleCash?: (code: string, priceKes: number) => Promise<CounterVoid>;
  /** Settle the booking fare via M-Pesa STK push. */
  settleStk?: (code: string, priceKes: number, phone: string) => Promise<{ ok: true; status: "AWAITING_MPESA" | "SETTLED" } | CounterFailure>;
  /** Check settlement status (invoking Co-op STK enquiry on backend). */
  getSettlementStatus?: (code: string, force?: boolean) => Promise<{ ok: true; status: any } | CounterFailure>;
  /** Cancel in-flight STK prompt so clerk can re-prompt or take cash. */
  cancelStk?: (code: string) => Promise<{ ok: true; status: any } | CounterFailure>;
  /** Manually record M-Pesa receipt code if STK push is delayed but client has the SMS code. */
  confirmManualCode?: (code: string, mpesaCode: string) => Promise<CounterVoid>;
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
