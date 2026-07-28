import 'server-only';
import Redis from 'ioredis';

const g = globalThis as unknown as { __esokoRedis?: Redis };

export const redis =
  g.__esokoRedis ??
  new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  });

if (process.env.NODE_ENV !== 'production') g.__esokoRedis = redis;
