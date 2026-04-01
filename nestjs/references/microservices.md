# Microservices

## Hybrid Application (HTTP + Microservice)

```typescript
// main.ts
const app = await NestFactory.create(AppModule);

// Add TCP transport
app.connectMicroservice<MicroserviceOptions>({
  transport: Transport.TCP,
  options: { host: '0.0.0.0', port: 3001 },
});

// Add Redis transport
app.connectMicroservice<MicroserviceOptions>({
  transport: Transport.REDIS,
  options: { host: 'localhost', port: 6379 },
});

await app.startAllMicroservices();
await app.listen(3000);
```

## Message Patterns (Request/Response)

```typescript
// Service (responder)
@Controller()
export class UsersController {
  @MessagePattern({ cmd: 'get_user' })
  getUser(@Payload() data: { id: string }) {
    return this.usersService.findOne(data.id);
  }
}

// Client (requester)
@Injectable()
export class OrdersService {
  constructor(@Inject('USERS_SERVICE') private usersClient: ClientProxy) {}

  async getUser(id: string) {
    return firstValueFrom(this.usersClient.send({ cmd: 'get_user' }, { id }));
  }
}
```

## Events (Fire and Forget)

```typescript
// Emitter
this.client.emit('user_created', { userId: user.id, email: user.email });

// Handler
@EventPattern('user_created')
handleUserCreated(@Payload() data: { userId: string; email: string }) {
  this.emailService.sendWelcome(data.email);
}
```

## Client Registration

```typescript
@Module({
  imports: [
    ClientsModule.register([{
      name: 'USERS_SERVICE',
      transport: Transport.TCP,
      options: { host: 'users-service', port: 3001 },
    }]),
  ],
})
export class OrdersModule {}
```

## Transports

| Transport | When |
|-----------|------|
| TCP | Simple inter-service communication |
| Redis | Pub/sub, event-driven |
| NATS | High-throughput messaging |
| Kafka | Event streaming, durable logs |
| gRPC | Strongly typed, high-performance |
| RabbitMQ | Complex routing, dead-letter queues |

## Rules

- **`firstValueFrom`** for request/response — converts Observable to Promise
- **`@Payload()` and `@Ctx()`** for typed access to message data and context
- **Events for side effects** — email, notifications, analytics
- **Message patterns for queries** — fetch data from another service
