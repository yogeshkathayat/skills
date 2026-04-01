# Auth — Guards, JWT, Passport

## JWT Strategy (Passport)

```typescript
// auth/strategies/jwt.strategy.ts
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET'),
    });
  }

  validate(payload: { sub: string; role: string }) {
    return { userId: payload.sub, role: payload.role };
  }
}
```

## Auth Guard

```typescript
// auth/guards/jwt-auth.guard.ts
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}

// Register globally in AppModule
providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }]
```

## @Public Decorator

```typescript
import { SetMetadata } from '@nestjs/common';
export const Public = () => SetMetadata('isPublic', true);

// Usage
@Public()
@Post('login')
login(@Body() dto: LoginDto) { ... }
```

## Roles Guard

```typescript
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles) return true;

    const { user } = context.switchToHttp().getRequest();
    return roles.includes(user.role);
  }
}

// Decorator
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);

// Usage
@Roles('admin')
@Delete(':id')
remove(@Param('id') id: string) { ... }
```

## Auth Module

```typescript
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
    }),
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
```

## @CurrentUser Decorator

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return data ? request.user?.[data] : request.user;
  },
);

// Usage
@Get('me')
getProfile(@CurrentUser() user: JwtPayload) { ... }

@Get('me')
getProfile(@CurrentUser('userId') userId: string) { ... }
```

## Rules

- **Global guard + `@Public()`** — protect everything by default, opt out explicitly
- **Short-lived access tokens** (15min), refresh tokens (7d) with rotation
- **Roles via metadata** — `@Roles('admin')` + `RolesGuard`
- **Custom `@CurrentUser()` decorator** — cleaner than `@Req()` + type assertion

## Never

- **No auth logic in controllers** — guards and strategies handle it
- **No secrets in code** — JWT_SECRET from ConfigService
- **No `req.user` without type safety** — use `@CurrentUser()` decorator
