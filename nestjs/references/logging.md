# Logging

## nestjs-pino (Recommended)

```typescript
// app.module.ts
import { LoggerModule } from 'nestjs-pino';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport: process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
        autoLogging: true,  // Log every request
      },
    }),
  ],
})
export class AppModule {}

// main.ts
import { Logger } from 'nestjs-pino';
app.useLogger(app.get(Logger));  // Replace built-in logger
```

## Usage in Services

```typescript
import { Logger } from '@nestjs/common';  // or InjectPinoLogger

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  async create(dto: CreateUserDto) {
    this.logger.log(`Creating user: ${dto.email}`);
    // ... create user ...
    this.logger.log(`User created: ${user.id}`);
  }
}
```

With `nestjs-pino`, the `Logger` is backed by pino — structured JSON in production, pretty-printed in dev.

## Built-in Logger (No Dependencies)

```typescript
import { Logger } from '@nestjs/common';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  async findOne(id: string) {
    this.logger.log(`Finding user ${id}`);
    this.logger.warn(`User ${id} has expired subscription`);
    this.logger.error(`Failed to find user ${id}`, error.stack);
  }
}
```

## Rules

- **`nestjs-pino` for production** — structured JSON, request correlation, auto-logging
- **Built-in `Logger`** for simple projects — no extra dependency
- **Logger per class** — `new Logger(ClassName.name)` for context
- **Log at service level** — not in controllers or repositories

## Never

- **No `console.log`** — use NestJS Logger
- **No PII in logs** — user IDs only, no emails/names/tokens
- **No logging in constructors** — use `onModuleInit` for startup logging
