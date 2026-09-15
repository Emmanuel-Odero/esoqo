import 'server-only';
import Redis from 'ioredis';

const g = globalThis as unknown as { __esoqoRedis?: Redis };

export const redis =
  g.__esoqoRedis ??
  new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  });

if (process.env.NODE_ENV !== 'production') g.__esoqoRedis = redis;
