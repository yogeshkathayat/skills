# Stack — Locked Decisions & Toolchain

Every other reference file assumes these decisions. Do not deviate.

## Runtime

| Decision | Default | Notes |
|----------|---------|-------|
| Runtime | Node.js 22 LTS | Bun support experimental in NestJS 10+ |
| Language | TypeScript 5.x strict | `strictNullChecks`, `noImplicitAny`, decorators enabled |
| NestJS | v11 | `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express` |
| HTTP platform | Express (default) | Or Fastify via `@nestjs/platform-fastify` |
| Package manager | pnpm | Or npm/yarn — check lockfile |

## TypeScript — tsconfig.json

```jsonc
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2022",
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "strictBindCallApply": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

`emitDecoratorMetadata` and `experimentalDecorators` are required for NestJS DI to work.

## ORM

| ORM | When |
|-----|------|
| TypeORM | NestJS default, decorator-based entities, active record or repository pattern |
| Prisma | Schema-first, type-safe, better DX for new projects |
| Drizzle | Lightweight, SQL-close, edge-compatible |
| MikroORM | Unit-of-work pattern, identity map |

Detect from `package.json` and config files. If unclear, ask.

## Key Dependencies

| Category | Package | Notes |
|----------|---------|-------|
| Validation | `class-validator` + `class-transformer` | DTO validation via decorators |
| Config | `@nestjs/config` | `ConfigModule.forRoot()` with validation |
| Auth | `@nestjs/passport` + `@nestjs/jwt` | Or custom guards with `jose` |
| Queues | `@nestjs/bullmq` | BullMQ integration |
| Caching | `@nestjs/cache-manager` | Redis or in-memory |
| OpenAPI | `@nestjs/swagger` | Auto-generates from decorators |
| Testing | Jest (built-in) | `@nestjs/testing` for test modules |
| Logging | `nestjs-pino` | Or built-in `Logger` |
| Health | `@nestjs/terminus` | Health check endpoints |
| Scheduling | `@nestjs/schedule` | Cron, intervals, timeouts |
| WebSockets | `@nestjs/websockets` + `@nestjs/platform-socket.io` | Or ws adapter |
| Microservices | `@nestjs/microservices` | TCP, Redis, NATS, Kafka, gRPC |
| CQRS | `@nestjs/cqrs` | Commands, queries, events, sagas |

## NestJS CLI

```bash
nest new project-name                    # New project
nest generate module users               # Generate module
nest generate controller users           # Generate controller
nest generate service users              # Generate service
nest generate resource users             # Generate full CRUD (module + controller + service + DTOs)
nest generate guard auth                 # Generate guard
nest generate interceptor logging        # Generate interceptor
nest generate pipe validation            # Generate pipe
nest generate filter http-exception      # Generate exception filter
```

Always use `nest generate resource` for new CRUD domains — it scaffolds the full module structure.

## Build & Run

```bash
# Development
pnpm start:dev                           # Watch mode (ts-node or SWC)

# Build
pnpm build                               # Compile to dist/

# Production
node dist/main.js                        # Run compiled output

# Test
pnpm test                                # Unit tests
pnpm test:e2e                            # E2E tests
pnpm test:cov                            # Coverage
```

## Never

- **No business logic in controllers** — controllers validate, delegate, respond.
- **No `new Service()`** — always inject via constructor, provide via module.
- **No raw entities in responses** — use DTOs, serialization interceptors, or `@Exclude()`.
- **No `any`** — use `unknown` and narrow.
- **No circular module imports** — restructure into shared modules or use `forwardRef()` as last resort.
- **No global providers without `@Global()`** — be explicit about module boundaries.
- **No synchronous lifecycle hooks** — `onModuleInit`, `onApplicationShutdown` should be async.
