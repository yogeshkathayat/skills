# Validation — DTOs & class-validator

## Global ValidationPipe

```typescript
// main.ts
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,             // Strip properties not in DTO
  forbidNonWhitelisted: true,  // Throw on unknown properties
  transform: true,             // Auto-transform payloads to DTO instances
  transformOptions: {
    enableImplicitConversion: true,  // Convert query string "1" to number 1
  },
}));
```

## DTO with class-validator

```typescript
import { IsEmail, IsString, MinLength, MaxLength, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({ enum: ['user', 'admin'], default: 'user' })
  @IsOptional()
  @IsEnum(['user', 'admin'])
  role?: string = 'user';
}
```

## Partial DTOs (for PATCH)

```typescript
import { PartialType } from '@nestjs/swagger';  // or @nestjs/mapped-types

export class UpdateUserDto extends PartialType(CreateUserDto) {}
// All fields become optional, validators preserved
```

## Query DTOs

```typescript
import { Type } from 'class-transformer';
import { IsOptional, IsInt, Min, Max, IsEnum } from 'class-validator';

export class ListUsersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsEnum(['active', 'inactive'])
  status?: string;
}
```

## Custom Validators

```typescript
import { ValidatorConstraint, ValidatorConstraintInterface, Validate } from 'class-validator';

@ValidatorConstraint({ async: true })
export class IsUniqueEmail implements ValidatorConstraintInterface {
  constructor(private usersService: UsersService) {}

  async validate(email: string) {
    const user = await this.usersService.findByEmail(email);
    return !user;
  }

  defaultMessage() {
    return 'Email already exists';
  }
}

// Usage in DTO
@Validate(IsUniqueEmail)
email: string;
```

## Response DTOs

```typescript
export class UserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  createdAt: Date;

  // Note: no password field — never expose sensitive data
}
```

## Rules

- **DTO per operation** — `CreateUserDto`, `UpdateUserDto`, `UserResponseDto` are separate classes
- **`whitelist: true` globally** — strip unknown properties automatically
- **`PartialType()` for updates** — don't duplicate validators
- **`@ApiProperty()` on every field** — OpenAPI docs stay in sync with validation

## Never

- **No `req.body as T`** — let `ValidationPipe` + DTO handle it
- **No validation in services** — validate at the controller boundary via DTOs
- **No sensitive fields in response DTOs** — password, tokens, internal IDs
