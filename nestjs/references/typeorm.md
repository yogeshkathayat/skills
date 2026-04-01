# TypeORM

## Entity

```typescript
@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  name: string;

  @Column()
  @Exclude()  // Hide from serialization
  password: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Order, (order) => order.user)
  orders: Order[];
}
```

## Repository Pattern

```typescript
// Module
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UsersService],
})
export class UsersModule {}

// Service
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  findAll(query: ListUsersDto) {
    return this.usersRepo.findAndCount({
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      order: { createdAt: 'DESC' },
    });
  }

  findOne(id: string) {
    return this.usersRepo.findOne({ where: { id }, relations: ['orders'] });
  }
}
```

## Transactions

```typescript
constructor(private dataSource: DataSource) {}

async createOrder(dto: CreateOrderDto): Promise<Order> {
  return this.dataSource.transaction(async (manager) => {
    const order = manager.create(Order, dto);
    const saved = await manager.save(order);
    await manager.decrement(Inventory, { productId: dto.productId }, 'stock', dto.quantity);
    return saved;
  });
}
```

## Migrations

```bash
# Generate from entity changes
npx typeorm migration:generate src/database/migrations/AddOrdersTable -d src/data-source.ts

# Run migrations
npx typeorm migration:run -d src/data-source.ts

# Revert last migration
npx typeorm migration:revert -d src/data-source.ts
```

## Rules

- **Never `synchronize: true` in production** — use migrations
- **Explicit relations** — always specify `relations` in `findOne`, not eager loading
- **Transactions for multi-table writes** — use `DataSource.transaction()`
- **Indexes** — add `@Index()` on columns used in WHERE and ORDER BY

## Never

- **No `synchronize: true`** in production — data loss risk
- **No `find()` without pagination** — always limit results
- **No raw SQL with string interpolation** — use query builder parameters
