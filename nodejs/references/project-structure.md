# Project Structure

## Standard Layout

```
project-root/
├── src/
│   ├── index.ts              # Entry point — starts server, wires dependencies
│   ├── server.ts             # HTTP server setup (Express/Fastify/Hono app)
│   ├── config.ts             # Env validation with Zod, exported config object
│   ├── routes/               # Route definitions grouped by domain
│   │   ├── index.ts          # Route aggregator — mounts all routers
│   │   ├── users.ts          # /api/users routes
│   │   └── products.ts       # /api/products routes
│   ├── controllers/          # Request handlers (thin — validate, delegate, respond)
│   ├── services/             # Business logic (framework-agnostic)
│   ├── repositories/         # Data access layer (ORM/query builder calls)
│   ├── middleware/            # Auth, validation, error handling, logging
│   ├── lib/                  # Shared utilities
│   │   ├── logger.ts         # pino instance
│   │   ├── db.ts             # Database client/connection
│   │   ├── redis.ts          # Redis client
│   │   └── errors.ts         # Custom error classes
│   ├── jobs/                 # Queue job processors
│   ├── types/                # Shared TypeScript types and Zod schemas
│   └── generated/            # Prisma client, OpenAPI types (gitignored or committed)
├── tests/
│   ├── unit/                 # Pure logic tests
│   ├── integration/          # API/database tests
│   └── fixtures/             # Test data factories
├── scripts/                  # Build, seed, migration helpers
├── .env.example              # Documented env var template (no secrets)
├── .env                      # Local secrets (gitignored)
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
└── vitest.config.ts          # or jest.config.ts
```

## Rules

- **One entry point** — `src/index.ts` starts the server and wires top-level dependencies.
- **Separate server from app** — `server.ts` creates the app, `index.ts` calls `listen()`. This lets tests import the app without starting a listener.
- **Group by domain, not by type** — for larger projects, use `src/modules/users/` containing controller, service, repository, routes, and schemas together.
- **No business logic in routes or controllers** — controllers validate input (Zod), call a service, return a response.
- **Test directory mirrors src** — `tests/unit/services/users.test.ts` tests `src/services/users.ts`.
- **Generated code is separate** — Prisma client in `src/generated/` or `node_modules/.prisma`.

## Monorepo Layout

```
monorepo-root/
├── packages/
│   ├── api/                  # HTTP service
│   ├── worker/               # Queue consumer
│   ├── shared/               # Shared types, utils, schemas
│   └── cli/                  # CLI tool
├── package.json              # Workspace root
├── pnpm-workspace.yaml       # or turborepo.json
└── tsconfig.base.json        # Shared TS config, extended by each package
```

Use `workspace:*` protocol for internal dependencies. Shared code goes in `packages/shared/`, not copy-pasted.
