# Interceptors

Interceptors wrap route handler execution. They can transform the result, add logging, apply caching, or modify the response.

## Response Transform Interceptor

```typescript
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, { data: T }> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<{ data: T }> {
    return next.handle().pipe(map(data => ({ data })));
  }
}
```

## Logging Interceptor

```typescript
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: Logger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const { method, url } = req;
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - start;
        this.logger.log({ method, url, duration }, 'request_completed');
      }),
    );
  }
}
```

## Cache Interceptor

```typescript
@UseInterceptors(CacheInterceptor)
@CacheTTL(60)  // 60 seconds
@Get()
findAll() { ... }
```

## Serialization (class-transformer)

```typescript
// Exclude sensitive fields from entity
@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  email: string;

  @Exclude()
  @Column()
  password: string;
}

// Enable globally in main.ts
app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
```

## Scope

```typescript
// Global
app.useGlobalInterceptors(new LoggingInterceptor());

// Controller
@UseInterceptors(LoggingInterceptor)
@Controller('users')
export class UsersController {}

// Route
@UseInterceptors(CacheInterceptor)
@Get()
findAll() {}
```

## Rules

- **Cross-cutting concerns only** — logging, caching, transformation, timing
- **Use `ClassSerializerInterceptor`** with `@Exclude()` to hide sensitive entity fields
- **Global interceptors for universal behavior** — logging, response wrapping

## Never

- **No business logic in interceptors** — that belongs in services
- **No error handling in interceptors** — use exception filters
