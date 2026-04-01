# Prisma with NestJS

## Setup

```typescript
// prisma/prisma.service.ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

// prisma/prisma.module.ts
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

## Usage in Services

```typescript
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(query: ListUsersDto) {
    return this.prisma.user.findMany({
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, name: true, createdAt: true },
    });
  }

  findOne(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { orders: { take: 10, orderBy: { createdAt: 'desc' } } },
    });
  }

  async create(dto: CreateUserDto) {
    return this.prisma.user.create({ data: dto });
  }
}
```

## Transactions

```typescript
async createOrder(dto: CreateOrderDto) {
  return this.prisma.$transaction(async (tx) => {
    const order = await tx.order.create({ data: dto });
    await tx.inventory.update({
      where: { productId: dto.productId },
      data: { stock: { decrement: dto.quantity } },
    });
    return order;
  });
}
```

## Rules

- **`PrismaModule` is `@Global()`** — inject `PrismaService` anywhere without importing
- **Use `select` or `include`** — never return the full model with sensitive fields
- **Transactions for multi-table writes** — `$transaction` with interactive callback
- **Migrations in CI** — `prisma migrate deploy` in production, `prisma migrate dev` locally
