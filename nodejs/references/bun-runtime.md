# Bun Runtime

Load this reference when `bun.lockb` or `bunfig.toml` exists in the project.

## Detection

```
bun.lockb          → Bun is the package manager (and likely the runtime)
bunfig.toml        → Bun configuration present
```

## Key Differences from Node.js

| Area | Node.js | Bun |
|------|---------|-----|
| HTTP server | `http.createServer()` or framework | `Bun.serve()` (native, faster) |
| File I/O | `fs/promises` | `Bun.file()` (native, zero-copy) |
| Testing | vitest / jest | `bun test` (jest-compatible, built-in) |
| Bundling | esbuild / vite | `bun build` (native) |
| Package install | `npm install` / `pnpm install` | `bun install` (much faster) |
| Shell scripting | `child_process` / `execa` | `Bun.$` (tagged template) |
| SQLite | better-sqlite3 | `bun:sqlite` (built-in) |
| Hot reload | nodemon / tsx watch | `bun --hot` (built-in) |
| Env loading | dotenv | Built-in (auto-loads .env) |
| TypeScript | tsx / ts-node | Native (no compile step) |

## Bun.serve()

```typescript
Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/api/health') {
      return Response.json({ status: 'ok' });
    }

    if (url.pathname === '/api/users' && req.method === 'POST') {
      const body = await req.json();
      const user = await createUser(body);
      return Response.json(user, { status: 201 });
    }

    return new Response('Not Found', { status: 404 });
  },
  error(err) {
    logger.error({ err }, 'server_error');
    return new Response('Internal Server Error', { status: 500 });
  },
});
```

For complex routing, use Hono on Bun instead of raw `Bun.serve()`.

## Bun.file()

```typescript
// Read file (zero-copy, lazy)
const file = Bun.file('./data.json');
const content = await file.json();  // or .text(), .arrayBuffer(), .stream()
const size = file.size;             // No stat() needed
const type = file.type;             // MIME type

// Write file
await Bun.write('./output.json', JSON.stringify(data));
await Bun.write('./copy.txt', Bun.file('./original.txt'));  // File-to-file copy
```

## Bun.$ (Shell)

```typescript
import { $ } from 'bun';

// Run shell commands with tagged templates
const result = await $`ls -la ./src`;
console.log(result.text());

// With variables (auto-escaped)
const dir = './src';
await $`find ${dir} -name "*.ts" -type f`;

// Pipe
const count = await $`find ./src -name "*.ts" | wc -l`.text();

// Error handling
try {
  await $`command-that-might-fail`;
} catch (err) {
  console.error(`Exit code: ${err.exitCode}`);
}
```

## bun test

```typescript
// tests/users.test.ts — jest-compatible API
import { describe, it, expect, mock, beforeEach } from 'bun:test';

describe('createUser', () => {
  it('creates a user', async () => {
    const result = await createUser({ email: 'test@test.com' });
    expect(result.id).toBeDefined();
  });
});

// Run
// bun test                    # All tests
// bun test tests/users        # Specific file/dir
// bun test --coverage         # With coverage
// bun test --watch            # Watch mode
```

## bun build

```typescript
await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  target: 'bun',        // or 'node', 'browser'
  minify: true,
  sourcemap: 'external',
});
```

CLI equivalent:
```bash
bun build ./src/index.ts --outdir ./dist --target bun --minify
```

## When to Use Bun-Native vs Node.js APIs

| Task | Use |
|------|-----|
| HTTP server (simple) | `Bun.serve()` |
| HTTP server (complex routing) | Hono on Bun |
| File read/write | `Bun.file()` / `Bun.write()` |
| Shell commands | `Bun.$` |
| SQLite | `bun:sqlite` |
| Testing | `bun test` |
| Everything else (streams, crypto, path, etc.) | Node.js APIs (fully compatible) |

## Rules

- **Prefer Bun-native APIs** when they exist — they're faster and simpler
- **Use Node.js compat** for everything Bun doesn't replace (streams, crypto, worker_threads)
- **Hono over raw Bun.serve()** for anything beyond trivial routing
- **`bun test` over vitest** — built-in, faster, jest-compatible
- **No dotenv import** — Bun auto-loads `.env` files

## Never

- **No `bun install` without lockfile in CI** — use `bun install --frozen-lockfile`
- **No `node_modules` assumptions** — Bun's module resolution may differ in edge cases
- **No Bun-only APIs in code that must also run on Node.js** — feature-detect or use Node.js compat
