# Scheduling — Cron, Intervals, Timeouts

## Setup

```typescript
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [TasksService],
})
export class TasksModule {}
```

## Cron Jobs

```typescript
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  @Cron('0 */5 * * * *')  // Every 5 minutes
  handleCleanup() {
    this.logger.log('Running cleanup task');
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  handleDailyReport() {
    this.logger.log('Generating daily report');
  }

  @Cron('0 9 * * 1-5')  // 9am weekdays
  handleWeekdayTask() {
    this.logger.log('Weekday task');
  }
}
```

## Intervals and Timeouts

```typescript
@Interval(30000)  // Every 30 seconds
handleHealthPing() {
  this.healthService.ping();
}

@Timeout(5000)  // Once, 5 seconds after app starts
handleStartupTask() {
  this.logger.log('Startup task');
}
```

## Dynamic Scheduling

```typescript
constructor(private schedulerRegistry: SchedulerRegistry) {}

addCronJob(name: string, cronTime: string) {
  const job = new CronJob(cronTime, () => {
    this.logger.log(`Dynamic job ${name} fired`);
  });
  this.schedulerRegistry.addCronJob(name, job);
  job.start();
}

deleteCronJob(name: string) {
  this.schedulerRegistry.deleteCronJob(name);
}
```

## Rules

- **Idempotent jobs** — scheduled tasks may run on multiple instances; use distributed locks if needed
- **Short execution time** — don't block the event loop; queue heavy work via BullMQ
- **Logging** — log every scheduled task execution for debugging
- **Named constants** — use `CronExpression` enum over raw cron strings when possible
