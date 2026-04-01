# OpenAPI / Swagger

## Setup

```typescript
// main.ts
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

const config = new DocumentBuilder()
  .setTitle('My API')
  .setDescription('API documentation')
  .setVersion('1.0')
  .addBearerAuth()
  .build();

const document = SwaggerModule.createDocument(app, config);
SwaggerModule.setup('api/docs', app, document);
```

## DTO Decorators

```typescript
export class CreateUserDto {
  @ApiProperty({ example: 'user@example.com', description: 'User email' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiPropertyOptional({ enum: ['user', 'admin'], default: 'user' })
  @IsOptional()
  @IsEnum(['user', 'admin'])
  role?: string;
}
```

## Controller Decorators

```typescript
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  @ApiOperation({ summary: 'Create a user' })
  @ApiResponse({ status: 201, description: 'User created', type: UserResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  @Post()
  create(@Body() dto: CreateUserDto): Promise<UserResponseDto> { ... }
}
```

## CLI Plugin (auto-decorators)

```json
// nest-cli.json
{
  "compilerOptions": {
    "plugins": ["@nestjs/swagger"]
  }
}
```

With the plugin enabled, `@ApiProperty()` is auto-inferred from TypeScript types. You still need explicit decorators for `description`, `example`, and non-obvious types.

## Rules

- **`@ApiTags()`** on every controller — groups endpoints in Swagger UI
- **`@ApiProperty()`** on DTO fields — with examples and descriptions
- **`@ApiResponse()`** for all status codes — document success and error shapes
- **Use the CLI plugin** — reduces boilerplate for simple DTOs
