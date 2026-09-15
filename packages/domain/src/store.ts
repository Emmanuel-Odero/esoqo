import { z } from 'zod';

/** ONE definition of "open a store", shared by the wizard's client
 *  validation and the Server Action's boundary validation. */
export const createStoreSchema = z.object({
  enterpriseId: z.string().uuid('Choose which business this store belongs to'),
  name: z.string().trim().min(2, 'Give your store a name').max(80),
  themeKey: z.enum(['market', 'nairobi', 'sundown', 'slate']).default('market'),
  routingMode: z.enum(['PATH', 'SUBDOMAIN']).default('PATH'),
  posEnabled: z.boolean().default(false),
  /** Optional profile starts collected at creation — the rest happens in
   *  Settings → Store profile. Kept tiny so opening a store stays light. */
  tagline: z.string().trim().max(120).optional().or(z.literal('')),
  contactPhone: z
    .string()
    .trim()
    .regex(/^\+254(7|1)\d{8}$/, 'Enter a valid Kenyan mobile number')
    .optional()
    .or(z.literal('')),
});
export type CreateStoreInput = z.infer<typeof createStoreSchema>;

/** One of the four storefront themes — used by createStoreSchema and the
 *  settings editor alike. */
export const THEME_KEYS = ['market', 'nairobi', 'sundown', 'slate'] as const;

/**
 * The EStore profile is collected in five independent steps in
 * Settings → Store profile. Each step is saved on its own, so these are
 * five small schemas, not one big one — "Save" on a step must never
 * require fields from a step that hasn't been reached yet.
 */

/** Step 1 — business identity: who this is, legally and for customers
 *  to reach. */
export const storeIdentitySchema = z.object({
  legalName: z.string().trim().max(160).optional().or(z.literal('')),
  registrationNumber: z.string().trim().max(60).optional().or(z.literal('')),
  contactPerson: z.string().trim().max(120).optional().or(z.literal('')),
  contactEmail: z.string().trim().toLowerCase().email('Enter a valid email address').max(160).optional().or(z.literal('')),
  contactPhone: z
    .string()
    .trim()
    .regex(/^\+254(7|1)\d{8}$/, 'Enter a valid Kenyan mobile number')
    .optional()
    .or(z.literal('')),
  physicalAddress: z.string().trim().max(200).optional().or(z.literal('')),
});
export type StoreIdentityInput = z.infer<typeof storeIdentitySchema>;

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Step 2 — branding & assets: the words and images a customer sees. */
export const storeBrandingSchema = z.object({
  tagline: z.string().trim().max(120).optional().or(z.literal('')),
  aboutUs: z.string().trim().max(1500).optional().or(z.literal('')),
  brandAccent: z.string().trim().regex(HEX, 'Brand colour must be a hex value like #12794A').optional().or(z.literal('')),
  instagram: z.string().trim().max(80).optional().or(z.literal('')),
  facebook: z.string().trim().max(80).optional().or(z.literal('')),
  tiktok: z.string().trim().max(80).optional().or(z.literal('')),
  whatsapp: z.string().trim().max(80).optional().or(z.literal('')),
  linkedin: z.string().trim().max(80).optional().or(z.literal('')),
});
export type StoreBrandingInput = z.infer<typeof storeBrandingSchema>;

/** Step 4 — shipping & fulfilment: where orders are packed and how far
 *  delivery reaches. Fulfilment options (the priced pickup/delivery
 *  choices) are managed separately below on the same page. */
export const storeShippingSchema = z.object({
  deliveryOrigin: z.string().trim().max(200).optional().or(z.literal('')),
  deliveryZones: z.array(z.string().trim().max(120)).max(20).optional().default([]),
  processingDays: z.number().int().min(0).max(60).optional().nullable(),
});
export type StoreShippingInput = z.infer<typeof storeShippingSchema>;

/** Step 5 — payments: how the store prices and is settled. Currency is
 *  KES for everything today; kept on the profile so it can ever change
 *  in one place. */
export const storePaymentsSchema = z.object({
  currency: z.string().trim().regex(/^[A-Z]{3}$/, 'Use a three-letter currency code like KES').default('KES'),
  taxRatePct: z.number().int().min(0).max(100).optional().nullable(),
  settlementPhone: z
    .string()
    .trim()
    .regex(/^\+254(7|1)\d{8}$/, 'Enter a valid Kenyan mobile number')
    .optional()
    .or(z.literal('')),
  /** Whether the storefront offers cash on delivery alongside M-Pesa STK. */
  codEnabled: z.boolean().default(false),
});
export type StorePaymentsInput = z.infer<typeof storePaymentsSchema>;

/**
 * A product's catalog category — deliberately separate from the 92-entry
 * SEGMENTS dictionary in segments.ts. Segments classify a *person's
 * trade* ("carpenter", "mama mboga"); this classifies *one item in a
 * store's catalog*, which needs a much shorter, retail-shaped list a
 * merchant can pick from in one glance.
 */
export const PRODUCT_CATEGORIES = [
  ['HARDWARE_TOOLS', 'Hardware & tools'],
  ['BUILDING_MATERIALS', 'Building materials'],
  ['ELECTRONICS', 'Electronics'],
  ['FASHION_APPAREL', 'Fashion & apparel'],
  ['FOOD_GROCERIES', 'Food & groceries'],
  ['HEALTH_BEAUTY', 'Health & beauty'],
  ['HOME_FURNITURE', 'Home & furniture'],
  ['AGRICULTURE', 'Agriculture'],
  ['AUTOMOTIVE', 'Automotive'],
  ['SERVICES', 'Services'],
  ['OTHER', 'Other'],
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number][0];

/** Step 3 — product architecture: what the store mostly trades in, and
 *  roughly how many things it carries. Kept here rather than with the
 *  other profile steps because it references PRODUCT_CATEGORIES, which
 *  is declared above. `primaryCategory` is free text so "Other" can carry
 *  a merchant's own description (e.g. "Poultry, dairy & eggs"). */
export const storeCatalogSchema = z.object({
  primaryCategory: z.string().trim().max(60).optional(),
  skuCount: z.number().int().nonnegative().max(100_000).optional().nullable(),
});
export type StoreCatalogInput = z.infer<typeof storeCatalogSchema>;

/**
 * Suggested units for the "how do you sell this?" picker — not everything
 * is weighed. Milk and fabric are litres and metres, eggs come by the
 * tray, firewood by the bundle, a haircut isn't measured at all. This is
 * deliberately a starting list, not a closed one: `unit` on the product
 * itself stays free text (see createProductSchema below) so a merchant
 * whose unit isn't here can just type it — "debe", "gorogoro", whatever
 * their own trade actually calls it.
 */
export const PRODUCT_UNITS = [
  ['kg', 'Kilogram (kg)'],
  ['g', 'Gram (g)'],
  ['litre', 'Litre'],
  ['ml', 'Millilitre (ml)'],
  ['piece', 'Piece'],
  ['dozen', 'Dozen'],
  ['pack', 'Pack'],
  ['bag', 'Bag'],
  ['bunch', 'Bunch'],
  ['tray', 'Tray'],
  ['crate', 'Crate'],
  ['box', 'Box'],
  ['roll', 'Roll'],
  ['metre', 'Metre'],
  ['service', 'Service (no unit)'],
] as const;

/**
 * Finer units for subdividing a bulk unit — 20 litres of cooking oil
 * portioned into 400ml sachets, a kilo of rice bagged into 250g
 * packs, a metre of fabric cut into 20cm pieces. Keyed by the bulk
 * unit; `factor` is how many of the fine unit make one bulk unit, so a
 * portion's cost prorates as (portionSize / factor) * costPerBulkUnit.
 * A bulk unit with no entry here (piece, dozen, bunch…) still allows
 * subdividing — the picker just asks for the portion size in the same
 * unit instead of offering a smaller one.
 */
export const SUB_UNITS: Record<string, { unit: string; factor: number }> = {
  litre: { unit: 'ml', factor: 1000 },
  kg: { unit: 'g', factor: 1000 },
  metre: { unit: 'cm', factor: 100 },
};

export const createProductSchema = z.object({
  name: z.string().trim().min(2, 'Name this product').max(120),
  description: z.string().trim().max(500).optional().or(z.literal('')),
  category: z.enum(PRODUCT_CATEGORIES.map(([k]) => k) as [string, ...string[]]).optional(),
  priceKes: z.number().positive('Enter a price above zero').max(10_000_000),
  /** What it cost the merchant — optional, feeds gross-profit reporting. */
  costKes: z.number().nonnegative().max(10_000_000).nullable().optional(),
  /** Retail unit — "kg", "litre", "piece"… free text, no fixed list, so a
   *  trade whose unit isn't in PRODUCT_UNITS can still name its own. */
  unit: z.string().trim().max(20).optional().or(z.literal('')),
  /** Unit the stock was bought in — can differ from `unit` (buy a crate
   *  of tomatoes by the kilo, sell per piece). Free text, same reasons
   *  as `unit` above. */
  purchaseUnit: z.string().trim().max(20).optional().or(z.literal('')),
  stockQty: z.number().int().nonnegative().nullable().optional(),
  /** Sell by order-first — hold no stock, fulfil once the buyer orders. */
  availableOnOrder: z.boolean().default(false),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema.partial();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const variantSchema = z.object({
  label: z.string().trim().min(1, 'Label this option — "500g", "Blue"…').max(60),
  priceKes: z.number().positive('Enter a price above zero').max(10_000_000),
  costKes: z.number().nonnegative().max(10_000_000).nullable().optional(),
  stockQty: z.number().int().nonnegative().nullable().optional(),
  availableOnOrder: z.boolean().default(false),
  sku: z.string().trim().max(60).optional().or(z.literal('')),
});
export type VariantFormInput = z.infer<typeof variantSchema>;

/** The add-product form's full submit — the base item plus whatever
 *  portions the merchant subdivided it into, e.g. 20 litres of cooking
 *  oil bought in bulk, sold on as 400ml/500ml sachets. Cost for each is
 *  computed client-side (bulk cost prorated by portion size) before it
 *  ever reaches here — this schema just carries the result. */
export const createProductWithVariantsSchema = createProductSchema.extend({
  variants: z.array(variantSchema).max(30).optional(),
});
export type CreateProductWithVariantsInput = z.infer<typeof createProductWithVariantsSchema>;

export const fulfilmentOptionSchema = z.object({
  kind: z.enum(['PICKUP', 'DELIVERY']),
  label: z.string().trim().min(2, 'Describe this option').max(80),
  feeKes: z.number().nonnegative().max(1_000_000).default(0),
});
export type FulfilmentOptionFormInput = z.infer<typeof fulfilmentOptionSchema>;

export const checkoutSchema = z.object({
  storeSlug: z.string().min(1),
  buyerName: z.string().trim().min(2, 'Enter your name').max(120),
  buyerMsisdn: z
    .string()
    .trim()
    .regex(/^\+254(7|1)\d{8}$/, 'Enter a valid Kenyan mobile number'),
  items: z
    .array(z.object({
      productId: z.string().uuid(),
      variantId: z.string().uuid().optional().nullable(),
      quantity: z.number().int().positive(),
    }))
    .min(1, 'Your basket is empty'),
  deliveryOptionId: z.string().uuid().optional().nullable(),
  collectionNotes: z.string().trim().max(280).optional().or(z.literal('')),
  /** Delivery address required when a DELIVERY option is chosen —
   *  street / estate / landmark, plain text. */
  deliveryAddress: z.string().trim().max(280).optional().or(z.literal('')),
  /** How the buyer pays. CASH_ON_DELIVERY skips the STK push; the
   *  merchant confirms payment when cash is collected. */
  paymentMethod: z.enum(['MPESA_STK', 'CASH_ON_DELIVERY', 'VOUCHER']).default('MPESA_STK'),
  voucherId: z.string().uuid().optional(),
  /** Buying on behalf of an organisation the signed-in buyer belongs to,
   *  rather than for themselves — membership is verified server-side,
   *  never trusted from this value alone. */
  buyingOrgId: z.string().uuid().optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

/** One line rung up at the terminal. unitPriceKes is deliberately not
 *  re-derived from the catalog here — see PosSaleItemInput in
 *  packages/db's pos DAL for why: what the item actually sold for at
 *  the counter, not what the price tag says. */
export const posSaleItemSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().optional().nullable(),
  quantity: z.number().int().positive(),
  unitPriceKes: z.number().nonnegative().max(10_000_000),
  discountKes: z.number().nonnegative().max(10_000_000).optional(),
});

export const posSaleSchema = z.object({
  clientSaleId: z.string().min(1),
  paymentMethod: z.enum(['CASH', 'MPESA_TILL', 'MPESA_STK', 'ON_ACCOUNT']),
  soldAt: z.string().min(1),
  items: z.array(posSaleItemSchema).min(1, 'Add at least one item before completing the sale'),
  discountKes: z.number().nonnegative().max(10_000_000).optional(),
  tenderedKes: z.number().nonnegative().max(10_000_000).optional(),
  cashierId: z.string().uuid().optional().nullable(),
  shiftId: z.string().uuid().optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  /** Auto-captures a customer by phone when customerId isn't already
   *  known — required for an ON_ACCOUNT sale. */
  customerMsisdn: z
    .string()
    .trim()
    .regex(/^\+254(7|1)\d{8}$/, 'Enter a valid Kenyan mobile number')
    .optional()
    .or(z.literal('')),
  customerName: z.string().trim().max(120).optional().or(z.literal('')),
}).refine(
  (v) => v.paymentMethod !== 'ON_ACCOUNT' || v.customerId || v.customerMsisdn,
  { message: 'An on-account sale needs a customer — enter their phone number', path: ['customerMsisdn'] },
);
export type PosSaleFormInput = z.infer<typeof posSaleSchema>;

/** A contact a merchant buys from — kept once, reused across purchases. */
export const supplierSchema = z.object({
  name: z.string().trim().min(2, 'Give the supplier a name').max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+254(7|1)\d{8}$/, 'Enter a valid Kenyan mobile number')
    .optional()
    .or(z.literal('')),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});
export type SupplierFormInput = z.infer<typeof supplierSchema>;

/** One delivery of stock into the shop — see StockPurchase in the
 *  schema for why this exists: knowing what a batch cost is what turns
 *  "I sold stuff today" into "I made a profit today". */
export const stockPurchaseSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().optional().nullable(),
  supplierId: z.string().uuid().optional().nullable(),
  quantity: z.number().int().positive('Enter how many came in'),
  unitCostKes: z.number().nonnegative('Enter what you paid per unit').max(10_000_000),
  purchasedAt: z.string().optional(),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});
export type StockPurchaseFormInput = z.infer<typeof stockPurchaseSchema>;

export const customerPaymentSchema = z.object({
  amountKes: z.number().positive('Enter an amount above zero').max(10_000_000),
  note: z.string().trim().max(280).optional().or(z.literal('')),
  /** One token per user intent, so a double-clicked submit records the
   *  payment once instead of posting a second ledger entry and a second
   *  settlement. Optional: older clients simply get the old behaviour. */
  requestId: z.string().uuid().optional(),
});
export type CustomerPaymentFormInput = z.infer<typeof customerPaymentSchema>;

export const customerAdjustmentSchema = z.object({
  amountKes: z.number().refine((n) => n !== 0, 'Enter a non-zero amount').refine((n) => Math.abs(n) <= 10_000_000, 'That amount looks too large'),
  note: z.string().trim().min(2, 'Say why you are adjusting this balance').max(280),
  /** One token per user intent, so a double-clicked submit records the
   *  payment once instead of posting a second ledger entry and a second
   *  settlement. Optional: older clients simply get the old behaviour. */
  requestId: z.string().uuid().optional(),
});
export type CustomerAdjustmentFormInput = z.infer<typeof customerAdjustmentSchema>;

export const customerEditSchema = z.object({
  name: z.string().trim().max(120).optional().or(z.literal('')),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});
export type CustomerEditFormInput = z.infer<typeof customerEditSchema>;

/** PIN validity (4–6 digits) is checked again in @esoqo/auth's hashPin —
 *  this is the form-level check so a bad PIN never round-trips to the
 *  server before the cashier sees why. */
export const createCashierSchema = z.object({
  name: z.string().trim().min(2, 'Give the cashier a name').max(80),
  pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits'),
  role: z.enum(['CASHIER', 'MANAGER']).default('CASHIER'),
});
export type CreateCashierFormInput = z.infer<typeof createCashierSchema>;

export const cashierPinSchema = z.object({
  cashierId: z.string().uuid(),
  pin: z.string().regex(/^\d{4,6}$/, 'Enter your PIN'),
});
export type CashierPinFormInput = z.infer<typeof cashierPinSchema>;

/** The public sign-in form — by name, not by picking from a roster. See
 *  the doc comment on getCashierPinHashForSignIn in @esoqo/db for why. */
export const cashierSignInSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(80),
  pin: z.string().regex(/^\d{4,6}$/, 'Enter your PIN'),
});
export type CashierSignInFormInput = z.infer<typeof cashierSignInSchema>;

export const openShiftSchema = z.object({
  cashierId: z.string().uuid(),
  openingFloatKes: z.number().nonnegative().max(1_000_000).default(0),
});
export type OpenShiftFormInput = z.infer<typeof openShiftSchema>;

export const closeShiftSchema = z.object({
  shiftId: z.string().uuid(),
  countedCashKes: z.number().nonnegative().max(10_000_000),
});
export type CloseShiftFormInput = z.infer<typeof closeShiftSchema>;
