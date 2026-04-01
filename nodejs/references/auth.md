# Authentication & Authorization

## JWT Authentication

```typescript
// src/lib/auth.ts
import { SignJWT, jwtVerify } from 'jose';

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

export async function signToken(payload: { userId: string; role: string }): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret);
}

export async function verifyToken(token: string) {
  const { payload } = await jwtVerify(token, secret);
  return payload as { userId: string; role: string };
}

export async function signRefreshToken(userId: string): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret);
}
```

## Auth Middleware

```typescript
// src/middleware/auth.ts
import { verifyToken } from '@/lib/auth';
import { UnauthorizedError, ForbiddenError } from '@/lib/errors';

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing bearer token');
  }

  try {
    const payload = await verifyToken(header.slice(7));
    req.user = payload;
    next();
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new ForbiddenError();
    }
    next();
  };
}
```

## Password Hashing

```typescript
import { hash, verify } from '@node-rs/argon2';  // or bcrypt

export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(password: string, hashed: string): Promise<boolean> {
  return verify(hashed, password);
}
```

Use argon2 (preferred) or bcrypt. Never SHA/MD5 for passwords.

## Token Refresh Flow

1. Client sends expired access token → 401
2. Client sends refresh token to `POST /api/auth/refresh`
3. Server verifies refresh token, issues new access + refresh tokens
4. Old refresh token is invalidated (stored in Redis blacklist or DB)

## Route Protection

```typescript
// Protected route
router.get('/api/users/me', requireAuth, getMeHandler);

// Role-restricted route
router.delete('/api/users/:id', requireAuth, requireRole('admin'), deleteUserHandler);

// Public route — no middleware
router.post('/api/auth/login', loginHandler);
```

## Rules

- **Short-lived access tokens** (15min), long-lived refresh tokens (7d)
- **Rotate refresh tokens** on every use — detect token reuse as a breach signal
- **Store refresh tokens** in Redis or DB — not just signed JWTs (enables revocation)
- **Hash passwords with argon2** — bcrypt as fallback
- **Rate limit auth endpoints** — `POST /auth/login`, `POST /auth/refresh`

## Never

- **No secrets in JWTs** — tokens are base64-encoded, not encrypted
- **No passwords in logs** — log auth events, not credentials
- **No `jwt.decode()` without verification** — always use `jwtVerify()`
- **No session data in cookies without `httpOnly`, `secure`, `sameSite`**
- **No hardcoded secrets** — JWT_SECRET from env, validated at startup
