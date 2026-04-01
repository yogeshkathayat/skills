---
name: nestjs
version: 1.0.0
description: |
  NestJS reference skill: modules, controllers, providers, DTOs with class-validator, TypeORM/Prisma,
  guards, interceptors, pipes, queues (BullMQ), WebSockets, microservices, testing, OpenAPI, and
  CLI scaffolding. Use when the task touches NestJS application code and should follow the project's
  module-based architecture.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
paths:
  - "src/**/*.ts"
  - "src/**/*.module.ts"
  - "src/**/*.controller.ts"
  - "src/**/*.service.ts"
  - "src/**/*.guard.ts"
  - "src/**/*.interceptor.ts"
  - "src/**/*.pipe.ts"
  - "src/**/*.dto.ts"
  - "src/**/*.entity.ts"
  - "src/**/*.spec.ts"
  - "test/**/*.ts"
  - "nest-cli.json"
  - "package.json"
  - "tsconfig.json"
  - "tsconfig.build.json"
argument-hint: "[NestJS module, endpoint, or subsystem task]"
arguments:
  - request
when_to_use: |
  Use when the task touches NestJS application code: modules, controllers, services, guards,
  interceptors, pipes, DTOs, entities, queues, WebSockets, microservices, or tests. Examples:
  "add a NestJS endpoint", "create a new module", "add a guard", "wire up BullMQ", "fix this
  interceptor", "add OpenAPI decorators". Do not use for plain Express/Fastify work without
  NestJS decorators, or when the nodejs skill is a better match.
effort: high
---

<EXTREMELY-IMPORTANT>
This skill is a routing shell over the NestJS reference set.

Non-negotiable rules:
1. Read `references/stack.md` first to understand the project's NestJS version, ORM, and locked decisions.
2. Then load only the references needed for the actual task.
3. **One module per domain** — controllers, services, DTOs, and entities live together in their module directory.
4. **Controllers are thin** — validate (DTO + pipe), delegate (service), return. No business logic.
5. **All input validated via DTOs** — class-validator decorators on every DTO, `ValidationPipe` globally.
6. **Dependency injection everywhere** — never `new Service()`. Inject via constructor, provide via module.
7. **No circular dependencies** — use `forwardRef()` only as a last resort, prefer restructuring.
8. **Keep the heavy NestJS guidance in `references/`, not inline here.**
</EXTREMELY-IMPORTANT>

# nestjs

## Inputs

- `$request`: The NestJS module, endpoint, subsystem, or feature being worked on

## Goal

Route NestJS work through the project's module-based architecture so implementation follows the established patterns for dependency injection, validation, data access, and request lifecycle.

## Step 0: Read the stack contract

Always start with:

- `references/stack.md`

That establishes: NestJS version, ORM (TypeORM/Prisma/Drizzle), package manager, auth strategy, queue system, and locked dependency choices.

**Success criteria**: The project's NestJS architecture and locked decisions are explicit before implementation starts.

## Step 1: Load only the relevant references

Use the routing table to pick reference files. Do not bulk-load the full reference tree.

| Task | Read |
|------|------|
| NestJS version, ORM, key deps, CLI, project layout | `references/stack.md` |
| Folder conventions, module organization, barrel exports | `references/project-structure.md` |
| Creating or editing a module | `references/modules.md` |
| Controllers, route decorators, request lifecycle | `references/controllers.md` |
| Services, providers, dependency injection | `references/providers.md` |
| DTOs, class-validator, ValidationPipe, transformation | `references/validation.md` |
| TypeORM entities, repositories, migrations | `references/typeorm.md` |
| Prisma integration with NestJS | `references/prisma.md` |
| Guards, authentication, authorization, JWT, Passport | `references/auth.md` |
| Interceptors, logging, caching, response mapping | `references/interceptors.md` |
| Pipes, custom validation, parameter transformation | `references/pipes.md` |
| Exception filters, custom exceptions, error responses | `references/error-handling.md` |
| BullMQ queues, processors, flows | `references/queues.md` |
| WebSocket gateways, events, rooms | `references/websockets.md` |
| Microservices, transports, message patterns | `references/microservices.md` |
| OpenAPI/Swagger decorators, schema generation | `references/openapi.md` |
| Unit tests, e2e tests, testing module, mocking | `references/testing.md` |
| Configuration, ConfigModule, env validation | `references/config.md` |
| Middleware, lifecycle hooks, shutdown | `references/middleware.md` |
| Logging with pino or built-in logger | `references/logging.md` |
| Health checks, Terminus | `references/health.md` |
| CQRS, events, sagas | `references/cqrs.md` |
| Scheduling, cron jobs, intervals | `references/scheduling.md` |
| Docker, deployment, production setup | `references/docker.md` |

Multiple tasks? Read multiple files. The references are self-contained.

**Success criteria**: Only the task-relevant NestJS conventions are in play.

## Step 2: Implement with the core NestJS guardrails

Keep these rules active:

- every module declares its controllers, providers, imports, and exports explicitly
- controllers validate via DTOs + `ValidationPipe`, delegate to services, return typed responses
- services contain business logic, injected via constructor — never instantiated with `new`
- entities/models are separate from DTOs — never return a raw entity from a controller
- guards handle auth/authz, interceptors handle cross-cutting concerns, pipes handle transformation
- all external input has a DTO with class-validator decorators
- database mutations wrapped in transactions where atomicity matters
- use `@nestjs/config` with Zod or Joi validation for env vars

**Success criteria**: The change fits the project's NestJS module architecture instead of bypassing the framework.

## Step 3: Verify the affected surface

Use the narrowest relevant verification:

- unit tests (`jest --testPathPattern=<module>`)
- e2e tests (`jest --config test/jest-e2e.json`)
- type checking (`tsc --noEmit`)
- linting (`eslint .`)
- OpenAPI spec regeneration if decorators changed

**Success criteria**: The changed NestJS surface still builds, type-checks, and passes tests.

## Guardrails

- Do not inline the whole NestJS handbook in `SKILL.md`.
- Do not skip `references/stack.md`.
- Do not put business logic in controllers — delegate to services.
- Do not return raw entities — use DTOs or serialization interceptors.
- Do not bypass dependency injection — never `new Service()`.
- Do not create circular module dependencies without exhausting alternatives first.
- Do not use `@nestjs/common` barrel imports for types — import from specific subpaths when possible.
- Do not add `disable-model-invocation`; this is a normal domain skill.

## When To Load References

- `references/stack.md`
  Always.

- then only the task-relevant files under `references/`

## Output Contract

Report:

1. which NestJS references were loaded
2. the module and architecture pattern chosen
3. the change made
4. the verification run
