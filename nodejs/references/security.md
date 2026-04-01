# Security

## Helmet (Express)

```typescript
import helmet from 'helmet';
app.use(helmet());
```

Sets security headers: CSP, X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security.

## CORS

```typescript
import cors from 'cors';

app.use(cors({
  origin: process.env.CORS_ORIGIN,    // Specific origin, never '*' with credentials
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
```

## Rate Limiting

```typescript
import rateLimit from 'express-rate-limit';

// Global rate limit
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// Strict limit on auth endpoints
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
app.use('/api/auth', authLimiter);
```

For distributed systems, use Redis-backed rate limiting (`rate-limit-redis`).

## Input Sanitization

- **Validate with Zod** at every boundary (see `validation.md`)
- **Parameterized queries** — ORMs handle this; never concatenate user input into SQL
- **Escape HTML** if rendering user content — use a templating engine or `DOMPurify`
- **Limit request body size** — `express.json({ limit: '1mb' })`

## Dependency Audit

```bash
npm audit                    # Check for known vulnerabilities
npm audit fix                # Auto-fix where possible
npx better-npm-audit audit   # Stricter audit with exit codes
```

Run in CI. Block deploys on critical/high vulnerabilities.

## Secrets Management

- Env vars for all secrets — validated at startup with Zod (see `config.md`)
- `.env.local` is gitignored — local secrets never committed
- `.env.example` documents required vars without values
- Production: use platform secrets (AWS Secrets Manager, Vault, Doppler)
- Never log secrets — log event names, not credentials

## HTTPS

- Always HTTPS in production — terminate TLS at load balancer or reverse proxy
- Set `trust proxy` in Express only when behind a known proxy
- `Strict-Transport-Security` header via helmet

## Rules

- **Validate all input** — Zod at boundaries, parameterized queries for DB
- **Principle of least privilege** — minimal permissions on DB users, API keys, IAM roles
- **Audit dependencies regularly** — `npm audit` in CI
- **Rotate secrets** — JWT secrets, API keys, DB passwords on a schedule

## Never

- **No `eval()` or `new Function()`** — ever
- **No `child_process.exec()` with user input** — use `execFile()` with explicit args
- **No `*` CORS origin with credentials** — specify exact origins
- **No secrets in query strings** — use headers or request body
- **No error stack traces in production responses** — log server-side, return generic message
