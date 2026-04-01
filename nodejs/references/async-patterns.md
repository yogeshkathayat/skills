# Async Patterns

## Promise Handling

```typescript
// ✓ Always handle rejections
try {
  const result = await fetchData();
} catch (err) {
  logger.error({ err }, 'fetch_failed');
  throw new AppError('FETCH_FAILED', 'Data fetch failed', 500);
}

// ✓ Parallel independent operations
const [users, products] = await Promise.all([
  db.user.findMany(),
  db.product.findMany(),
]);

// ✓ Settle when partial failure is acceptable
const results = await Promise.allSettled(urls.map(fetchUrl));
const successes = results.filter(r => r.status === 'fulfilled').map(r => r.value);
const failures = results.filter(r => r.status === 'rejected');
```

## AbortController

```typescript
// Timeout for external requests
async function fetchWithTimeout(url: string, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

// Cancel on request abort (Express)
app.get('/api/slow', async (req, res) => {
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  const data = await longRunningOperation({ signal: controller.signal });
  res.json(data);
});
```

## Streams

```typescript
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';

// File processing with backpressure
await pipeline(
  createReadStream('input.csv'),
  new Transform({
    transform(chunk, encoding, callback) {
      const processed = processChunk(chunk);
      callback(null, processed);
    },
  }),
  createWriteStream('output.csv'),
);

// Streaming HTTP response
app.get('/api/export', async (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  const stream = db.user.findMany({ stream: true });
  await pipeline(stream, csvTransform, res);
});
```

## Worker Threads

```typescript
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

// Main thread — offload CPU work
function runInWorker<T>(script: string, data: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(script, { workerData: data });
    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
    });
  });
}

// Worker script
if (!isMainThread) {
  const result = heavyComputation(workerData);
  parentPort!.postMessage(result);
}
```

Use workers for: image processing, PDF generation, data parsing, cryptographic operations.

## Graceful Shutdown

See `http-server.md` for the full shutdown pattern. Key points:

1. Stop accepting new connections
2. Wait for in-flight requests (with timeout)
3. Close external connections (DB, Redis, queues)
4. Exit

## Retry with Backoff

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  { maxAttempts = 3, baseDelayMs = 1000 } = {},
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      const delay = baseDelayMs * 2 ** (attempt - 1) + Math.random() * 100;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}
```

## Never

- **No `await` in loops when operations are independent** — use `Promise.all()`
- **No blocking the event loop** — heavy computation goes to worker threads
- **No unhandled rejections** — always catch or let the process-level handler crash
- **No `setTimeout` as a retry mechanism** — use structured retry with backoff and max attempts
- **No synchronous file I/O in request handlers** — use `fs/promises`
