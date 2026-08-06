import { z } from 'zod';

/** ONE definition of "open a store", shared by the wizard's client
 *  validation and the Server Action's boundary validation. */
export const createStoreSchema = z.object({
  enterpriseId: z.string().uuid('Choose which business this store belongs to'),
  name: z.string().trim().min(2, 'Give your store a name').max(80),
  themeKey: z.enum(['market', 'nairobi', 'sundown', 'slate']).default('market'),
  routingMode: z.enum(['PATH', 'SUBDOMAIN']).default('PATH'),
  posEnabled: z.boolean().default(false),
});
export type CreateStoreInput = z.infer<typeof createStoreSchema>;

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

export const createProductSchema = z.object({
  name: z.string().trim().min(2, 'Name this product').max(120),
  description: z.string().trim().max(500).optional().or(z.literal('')),
  category: z.enum(PRODUCT_CATEGORIES.map(([k]) => k) as [string, ...string[]]).optional(),
  priceKes: z.number().positive('Enter a price above zero').max(10_000_000),
  stockQty: z.number().int().nonnegative().nullable().optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const checkoutSchema = z.object({
  storeSlug: z.string().min(1),
  buyerName: z.string().trim().min(2, 'Enter your name').max(120),
  buyerMsisdn: z
    .string()
    .trim()
    .regex(/^\+254(7|1)\d{8}$/, 'Enter a valid Kenyan mobile number'),
  items: z
    .array(z.object({ productId: z.string().uuid(), quantity: z.number().int().positive() }))
    .min(1, 'Your basket is empty'),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;
