# Stack — Locked Decisions & Toolchain

Every other reference file assumes these decisions. Do not deviate.

## Runtime

| Decision | Default | Notes |
|----------|---------|-------|
| Runtime | Node.js 22 LTS | Or Bun 1.x — check `bun.lockb` / `bunfig.toml` |
| Language | TypeScript 5.x strict | `noUncheckedIndexedAccess`, `noImplicitReturns`, `exactOptionalPropertyTypes` |
| Module system | ESM (`"type": "module"`) | CommonJS only for legacy compatibility layers |
| Package manager | pnpm | Or npm/yarn/bun — check lockfile |

## TypeScript — tsconfig.json strict settings

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "moduleResolution": "bundler",
    "module": "esnext",
    "target": "es2022",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

`noUncheckedIndexedAccess` is non-negotiable. Without it, `obj[key]` appears as `T` instead of `T | undefined`, hiding real bugs.

## Framework

| Framework | When |
|-----------|------|
| Express 5 | Established projects, large middleware ecosystem |
| Fastify 5 | Performance-critical APIs, schema-based validation |
| Hono | Edge-first, Bun-native, lightweight APIs |
| None | CLI tools, workers, scripts |

Detect from `package.json` dependencies. If unclear, ask.

## Database

| ORM/Query Builder | When |
|-------------------|------|
| Prisma | Type-safe ORM, schema-first, migrations |
| Drizzle | Lightweight, SQL-close, good for edge/Bun |
| Knex | Query builder only, existing projects |
| None | CLI tools, stateless services |

## Key Dependencies

| Category | Default | Alternative |
|----------|---------|------------|
| Validation | Zod | AJV (for JSON Schema compat) |
| Logging | pino | winston (legacy projects only) |
| Testing | vitest | jest (legacy), bun test (Bun runtime) |
| HTTP testing | supertest | undici fetch |
| Queues | BullMQ + Redis | None for simple services |
| Caching | Redis (ioredis) | In-memory LRU for single-instance |
| Auth | jose (JWT), passport | Framework-specific auth plugins |
| CLI | commander | yargs, citty |
| Config | dotenv + Zod | @nestjs/config for Nest projects |

## Build validation pipeline

```bash
# 1. Lint
npx eslint .

# 2. Typecheck
npx tsc --noEmit

# 3. Test
npx vitest run        # or: bun test

# 4. Build (if applicable)
npx tsc               # or: bun build ./src/index.ts --outdir ./dist
```

## Never

- **No `any`** — use `unknown` and narrow with type guards or Zod.
- **No `as` assertions** — unless justified with a `// REASON:` comment.
- **No `console.log` in production** — use pino. Lint rule: flag `console.log` as error.
- **No CommonJS `require()`** — use ESM `import`. Exception: legacy deps that don't support ESM.
- **No synchronous file I/O in server code** — use `fs/promises` or Bun equivalents.
- **No `eval()` or `new Function()`** — ever.
- **No hardcoded secrets** — env vars validated at startup.
