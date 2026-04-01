# HTTP Server Patterns

## Express 5

```typescript
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pino from 'pino-http';
import { logger } from '@/lib/logger';
import { errorHandler } from '@/middleware/error-handler';
import { routes } from '@/routes';

const app = express();

// Security and parsing
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// Request logging
app.use(pino({ logger }));

// Routes
app.use('/api', routes);

// Error handler (must be last)
app.use(errorHandler);

export { app };
```

### Express 5 changes from v4

- Route handlers can return promises — no need for `asyncHandler` wrappers
- `req.query` returns `undefined` for missing keys (not empty string)
- Path matching uses `path-to-regexp` v8 — some regex patterns changed
- `res.json()` and `res.send()` now return promises

### Middleware pattern

```typescript
import type { Request, Response, NextFunction } from 'express';

export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: result.error.flatten().fieldErrors,
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
```

## Fastify 5

```typescript
import Fastify from 'fastify';
import { logger } from '@/lib/logger';

const app = Fastify({ logger });

// Schema-based validation (Fastify uses AJV internally)
app.post('/api/users', {
  schema: {
    body: {
      type: 'object',
      required: ['email', 'name'],
      properties: {
        email: { type: 'string', format: 'email' },
        name: { type: 'string', minLength: 1 },
      },
    },
  },
}, async (request, reply) => {
  const user = await createUser(request.body);
  return reply.status(201).send(user);
});

export { app };
```

## Hono

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { zValidator } from '@hono/zod-validator';

const app = new Hono();

app.use('*', cors());
app.use('*', logger());

app.post('/api/users', zValidator('json', createUserSchema), async (c) => {
  const body = c.req.valid('json');
  const user = await createUser(body);
  return c.json(user, 201);
});

export { app };
```

## Graceful Shutdown

Required for all frameworks. Handle SIGTERM to drain connections before exiting.

```typescript
import { app } from './server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { redis } from '@/lib/redis';

const server = app.listen(Number(process.env.PORT ?? 3000), () => {
  logger.info({ port: process.env.PORT ?? 3000 }, 'server_started');
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutdown_initiated');

  // 1. Stop accepting new connections
  server.close();

  // 2. Wait for in-flight requests (with timeout)
  const timeout = setTimeout(() => {
    logger.warn('shutdown_timeout — forcing exit');
    process.exit(1);
  }, 30_000);

  // 3. Close external connections
  await Promise.allSettled([
    db.$disconnect(),
    redis.quit(),
  ]);

  clearTimeout(timeout);
  logger.info('shutdown_complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

## When

| Scenario | Framework |
|----------|-----------|
| REST API with broad middleware needs | Express 5 |
| High-throughput API with schema validation | Fastify 5 |
| Edge/Bun-first lightweight API | Hono |
| Worker/CLI/script with no HTTP | None |

## Never

- **No blocking the event loop** — CPU-heavy work goes to worker threads or `spawn_blocking`.
- **No `app.listen()` in the app module** — separate server creation from listening for testability.
- **No global mutable state** — dependency injection or module-scoped singletons.
- **No `trust proxy` without explicit proxy config** — security risk.
