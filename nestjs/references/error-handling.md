# Error Handling — Exception Filters

## Built-in Exceptions

```typescript
throw new BadRequestException('Invalid input');
throw new UnauthorizedException('Authentication required');
throw new ForbiddenException('Insufficient permissions');
throw new NotFoundException(`User ${id} not found`);
throw new ConflictException('Email already in use');
throw new UnprocessableEntityException('Business rule violated');
throw new InternalServerErrorException('Something went wrong');
```

NestJS auto-maps these to HTTP status codes and returns structured JSON:

```json
{
  "statusCode": 404,
  "message": "User abc not found",
  "error": "Not Found"
}
```

## Custom Exception Filter

```typescript
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = exception instanceof HttpException
      ? exception.getResponse()
      : 'Internal server error';

    if (status >= 500) {
      this.logger.error({ err: exception, path: request.url, method: request.method }, 'server_error');
    }

    response.status(status).json({
      statusCode: status,
      message: typeof message === 'string' ? message : (message as any).message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}

// Register globally in main.ts
app.useGlobalFilters(new AllExceptionsFilter(logger));
```

## Domain Exceptions

```typescript
// For business logic errors that map to specific HTTP status
export class InsufficientStockException extends UnprocessableEntityException {
  constructor(productId: string) {
    super(`Insufficient stock for product ${productId}`);
  }
}

export class DuplicateEmailException extends ConflictException {
  constructor() {
    super('Email already in use');
  }
}
```

## Validation Exception Factory

```typescript
// main.ts — customize validation error format
app.useGlobalPipes(new ValidationPipe({
  exceptionFactory: (errors) => {
    const messages = errors.map(err => ({
      field: err.property,
      errors: Object.values(err.constraints ?? {}),
    }));
    return new BadRequestException({ message: 'Validation failed', details: messages });
  },
}));
```

## Rules

- **Use built-in exceptions** for standard HTTP errors
- **Create domain exceptions** for business logic errors
- **Global exception filter** catches everything — log 5xx, format consistently
- **Never expose stack traces** in production responses

## Never

- **No try/catch in controllers for HTTP errors** — throw exceptions, let filters handle them
- **No `res.status().json()` in controllers** — return values, throw exceptions
- **No swallowed exceptions** — always throw or log
