# Logging — pino Structured Logging

## Setup

```typescript
// src/lib/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  ...(process.env.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
    },
  }),
});
```

Production: NDJSON to stdout (parsed by Datadog, Grafana Loki, CloudWatch).
Development: `pino-pretty` (devDependency) for human-readable output.

## Log Levels

| Level | When |
|-------|------|
| `fatal` | Process cannot continue — about to crash |
| `error` | Unexpected failure, caught exception with stack, 5xx from downstream |
| `warn` | Degraded functionality, fallback taken, rate limit hit, validation rejection |
| `info` | Significant operation: API call, auth event, cache invalidation, job processed |
| `debug` | Diagnostic detail: parsed params, resolved config. Dev only. |

## Child Loggers

```typescript
// Module-scoped child — every log includes { module: 'users' }
const log = logger.child({ module: 'users' });

log.info({ userId, action: 'created' }, 'user_created');
```

## Request Correlation

```typescript
// Middleware — generate or forward request ID
import { randomUUID } from 'node:crypto';

app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] as string ?? randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
});

// In route handlers
const log = logger.child({ module: 'orders', requestId: req.id });
```

## pino-http (Express/Fastify)

```typescript
import pinoHttp from 'pino-http';

app.use(pinoHttp({ logger, autoLogging: true }));
// Automatically logs: method, url, statusCode, responseTime
```

## What to Log

| Situation | Level | Fields |
|-----------|-------|--------|
| Incoming API request | `info` | method, path, statusCode, responseTime (via pino-http) |
| Downstream API call | `info` | method, url, status, duration |
| Downstream API error | `error` | method, url, status, duration, err |
| Validation rejection | `warn` | action, reason |
| Mutation success | `info` | action, entityId |
| Mutation failure | `error` | action, err |
| Job processed | `info` | jobName, jobId, duration |
| Job failed | `error` | jobName, jobId, err, attempt |
| Auth event | `info` | event (login, logout, refresh) — no tokens |
| Rate limit hit | `warn` | action, clientId (hashed) |
| Config resolved | `debug` | key-value pairs — no secrets |

## Never

- **No PII** — never log email, name, phone, IP, payment details. `userId` (opaque UUID) is OK.
- **No secrets** — never log tokens, API keys, passwords, session cookies.
- **No full request/response bodies** — log operation name, entity ID, status. Not payloads.
- **No string concatenation** — `log.info({ userId }, 'created')`, not `` log.info(`Created ${userId}`) ``.
- **No `console.log`** — use pino. Lint rule: flag `console.log` as error.
