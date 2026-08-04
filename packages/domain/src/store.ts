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

export const createProductSchema = z.object({
  name: z.string().trim().min(2, 'Name this product').max(120),
  description: z.string().trim().max(500).optional().or(z.literal('')),
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
