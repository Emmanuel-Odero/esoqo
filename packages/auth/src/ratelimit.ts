import 'server-only';
import { redis } from './redis';

export class RateLimitError extends Error {
  readonly status = 429;
  constructor(public readonly retryAfterSeconds: number) {
    super('Rate limit exceeded');
    this.name = 'RateLimitError';
  }
}

/** Fixed-window counter. Sufficient for OTP and sign-in; swap for a
 *  sliding window if abuse patterns demand it. */
export async function checkRateLimit(key: string, limit: number, windowSeconds: number) {
  const k = `rl:${key}`;
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, windowSeconds);
  if (n > limit) {
    const ttl = await redis.ttl(k);
    throw new RateLimitError(ttl > 0 ? ttl : windowSeconds);
  }
  return { remaining: Math.max(0, limit - n) };
}
