# Controllers

## Basic Controller

```typescript
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll(@Query() query: ListUsersDto): Promise<PaginatedResponse<UserResponseDto>> {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    return this.usersService.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateUserDto): Promise<UserResponseDto> {
    return this.usersService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.usersService.remove(id);
  }
}
```

## Route Decorators

| Decorator | HTTP Method |
|-----------|-------------|
| `@Get()` | GET |
| `@Post()` | POST |
| `@Patch()` | PATCH |
| `@Put()` | PUT |
| `@Delete()` | DELETE |
| `@All()` | All methods |

## Parameter Decorators

| Decorator | Source |
|-----------|--------|
| `@Body()` | Request body |
| `@Query()` | Query parameters |
| `@Param('id')` | Route parameters |
| `@Headers('authorization')` | Request headers |
| `@Req()` | Full request object (avoid — couples to platform) |
| `@Res()` | Full response object (avoid — breaks interceptors) |

## Built-in Pipes

```typescript
@Param('id', ParseUUIDPipe) id: string           // Validates UUID format
@Param('id', ParseIntPipe) id: number             // Parses to integer
@Query('active', ParseBoolPipe) active: boolean   // Parses to boolean
@Body(new ValidationPipe({ whitelist: true }))    // Validates DTO
```

## Response Patterns

```typescript
// Return DTO directly (recommended)
@Get(':id')
findOne(@Param('id') id: string): Promise<UserResponseDto> {
  return this.usersService.findOne(id);
}

// Custom status code
@Post()
@HttpCode(HttpStatus.CREATED)
create(@Body() dto: CreateUserDto) { ... }

// No content
@Delete(':id')
@HttpCode(HttpStatus.NO_CONTENT)
remove(@Param('id') id: string): Promise<void> { ... }

// Custom headers
@Get()
@Header('Cache-Control', 'max-age=60')
findAll() { ... }
```

## Route Grouping

```typescript
@Controller('api/v1/users')           // Versioned prefix
export class UsersController {}

// Or use versioning module
@Controller({ path: 'users', version: '1' })
export class UsersV1Controller {}
```

## Rules

- **Controllers are thin** — validate input (DTO), call service, return response
- **Use DTOs for input** — never access raw `req.body`
- **Use built-in pipes** — `ParseUUIDPipe`, `ParseIntPipe`, `ValidationPipe`
- **Return typed responses** — never return raw entities
- **Use `@HttpCode()`** — POST returns 201, DELETE returns 204

## Never

- **No `@Req()` or `@Res()`** unless absolutely necessary — they bypass interceptors and couple to Express/Fastify
- **No business logic** — delegate everything to services
- **No database calls** — that's the service or repository layer
- **No try/catch for HTTP errors** — use exception filters
