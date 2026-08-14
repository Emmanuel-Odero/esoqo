import 'server-only';
import { randomInt } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id. Never anything else, never hand-rolled.
 *
 * The CECF platform used custom HMAC session tokens and a bespoke
 * password hash. That is the kind of finding that ends a bank
 * partnership before it starts.
 *
 * Parameters follow OWASP guidance: 19 MiB, 2 iterations, parallelism 1.
 */
const OPTS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/** A one-time PIN handed to someone to sign in with — this becomes a
 *  real authentication credential the moment it's hashed and stored, so
 *  it's generated with a CSPRNG rather than `Math.random()` (which is
 *  not designed to resist state-recovery attacks). */
export function generateTempPin(): string {
  return String(randomInt(100_000, 1_000_000));
}

/** A pre-computed, valid Argon2id hash of an unrelated PIN — nobody's
 *  real credential. Verify against this when a lookup (by name, phone,
 *  etc.) comes back empty, so "no such account" and "wrong PIN" take the
 *  same code path and the same wall-clock time. Skipping this and just
 *  returning early on a failed lookup is what turns a sign-in form into
 *  a username-enumeration oracle. */
export const DUMMY_PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dVG7zaa+zCpEHmx40p8mrg$qrCW9sFDblyvsFW58O4LlQ07vfoVltVcJY5cQ0YzrDE';

export async function hashPin(pin: string): Promise<string> {
  if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN must be 4 to 6 digits');
  return hash(pin, OPTS);
}

/** Constant-time via argon2. Returns false on malformed hashes, never throws. */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  try {
    return await verify(stored, pin);
  } catch {
    return false;
  }
}

/** Refuses the PINs that show up in every breach corpus. */
export function isWeakPin(pin: string): boolean {
  const weak = new Set([
    '0000','1111','2222','3333','4444','5555','6666','7777','8888','9999',
    '1234','4321','1212','2580','0852','1379','1122','6969','0123',
  ]);
  if (weak.has(pin)) return true;
  if (/^(\d)\1+$/.test(pin)) return true;                 // all identical
  const asc = pin.split('').every((d, i, a) => i === 0 || +d === +a[i - 1]! + 1);
  const desc = pin.split('').every((d, i, a) => i === 0 || +d === +a[i - 1]! - 1);
  return asc || desc;
}
