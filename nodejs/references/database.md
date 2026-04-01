# Database Access

## Prisma

```typescript
// src/lib/db.ts
import { PrismaClient } from '@prisma/client';

export const db = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
});
```

### Queries

```typescript
// Find with relations
const user = await db.user.findUnique({
  where: { id },
  include: { orders: { take: 10, orderBy: { createdAt: 'desc' } } },
});

// Paginated list
const [users, total] = await Promise.all([
  db.user.findMany({ where: filters, skip: offset, take: limit, orderBy: { createdAt: 'desc' } }),
  db.user.count({ where: filters }),
]);

// Transaction
const result = await db.$transaction(async (tx) => {
  const order = await tx.order.create({ data: orderData });
  await tx.inventory.update({ where: { productId }, data: { stock: { decrement: quantity } } });
  return order;
});
```

### Migrations

```bash
npx prisma migrate dev --name add_orders_table     # Dev: create + apply
npx prisma migrate deploy                           # Prod: apply only
npx prisma generate                                 # Regenerate client after schema change
```

## Drizzle

```typescript
// src/lib/db.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
```

### Queries

```typescript
import { eq, desc, and, sql } from 'drizzle-orm';
import { users, orders } from './schema';

// Find one
const user = await db.select().from(users).where(eq(users.id, id)).limit(1);

// Paginated list
const results = await db.select().from(users)
  .where(and(...filters))
  .orderBy(desc(users.createdAt))
  .limit(limit)
  .offset(offset);

// Transaction
const result = await db.transaction(async (tx) => {
  const [order] = await tx.insert(orders).values(orderData).returning();
  await tx.update(inventory).set({ stock: sql`stock - ${quantity}` }).where(eq(inventory.productId, productId));
  return order;
});
```

## Connection Pooling

- **Development**: single connection or small pool (2-5)
- **Production**: pool size = 2 × CPU cores + 1 (PostgreSQL recommendation)
- **Serverless/Edge**: use connection pooler (PgBouncer, Supabase pooler, Neon)
- Always set `connectionTimeoutMillis` and `idleTimeoutMillis`

## Rules

- **Mutations in transactions** — multi-step writes are atomic or nothing.
- **Select only needed columns** — avoid `SELECT *` in hot paths.
- **Use parameterized queries** — ORMs do this by default. Never concatenate user input.
- **Close connections on shutdown** — `db.$disconnect()` or `pool.end()` in SIGTERM handler.
- **Index before optimizing** — add indexes for WHERE, ORDER BY, and JOIN columns first.

## Never

- **No raw SQL with string interpolation** — use parameterized queries or ORM.
- **No `SELECT *`** on tables with many columns or large text/blob fields.
- **No ORM in hot loops** — batch queries with `IN` clauses or bulk operations.
- **No database calls in middleware** — keep middleware stateless; query in services.
