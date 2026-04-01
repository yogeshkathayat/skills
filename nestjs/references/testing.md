# Testing

## Unit Tests

```typescript
describe('UsersService', () => {
  let service: UsersService;
  let repo: jest.Mocked<Repository<User>>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            findAndCount: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(UsersService);
    repo = module.get(getRepositoryToken(User));
  });

  it('throws NotFoundException when user not found', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.findOne('abc')).rejects.toThrow(NotFoundException);
  });

  it('creates a user', async () => {
    const dto = { email: 'a@b.com', name: 'Test', password: 'secret123' };
    repo.findOne.mockResolvedValue(null);
    repo.create.mockReturnValue({ id: '1', ...dto } as User);
    repo.save.mockResolvedValue({ id: '1', ...dto } as User);

    const result = await service.create(dto);
    expect(result.id).toBe('1');
    expect(repo.save).toHaveBeenCalled();
  });
});
```

## E2E Tests

```typescript
// test/users.e2e-spec.ts
describe('Users (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /users — creates a user', () => {
    return request(app.getHttpServer())
      .post('/users')
      .send({ email: 'test@test.com', name: 'Test User', password: 'secret123' })
      .expect(201)
      .expect((res) => {
        expect(res.body.id).toBeDefined();
        expect(res.body.email).toBe('test@test.com');
      });
  });

  it('POST /users — 400 on invalid email', () => {
    return request(app.getHttpServer())
      .post('/users')
      .send({ email: 'not-email', name: 'Test' })
      .expect(400);
  });
});
```

## Testing Module Overrides

```typescript
const module = await Test.createTestingModule({
  imports: [UsersModule],
})
  .overrideProvider(UsersService)
  .useValue({ findOne: jest.fn().mockResolvedValue(mockUser) })
  .compile();
```

## Rules

- **`Test.createTestingModule()`** — NestJS testing utility, mirrors real DI
- **Mock repositories in unit tests** — test service logic, not TypeORM
- **Real app in e2e tests** — `AppModule` with `app.init()`
- **Apply same global pipes/filters** in e2e as production
- **One spec file per service/controller** — co-located in the module directory

## Never

- **No testing against production database** — use test database or in-memory
- **No skipping `app.close()`** in afterAll — leaks connections
- **No testing private methods** — test through public API
