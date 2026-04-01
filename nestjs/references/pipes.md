# Pipes

Pipes transform or validate input before it reaches the route handler.

## Built-in Pipes

| Pipe | What it does |
|------|-------------|
| `ValidationPipe` | Validates DTOs via class-validator |
| `ParseIntPipe` | Converts string to integer, throws 400 on failure |
| `ParseUUIDPipe` | Validates UUID format |
| `ParseBoolPipe` | Converts string to boolean |
| `ParseArrayPipe` | Parses and validates arrays |
| `ParseEnumPipe` | Validates against enum values |
| `DefaultValuePipe` | Provides default when value is undefined |

## Usage

```typescript
@Get(':id')
findOne(@Param('id', ParseUUIDPipe) id: string) { ... }

@Get()
findAll(
  @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
  @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
) { ... }

@Get()
findByStatus(
  @Query('status', new ParseEnumPipe(UserStatus)) status: UserStatus,
) { ... }
```

## Custom Pipe

```typescript
@Injectable()
export class ParseDatePipe implements PipeTransform<string, Date> {
  transform(value: string, metadata: ArgumentMetadata): Date {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      throw new BadRequestException(`Invalid date: ${value}`);
    }
    return date;
  }
}

// Usage
@Get()
findByDate(@Query('since', ParseDatePipe) since: Date) { ... }
```

## Rules

- **Use built-in pipes first** — they handle most cases
- **Custom pipes for domain-specific parsing** — dates, custom IDs, slugs
- **Chain pipes** — `new DefaultValuePipe(1), ParseIntPipe` runs left to right

## Never

- **No parsing logic in controllers** — use pipes
- **No `parseInt(req.query.page)` in handlers** — use `ParseIntPipe`
