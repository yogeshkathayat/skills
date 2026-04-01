# Queues — BullMQ

## Setup

```typescript
// app.module.ts
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { host: config.get('REDIS_HOST'), port: config.get('REDIS_PORT') },
      }),
    }),
  ],
})
export class AppModule {}

// emails/emails.module.ts
@Module({
  imports: [BullModule.registerQueue({ name: 'emails' })],
  providers: [EmailsService, EmailProcessor],
})
export class EmailsModule {}
```

## Producer

```typescript
@Injectable()
export class EmailsService {
  constructor(@InjectQueue('emails') private emailQueue: Queue) {}

  async sendWelcome(userId: string) {
    await this.emailQueue.add('welcome', { userId }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }
}
```

## Consumer

```typescript
@Processor('emails')
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);

  @Process('welcome')
  async handleWelcome(job: Job<{ userId: string }>) {
    this.logger.log(`Processing welcome email for ${job.data.userId}`);
    await this.sendEmail(job.data.userId, 'welcome');
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} failed: ${error.message}`, error.stack);
  }
}
```

## Rules

- **Idempotent processors** — jobs may retry
- **Small payloads** — store IDs, fetch in processor
- **Separate worker processes** in production
- **Set `removeOnComplete`/`removeOnFail`** — prevent Redis bloat
