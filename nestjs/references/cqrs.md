# CQRS — Commands, Queries, Events

## Setup

```typescript
@Module({
  imports: [CqrsModule],
  providers: [CreateOrderHandler, OrderCreatedHandler],
})
export class OrdersModule {}
```

## Command

```typescript
// commands/create-order.command.ts
export class CreateOrderCommand {
  constructor(
    public readonly userId: string,
    public readonly items: OrderItem[],
  ) {}
}

// commands/handlers/create-order.handler.ts
@CommandHandler(CreateOrderCommand)
export class CreateOrderHandler implements ICommandHandler<CreateOrderCommand> {
  constructor(
    private readonly ordersRepo: Repository<Order>,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: CreateOrderCommand): Promise<Order> {
    const order = await this.ordersRepo.save({ userId: command.userId, items: command.items });
    this.eventBus.publish(new OrderCreatedEvent(order.id, command.userId));
    return order;
  }
}
```

## Event

```typescript
export class OrderCreatedEvent {
  constructor(public readonly orderId: string, public readonly userId: string) {}
}

@EventsHandler(OrderCreatedEvent)
export class OrderCreatedHandler implements IEventHandler<OrderCreatedEvent> {
  async handle(event: OrderCreatedEvent) {
    await this.emailService.sendOrderConfirmation(event.userId, event.orderId);
    await this.analyticsService.track('order_created', { orderId: event.orderId });
  }
}
```

## Usage

```typescript
@Controller('orders')
export class OrdersController {
  constructor(private commandBus: CommandBus) {}

  @Post()
  create(@Body() dto: CreateOrderDto, @CurrentUser('userId') userId: string) {
    return this.commandBus.execute(new CreateOrderCommand(userId, dto.items));
  }
}
```

## When to Use

- **Use CQRS** when reads and writes have different models or scaling needs
- **Use events** for side effects (email, analytics, cache invalidation)
- **Don't use CQRS** for simple CRUD — it adds complexity without benefit
