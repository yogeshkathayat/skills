# Health Checks — Terminus

## Setup

```typescript
// health/health.module.ts
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}

// health/health.controller.ts
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,     // or PrismaHealthIndicator
    private memory: MemoryHealthIndicator,
    private disk: DiskHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.memory.checkHeap('memory_heap', 200 * 1024 * 1024),  // 200MB
      () => this.disk.checkStorage('disk', { path: '/', thresholdPercent: 0.9 }),
    ]);
  }

  @Get('live')
  @HealthCheck()
  liveness() {
    return this.health.check([]);  // Just confirms process is alive
  }
}
```

## Custom Health Indicator

```typescript
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private redis: Redis) { super(); }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.redis.ping();
      return this.getStatus(key, true);
    } catch {
      throw new HealthCheckError('Redis check failed', this.getStatus(key, false));
    }
  }
}
```

## Kubernetes Probes

```yaml
livenessProbe:
  httpGet: { path: /health/live, port: 3000 }
  initialDelaySeconds: 10
  periodSeconds: 30
readinessProbe:
  httpGet: { path: /health, port: 3000 }
  initialDelaySeconds: 5
  periodSeconds: 10
```
