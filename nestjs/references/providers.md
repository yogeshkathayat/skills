# Providers & Dependency Injection

## Basic Service

```typescript
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly logger: LoggerService,
  ) {}

  async findOne(id: string): Promise<UserResponseDto> {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return this.toDto(user);
  }

  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    const exists = await this.usersRepo.findOne({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email already in use');

    const user = this.usersRepo.create(dto);
    const saved = await this.usersRepo.save(user);
    return this.toDto(saved);
  }

  private toDto(user: User): UserResponseDto {
    return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
  }
}
```

## Provider Types

```typescript
// Standard class provider
{ provide: UsersService, useClass: UsersService }

// Value provider
{ provide: 'API_KEY', useValue: process.env.API_KEY }

// Factory provider
{
  provide: 'REDIS_CLIENT',
  useFactory: (config: ConfigService) => new Redis(config.get('REDIS_URL')),
  inject: [ConfigService],
}

// Existing provider (alias)
{ provide: 'AliasService', useExisting: UsersService }
```

## Injection Tokens

```typescript
// String token
constructor(@Inject('DATABASE_OPTIONS') private options: DatabaseOptions) {}

// Symbol token (preferred for avoiding collisions)
const CACHE_OPTIONS = Symbol('CACHE_OPTIONS');
constructor(@Inject(CACHE_OPTIONS) private options: CacheOptions) {}

// Class token (default — no decorator needed)
constructor(private readonly usersService: UsersService) {}
```

## Scope

```typescript
// Default: Singleton (one instance for entire app)
@Injectable()
export class UsersService {}

// Request-scoped (new instance per request — use sparingly)
@Injectable({ scope: Scope.REQUEST })
export class RequestContextService {}

// Transient (new instance per injection)
@Injectable({ scope: Scope.TRANSIENT })
export class HelperService {}
```

Prefer singleton scope. Request scope propagates through the dependency chain and impacts performance.

## Lifecycle Hooks

```typescript
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }
}
```

| Hook | When |
|------|------|
| `onModuleInit` | After module dependencies resolved |
| `onApplicationBootstrap` | After all modules initialized |
| `onModuleDestroy` | On `app.close()` or SIGTERM |
| `beforeApplicationShutdown` | Before connections close |
| `onApplicationShutdown` | After connections close |

## Rules

- **Inject via constructor** — never `new Service()`, never access providers manually
- **Singleton by default** — only use request scope when genuinely needed
- **Lifecycle hooks for setup/teardown** — database connections, queue workers
- **Export from module** — if another module needs a provider, export it explicitly

## Never

- **No `new Service()`** — always inject
- **No request-scoped providers without reason** — they're slower and propagate scope
- **No side effects in constructors** — use `onModuleInit` for async initialization
- **No circular injection** — restructure into a shared module instead of `forwardRef()`
