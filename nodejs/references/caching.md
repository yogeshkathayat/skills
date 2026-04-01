# Caching

## Redis Client

```typescript
// src/lib/redis.ts
import Redis from 'ioredis';
import { config } from '@/config';

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 200, 5000),
});

redis.on('error', (err) => logger.error({ err }, 'redis_error'));
redis.on('connect', () => logger.info('redis_connected'));
```

## Cache Patterns

### Cache-Aside (most common)

```typescript
async function getUser(id: string): Promise<User> {
  const cacheKey = `user:${id}`;

  // 1. Check cache
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // 2. Query DB
  const user = await db.user.findUnique({ where: { id } });
  if (!user) throw new NotFoundError('User', id);

  // 3. Populate cache
  await redis.set(cacheKey, JSON.stringify(user), 'EX', 300); // 5 min TTL

  return user;
}
```

### Cache Invalidation

```typescript
// After mutation — invalidate related keys
async function updateUser(id: string, data: UpdateUserInput): Promise<User> {
  const user = await db.user.update({ where: { id }, data });

  // Invalidate specific key
  await redis.del(`user:${id}`);

  // Invalidate list caches (pattern-based)
  const keys = await redis.keys('users:list:*');
  if (keys.length) await redis.del(...keys);

  return user;
}
```

### Write-Through

```typescript
async function createUser(data: CreateUserInput): Promise<User> {
  const user = await db.user.create({ data });

  // Write to cache immediately
  await redis.set(`user:${user.id}`, JSON.stringify(user), 'EX', 300);

  return user;
}
```

## TTL Strategy

| Data type | TTL | Reason |
|-----------|-----|--------|
| User profile | 5 min | Changes infrequently, tolerate slight staleness |
| Product listing | 1 min | Changes moderately, pagination complicates invalidation |
| Config/feature flags | 30 sec | Must reflect changes quickly |
| Rate limit counters | Match window | 15 min for rate limit windows |
| Session data | Match session | 24h or token expiry |

## In-Memory Cache (single instance)

```typescript
import { LRUCache } from 'lru-cache';

const cache = new LRUCache<string, unknown>({
  max: 1000,           // Max entries
  ttl: 60 * 1000,      // 1 min TTL
});
```

Use for: config lookups, parsed templates, computed values. Not for: user data across instances.

## Rules

- **Always set TTL** — no unbounded cache entries
- **Invalidate on mutation** — don't wait for TTL expiry on writes
- **Cache serializable data** — JSON.stringify/parse, not objects with methods
- **Handle cache miss gracefully** — cache is optimization, not source of truth

## Never

- **No caching without TTL** — memory leaks
- **No caching PII unnecessarily** — minimize what's cached
- **No cache as primary store** — Redis can restart; DB is source of truth
- **No complex objects in cache** — serialize to JSON, not class instances
