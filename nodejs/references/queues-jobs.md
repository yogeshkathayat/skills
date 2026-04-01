# Queues & Jobs — BullMQ

## Setup

```typescript
// src/lib/queue.ts
import { Queue, Worker } from 'bullmq';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';

const connection = { connection: redis };

// Define queue
export const emailQueue = new Queue('email', connection);

// Define worker
const emailWorker = new Worker('email', async (job) => {
  const log = logger.child({ module: 'worker:email', jobId: job.id });
  log.info({ to: job.data.to, template: job.data.template }, 'processing_email');

  await sendEmail(job.data);

  log.info('email_sent');
}, {
  ...connection,
  concurrency: 5,
  limiter: { max: 10, duration: 1000 }, // 10 jobs/sec
});

emailWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err, attempt: job?.attemptsMade }, 'email_job_failed');
});
```

## Adding Jobs

```typescript
// From a service or route handler
await emailQueue.add('welcome', {
  to: user.email,
  template: 'welcome',
  data: { name: user.name },
}, {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 1000,  // Keep last 1000 completed
  removeOnFail: 5000,      // Keep last 5000 failed
});

// Delayed job
await emailQueue.add('reminder', data, { delay: 24 * 60 * 60 * 1000 }); // 24h

// Repeatable job (cron)
await emailQueue.add('daily-digest', {}, {
  repeat: { pattern: '0 9 * * *' }, // 9am daily
});
```

## Job Patterns

### Retry with Backoff

```typescript
{
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 2000, // 2s, 4s, 8s, 16s, 32s
  },
}
```

### Dead-Letter Queue

```typescript
const dlq = new Queue('email-dlq', connection);

emailWorker.on('failed', async (job, err) => {
  if (job && job.attemptsMade >= job.opts.attempts!) {
    await dlq.add('dead', { originalJob: job.data, error: err.message, failedAt: new Date() });
    logger.error({ jobId: job.id, err }, 'job_moved_to_dlq');
  }
});
```

### Job Progress

```typescript
const worker = new Worker('export', async (job) => {
  const items = await getItems();
  for (let i = 0; i < items.length; i++) {
    await processItem(items[i]);
    await job.updateProgress(Math.round((i / items.length) * 100));
  }
});
```

## Graceful Worker Shutdown

```typescript
// In SIGTERM handler
async function shutdown() {
  await emailWorker.close(); // Waits for current jobs to finish
  await emailQueue.close();
  // ... close other resources
}
```

## Rules

- **Idempotent jobs** — jobs may be retried; processing the same job twice should be safe
- **Small payloads** — store IDs in job data, fetch full records in the worker
- **Log job lifecycle** — start, success, failure with job ID and attempt count
- **Set `removeOnComplete`/`removeOnFail`** — prevent unbounded Redis memory growth
- **Separate workers from API servers** — run queue processors as dedicated services in production

## Never

- **No large payloads in job data** — Redis stores all job data; keep it small
- **No synchronous processing in API handlers** — if it takes > 1s, queue it
- **No jobs without retry strategy** — network errors are normal
- **No infinite retries** — set `attempts` limit and handle dead letters
