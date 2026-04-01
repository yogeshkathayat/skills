# Configuration

## ConfigModule Setup

```typescript
// app.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: ['.env.local', '.env'],
    }),
  ],
})
export class AppModule {}
```

## Env Validation with Zod

```typescript
// config/env.validation.ts
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  JWT_SECRET: z.string().min(32),
  CORS_ORIGIN: z.string().url(),
});

export function validateEnv(config: Record<string, unknown>) {
  return EnvSchema.parse(config);
}
```

## Typed Config Access

```typescript
@Injectable()
export class SomeService {
  constructor(private config: ConfigService) {}

  getPort(): number {
    return this.config.get<number>('PORT');
  }
}
```

## Custom Config Namespaces

```typescript
// config/database.config.ts
export default registerAs('database', () => ({
  url: process.env.DATABASE_URL,
  poolSize: parseInt(process.env.DB_POOL_SIZE ?? '10', 10),
}));

// Usage
@Inject(databaseConfig.KEY) private dbConfig: ConfigType<typeof databaseConfig>
```

## Rules

- **`isGlobal: true`** — inject `ConfigService` anywhere without importing
- **Validate at startup** — Zod or Joi, fail fast on missing config
- **Namespaces** for complex config — group related settings
- **Never read `process.env` directly** — use `ConfigService`
