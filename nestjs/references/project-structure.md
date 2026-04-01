# Project Structure

## Standard Layout

```
src/
├── main.ts                          # Bootstrap, global pipes/filters/interceptors
├── app.module.ts                    # Root module — imports all feature modules
├── common/                          # Shared across all modules
│   ├── decorators/                  # Custom decorators (@CurrentUser, @Public, etc.)
│   ├── filters/                     # Global exception filters
│   ├── guards/                      # Auth guards, role guards
│   ├── interceptors/                # Logging, caching, transform interceptors
│   ├── pipes/                       # Custom validation pipes
│   ├── dto/                         # Shared DTOs (pagination, sorting)
│   └── interfaces/                  # Shared TypeScript interfaces
├── config/                          # Configuration module
│   ├── config.module.ts
│   └── configuration.ts             # Env validation and typed config
├── users/                           # Feature module (one per domain)
│   ├── users.module.ts              # Module declaration
│   ├── users.controller.ts          # HTTP endpoints
│   ├── users.service.ts             # Business logic
│   ├── users.repository.ts          # Data access (if not using TypeORM repos)
│   ├── dto/
│   │   ├── create-user.dto.ts       # Input validation
│   │   └── update-user.dto.ts
│   ├── entities/
│   │   └── user.entity.ts           # TypeORM entity or Prisma model reference
│   └── tests/
│       ├── users.controller.spec.ts
│       └── users.service.spec.ts
├── orders/                          # Another feature module
│   ├── orders.module.ts
│   ├── orders.controller.ts
│   ├── orders.service.ts
│   └── dto/
├── auth/                            # Auth module
│   ├── auth.module.ts
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   ├── strategies/                  # Passport strategies (jwt, local)
│   └── guards/
│       ├── jwt-auth.guard.ts
│       └── roles.guard.ts
└── database/                        # Database module
    ├── database.module.ts
    ├── migrations/
    └── seeds/
```

## Rules

- **One module per domain** — `users/`, `orders/`, `auth/` are each a NestJS module.
- **Co-locate within modules** — controller, service, DTOs, entities, and tests live together.
- **`common/` for shared** — decorators, guards, interceptors, pipes used across modules.
- **Barrel exports** — each module exports its service (and optionally entities) for other modules to import.
- **No cross-module service injection without importing the module** — if `OrdersService` needs `UsersService`, `OrdersModule` must import `UsersModule`.
- **Config in its own module** — `ConfigModule.forRoot({ isGlobal: true })` in `app.module.ts`.

## Module Declaration

```typescript
// users/users.module.ts
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],          // Export for other modules to use
})
export class UsersModule {}
```

## Monorepo (NestJS Workspaces)

```
apps/
├── api/                             # HTTP API application
│   └── src/
├── worker/                          # Queue consumer application
│   └── src/
└── gateway/                         # API gateway
    └── src/
libs/
├── common/                          # Shared library
│   └── src/
├── database/                        # Shared database module
│   └── src/
└── auth/                            # Shared auth module
    └── src/
nest-cli.json                        # Monorepo config
```

Use `nest generate app worker` and `nest generate library common` to scaffold.
