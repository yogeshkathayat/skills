# Middleware & Lifecycle

## Middleware

```typescript
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    req['requestId'] = req.headers['x-request-id'] ?? randomUUID();
    res.setHeader('x-request-id', req['requestId']);
    next();
  }
}

// Register in module
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
```

## Lifecycle Hooks

| Hook | When | Use for |
|------|------|---------|
| `onModuleInit` | Module dependencies resolved | DB connect, warmup |
| `onApplicationBootstrap` | All modules initialized | Start background tasks |
| `onModuleDestroy` | On `app.close()` / SIGTERM | Stop workers |
| `beforeApplicationShutdown` | Before connections close | Drain queues |
| `onApplicationShutdown` | After connections close | Final cleanup |

## Graceful Shutdown

```typescript
// main.ts
app.enableShutdownHooks();  // Required for lifecycle hooks on SIGTERM

// In a service
@Injectable()
export class WorkerService implements OnApplicationShutdown {
  async onApplicationShutdown(signal: string) {
    this.logger.log(`Shutting down on ${signal}`);
    await this.worker.close();
    await this.db.$disconnect();
  }
}
```

## Execution Order

```
Request → Middleware → Guards → Interceptors (before) → Pipes → Handler → Interceptors (after) → Exception Filters
```

## Rules

- **Middleware for raw request manipulation** — request ID, CORS, body parsing
- **Guards for auth decisions** — before the handler runs
- **Interceptors for cross-cutting** — logging, caching, transformation
- **Pipes for input validation** — DTOs, parameter parsing
- **Exception filters for error formatting** — consistent error responses
- **`enableShutdownHooks()`** — required for SIGTERM lifecycle hooks
