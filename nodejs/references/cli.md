# CLI Tools

## Commander

```typescript
// src/cli.ts
import { Command } from 'commander';
import { config } from '@/config';
import { logger } from '@/lib/logger';

const program = new Command()
  .name('mytool')
  .version('1.0.0')
  .description('Description of the tool');

program
  .command('migrate')
  .description('Run database migrations')
  .option('--dry-run', 'Show what would be migrated without applying')
  .action(async (options) => {
    try {
      const result = await runMigrations({ dryRun: options.dryRun });
      logger.info({ migrations: result.applied }, 'migrations_complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'migration_failed');
      process.exit(1);
    }
  });

program
  .command('seed')
  .description('Seed the database with test data')
  .option('--count <n>', 'Number of records', '100')
  .action(async (options) => {
    await seedDatabase(Number(options.count));
    process.exit(0);
  });

program.parse();
```

## Argument Validation

```typescript
import { z } from 'zod';

const MigrateOptions = z.object({
  dryRun: z.boolean().default(false),
  target: z.string().optional(),
});

program
  .command('migrate')
  .option('--dry-run')
  .option('--target <version>')
  .action(async (rawOptions) => {
    const options = MigrateOptions.parse(rawOptions);
    // options is now typed and validated
  });
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments / usage error |

```typescript
// Set exit code based on result
process.exitCode = result.success ? 0 : 1;
```

Never call `process.exit()` without flushing logs:
```typescript
logger.flush();
process.exit(code);
```

## stdin / stdout

```typescript
import { createInterface } from 'node:readline';

// Read lines from stdin (piping)
async function readStdin(): Promise<string[]> {
  if (process.stdin.isTTY) return []; // No piped input

  const rl = createInterface({ input: process.stdin });
  const lines: string[] = [];
  for await (const line of rl) {
    lines.push(line);
  }
  return lines;
}

// Structured output to stdout
function output(data: unknown) {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

// Progress to stderr (doesn't pollute stdout for piping)
function progress(message: string) {
  process.stderr.write(`${message}\n`);
}
```

## Interactive Prompts

```typescript
import { confirm, input, select } from '@inquirer/prompts';

const name = await input({ message: 'Project name:' });
const framework = await select({
  message: 'Framework:',
  choices: [
    { value: 'express', name: 'Express' },
    { value: 'fastify', name: 'Fastify' },
    { value: 'hono', name: 'Hono' },
  ],
});
const proceed = await confirm({ message: 'Continue?' });
```

## Patterns

- **Structured output to stdout** — JSON for machine consumption, formatted for humans
- **Progress/errors to stderr** — keeps stdout clean for piping
- **Validate args with Zod** — same pattern as HTTP request validation
- **Graceful error handling** — catch at top level, log, exit with appropriate code
- **`bin` field in package.json** — `"bin": { "mytool": "./dist/cli.js" }`

## Never

- **No `console.log` for machine output** — use `process.stdout.write`
- **No swallowed errors** — always exit with non-zero on failure
- **No interactive prompts without TTY check** — skip prompts when piped
- **No global state between commands** — each command is independent
