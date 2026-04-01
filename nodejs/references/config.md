# Configuration & Environment

## Env Validation at Startup

```typescript
// src/config.ts
import { z } from 'zod';
import 'dotenv/config';  // Load .env before validation

const EnvSchema = z.object({
  // Runtime
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url().optional(),

  // Auth
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRY: z.string().default('15m'),

  // External APIs
  API_BASE_URL: z.string().url().optional(),

  // CORS
  CORS_ORIGIN: z.string().url(),
});

export type Env = z.infer<typeof EnvSchema>;

// Parse at import time — crash immediately if invalid
export const config = EnvSchema.parse(process.env);
```

Import `@/config` wherever you need env values. Never read `process.env` directly in application code.

## File Layout

```
.env.example     # Documented template — committed, no real values
.env             # Local overrides — gitignored
.env.test        # Test environment — gitignored
.env.production  # Production defaults (non-secret) — optional, committed
```

### .env.example

```bash
# Runtime
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/myapp

# Redis
REDIS_URL=redis://localhost:6379

# Auth
JWT_SECRET=change-me-to-at-least-32-chars-long
JWT_EXPIRY=15m

# CORS
CORS_ORIGIN=http://localhost:3001
```

## Patterns

- **Fail fast** — `z.parse()` at import time crashes the process on invalid config
- **Type-safe access** — `config.PORT` is `number`, not `string | undefined`
- **Default values** — `z.default()` for non-critical settings
- **Coerce types** — `z.coerce.number()` converts `"3000"` to `3000`
- **Environment-specific files** — `.env.test` for test DB URL, `.env` for local dev

## Secrets in Production

| Platform | Method |
|----------|--------|
| AWS | Secrets Manager → env injection via ECS task definition |
| GCP | Secret Manager → env injection via Cloud Run |
| Docker Compose | `env_file` or Docker secrets |
| Kubernetes | Secrets mounted as env vars |
| Doppler/Infisical | CLI sync to env vars |

Never bake secrets into Docker images. Inject at runtime.

## Never

- **No `process.env.X` scattered across code** — use the config module
- **No secrets in `.env.example`** — only placeholder values
- **No `.env` committed to git** — gitignore it
- **No secrets in Docker build args** — they persist in image layers
- **No `NEXT_PUBLIC_` prefix for server secrets** (if sharing repo with Next.js frontend)
