# Testing

## Test Runner

| Runtime | Runner | Config |
|---------|--------|--------|
| Node.js | vitest | `vitest.config.ts` |
| Node.js (legacy) | jest | `jest.config.ts` |
| Bun | bun test | Built-in, jest-compatible API |

## Unit Tests

```typescript
// tests/unit/services/users.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createUser } from '@/services/users';

describe('createUser', () => {
  it('creates a user with hashed password', async () => {
    const mockRepo = { create: vi.fn().mockResolvedValue({ id: '1', email: 'a@b.com' }) };
    const result = await createUser(mockRepo, { email: 'a@b.com', password: 'secret' });

    expect(result.id).toBe('1');
    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@b.com' }),
    );
    // Password should be hashed, not stored raw
    expect(mockRepo.create.mock.calls[0][0].password).not.toBe('secret');
  });

  it('throws ConflictError on duplicate email', async () => {
    const mockRepo = { create: vi.fn().mockRejectedValue(new Error('unique constraint')) };
    await expect(createUser(mockRepo, { email: 'dup@b.com', password: 'x' }))
      .rejects.toThrow('CONFLICT');
  });
});
```

## Integration Tests (HTTP)

```typescript
// tests/integration/users.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '@/server';

describe('POST /api/users', () => {
  it('returns 201 with valid input', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ email: 'new@test.com', name: 'Test User' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.email).toBe('new@test.com');
  });

  it('returns 400 with invalid email', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ email: 'not-an-email', name: 'Test' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 409 on duplicate email', async () => {
    await request(app).post('/api/users').send({ email: 'dup@test.com', name: 'First' });
    const res = await request(app).post('/api/users').send({ email: 'dup@test.com', name: 'Second' });

    expect(res.status).toBe(409);
  });
});
```

## Test Factories

```typescript
// tests/fixtures/factories.ts
import { faker } from '@faker-js/faker';

export function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: faker.string.uuid(),
    email: faker.internet.email(),
    name: faker.person.fullName(),
    createdAt: new Date(),
    ...overrides,
  };
}
```

## Test Database

```typescript
// tests/setup.ts — run before integration tests
import { db } from '@/lib/db';

beforeEach(async () => {
  // Truncate tables between tests for isolation
  await db.$executeRaw`TRUNCATE users, orders CASCADE`;
});

afterAll(async () => {
  await db.$disconnect();
});
```

Use a separate test database (`DATABASE_URL` in `.env.test`). Never test against production.

## Coverage

```bash
npx vitest run --coverage        # Node.js
bun test --coverage              # Bun
```

Aim for >80% on services and business logic. Don't chase 100% on boilerplate.

## Rules

- **Test behavior, not implementation** — assert on outputs and side effects, not internal calls.
- **One assertion concept per test** — test name should describe what is verified.
- **Isolate unit from integration** — unit tests mock dependencies, integration tests use real HTTP/DB.
- **Deterministic** — no random data in assertions, no timing-dependent tests.
- **Fast** — unit tests < 1s total, integration tests with real DB < 30s.

## Never

- **No `any` in test types** — tests should catch type regressions.
- **No shared mutable state between tests** — each test sets up its own context.
- **No testing private functions** — test the public API that calls them.
- **No snapshot tests for API responses** — assert specific fields; snapshots are brittle.
