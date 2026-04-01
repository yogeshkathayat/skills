# Modules

## Basics

Every NestJS application is organized as a tree of modules. Each module encapsulates a cohesive set of capabilities.

```typescript
@Module({
  imports: [],        // Other modules this module depends on
  controllers: [],    // Controllers that handle HTTP routes
  providers: [],      // Services, repositories, factories, helpers
  exports: [],        // Providers available to modules that import this one
})
export class UsersModule {}
```

## Dynamic Modules

```typescript
// database.module.ts
@Module({})
export class DatabaseModule {
  static forRoot(options: DatabaseOptions): DynamicModule {
    return {
      module: DatabaseModule,
      global: true,
      providers: [
        { provide: 'DATABASE_OPTIONS', useValue: options },
        DatabaseService,
      ],
      exports: [DatabaseService],
    };
  }

  static forFeature(entities: Type[]): DynamicModule {
    const repositories = entities.map(entity => ({
      provide: `${entity.name}Repository`,
      useFactory: (ds: DataSource) => ds.getRepository(entity),
      inject: [DataSource],
    }));

    return {
      module: DatabaseModule,
      providers: repositories,
      exports: repositories,
    };
  }
}
```

## Global Modules

```typescript
@Global()
@Module({
  providers: [ConfigService, LoggerService],
  exports: [ConfigService, LoggerService],
})
export class CoreModule {}
```

Use `@Global()` sparingly — only for truly universal services (config, logging). Prefer explicit imports.

## Module Registration in AppModule

```typescript
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: envSchema }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get('DATABASE_URL'),
        autoLoadEntities: true,
        synchronize: false,  // Never in production
      }),
    }),
    UsersModule,
    OrdersModule,
    AuthModule,
  ],
})
export class AppModule {}
```

## Circular Dependencies

```typescript
// Avoid — restructure first
// Last resort:
@Module({
  imports: [forwardRef(() => OrdersModule)],
})
export class UsersModule {}
```

Better solution: extract shared logic into a third module that both import.

## Rules

- **One module per domain** — not one module per file type
- **Export only what consumers need** — don't export internal helpers
- **`forRootAsync` for async config** — database, queues, external services
- **Never `synchronize: true` in production** — use migrations

## Never

- **No orphan providers** — every service must belong to a module
- **No cross-module direct imports of services** — import the module, not the file
- **No `@Global()` on feature modules** — only on infrastructure (config, logging)
