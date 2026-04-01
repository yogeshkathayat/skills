# Health Checks

## Dockerfile HEALTHCHECK

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1
```

## Without curl (minimal images)

```dockerfile
# Node.js — use a built-in script
HEALTHCHECK CMD node -e "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Go — compiled binary does its own check
HEALTHCHECK CMD ["/healthcheck"]

# wget (available in alpine)
HEALTHCHECK CMD wget -qO- http://localhost:3000/health || exit 1
```

## Compose Health Checks

```yaml
services:
  api:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s

  postgres:
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

  mongo:
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 10s

  rabbitmq:
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "check_running"]
      interval: 30s
```

## Health Endpoint Implementation

```typescript
app.get('/health', async (req, res) => {
  const checks: Record<string, string> = {};

  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch {
    checks.database = 'fail';
  }

  try {
    await redis.ping();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'fail';
  }

  const allOk = Object.values(checks).every(v => v === 'ok');
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'healthy' : 'degraded',
    checks,
    uptime: process.uptime(),
  });
});
```

## Parameters

| Parameter | Default | Purpose |
|-----------|---------|---------|
| `interval` | 30s | Time between checks |
| `timeout` | 30s | Max time for check to complete |
| `start-period` | 0s | Grace period for container startup |
| `retries` | 3 | Failures before marking unhealthy |

## Rules

- **Every long-running service gets a health check** — APIs, workers, databases
- **`start-period` for slow starters** — JVM apps, migration-on-boot services
- **Check dependencies** — health endpoint should verify DB and cache connectivity
- **Return 503 on degraded** — let orchestrators route traffic away
