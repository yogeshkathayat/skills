# Observability

## Health Checks

```typescript
// Liveness — is the process alive?
app.get('/health/live', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Readiness — can the process serve traffic?
app.get('/health/ready', async (req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    if (redis) await redis.ping();
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not ready' });
  }
});
```

Kubernetes uses liveness for restart decisions and readiness for traffic routing.

## OpenTelemetry

```typescript
// src/instrumentation.ts — must load before any other imports
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false }, // Too noisy
    }),
  ],
});

sdk.start();

// Graceful shutdown
process.on('SIGTERM', () => sdk.shutdown());
```

Load via `--require` or `--import`:
```bash
node --import ./dist/instrumentation.js ./dist/index.js
```

Auto-instruments: HTTP, Express/Fastify, Prisma, ioredis, pg, DNS, net.

## Custom Spans

```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('my-service');

async function processOrder(orderId: string) {
  return tracer.startActiveSpan('processOrder', async (span) => {
    span.setAttribute('order.id', orderId);
    try {
      const result = await doWork(orderId);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  });
}
```

## Metrics

```typescript
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('my-service');

const requestCounter = meter.createCounter('http.requests.total');
const requestDuration = meter.createHistogram('http.request.duration', { unit: 'ms' });

// In middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    requestCounter.add(1, { method: req.method, path: req.route?.path, status: res.statusCode });
    requestDuration.record(Date.now() - start, { method: req.method, path: req.route?.path });
  });
  next();
});
```

## Structured Logging Integration

pino logs are correlated with traces via `trace_id` and `span_id`:

```typescript
import { context, trace } from '@opentelemetry/api';

// pino mixin that adds trace context to every log line
const logger = pino({
  mixin() {
    const span = trace.getSpan(context.active());
    if (span) {
      const ctx = span.spanContext();
      return { trace_id: ctx.traceId, span_id: ctx.spanId };
    }
    return {};
  },
});
```

## Rules

- **Health checks on separate endpoints** — liveness and readiness serve different purposes
- **Auto-instrumentation first** — add custom spans only where auto doesn't reach
- **Correlate logs and traces** — same `trace_id` in pino and OTel
- **Instrument at boundaries** — HTTP, DB, cache, queue, not internal function calls

## Never

- **No metrics without labels** — unlabeled counters are useless
- **No high-cardinality labels** — don't use user IDs or request bodies as metric labels
- **No OTel in test environment** — disable via `OTEL_SDK_DISABLED=true`
