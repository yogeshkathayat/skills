# Validation — Zod at System Boundaries

## Principle

Validate all external input at the system boundary — where data enters your code from outside (HTTP requests, CLI args, env vars, queue messages, webhook payloads). Inside the boundary, trust your types.

## Request Validation

```typescript
import { z } from 'zod';

// Define the schema
const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(['user', 'admin']).default('user'),
});

type CreateUserInput = z.infer<typeof CreateUserSchema>;

// Express middleware
function validateBody<T>(schema: z.ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid request body',
          details: result.error.flatten().fieldErrors,
        },
      });
      return;
    }
    req.body = result.data;  // Narrowed and sanitized
    next();
  };
}

// Usage
router.post('/users', validateBody(CreateUserSchema), createUserHandler);
```

## Query Parameter Validation

```typescript
const ListUsersQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['active', 'inactive']).optional(),
  sort: z.string().regex(/^-?[a-zA-Z]+$/).default('-createdAt'),
});
```

Use `z.coerce` for query params — they arrive as strings.

## Path Parameter Validation

```typescript
const UserParams = z.object({
  id: z.string().uuid(),
});
```

## Environment Variable Validation

```typescript
// src/config.ts
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  CORS_ORIGIN: z.string().url(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const config = EnvSchema.parse(process.env);
```

Call this at startup — fail fast on missing or invalid config.

## Webhook / Queue Message Validation

```typescript
const WebhookPayload = z.object({
  event: z.string(),
  timestamp: z.string().datetime(),
  data: z.record(z.unknown()),
});

// In queue processor
const result = WebhookPayload.safeParse(message.data);
if (!result.success) {
  logger.warn({ err: result.error, jobId: message.id }, 'invalid_job_payload');
  return; // Acknowledge and skip — don't retry invalid data
}
```

## Patterns

- **`safeParse` over `parse`** in HTTP handlers — return 400, don't throw.
- **`parse` in startup code** (config, migrations) — crash early.
- **Derive TypeScript types from schemas** — `z.infer<typeof Schema>`, not duplicate interfaces.
- **Coerce at boundaries** — `z.coerce.number()` for query params, `z.coerce.date()` for date strings.
- **Transform after validation** — `z.string().transform(s => s.toLowerCase().trim())`.

## Never

- **No `req.body as T`** — type assertion is not validation. Parse with Zod.
- **No validation in services** — validate at the boundary, trust types inside.
- **No duplicate schemas** — one Zod schema, derive both TypeScript type and runtime validation from it.
