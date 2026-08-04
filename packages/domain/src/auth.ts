import { z } from 'zod';
import { msisdnSchema, otpCodeSchema } from './phone';

/** ONE definition of "sign in" and "set a PIN", shared by the client
 *  form and the Server Action's boundary validation. */

const pinSchema = z
  .string()
  .trim()
  .regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits');

export const signInSchema = z.object({
  identifier: z.string().trim().min(3, 'Enter your phone number or email'),
  pin: pinSchema,
});
export type SignInInput = z.infer<typeof signInSchema>;

export const requestPinCodeSchema = z.object({ msisdn: msisdnSchema });
export type RequestPinCodeInput = z.infer<typeof requestPinCodeSchema>;

export const setPinSchema = z
  .object({
    msisdn: msisdnSchema,
    code: otpCodeSchema,
    pin: pinSchema,
    pinConfirm: pinSchema,
  })
  .refine((d) => d.pin === d.pinConfirm, { message: 'PINs do not match', path: ['pinConfirm'] });
export type SetPinInput = z.infer<typeof setPinSchema>;
