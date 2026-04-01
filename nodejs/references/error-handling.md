# Error Handling

## Custom Error Classes

```typescript
// src/lib/errors.ts

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} not found: ${id}`, 404);
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown) {
    super('VALIDATION_FAILED', 'Validation failed', 400, details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', message, 409);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super('UNAUTHORIZED', message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super('FORBIDDEN', message, 403);
  }
}
```

## Express Error Handler

```typescript
// src/middleware/error-handler.ts
import type { ErrorRequestHandler } from 'express';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Known application errors
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, path: req.path, method: req.method }, 'server_error');
    } else {
      logger.warn({ code: err.code, path: req.path }, 'client_error');
    }

    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details && { details: err.details }),
      },
    });
    return;
  }

  // Unknown errors — never leak internals
  logger.error({ err, path: req.path, method: req.method }, 'unhandled_error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
};
```

## Async Error Boundaries

Express 5 handles rejected promises in route handlers automatically. For Express 4 or custom middleware:

```typescript
// Wrapper for Express 4
function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
```

## Process-Level Error Handlers

```typescript
// In src/index.ts — after server setup
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled_rejection');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught_exception');
  process.exit(1);
});
```

## Patterns

- **Throw `AppError` subclasses** from services — the error handler converts them to HTTP responses.
- **Log at the boundary** — log errors in the error handler, not in every service method.
- **Never catch and ignore** — either handle, re-throw, or log and re-throw.
- **Use `cause` for error chains** — `new AppError('DB_FAILED', 'Query failed', 500, { cause: dbError })`.

## Never

- **No `try {} catch {} // ignore`** — always handle or re-throw.
- **No error details in 5xx responses** — return generic message, log full error server-side.
- **No `throw new Error('string')` in service code** — use typed `AppError` subclasses.
- **No `console.error`** — use `logger.error({ err })`.
