# Docker

## Multi-Stage Dockerfile (Node.js)

```dockerfile
# Stage 1: Install dependencies
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

# Stage 2: Build
FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && pnpm build

# Stage 3: Production
FROM node:22-slim AS production
WORKDIR /app
ENV NODE_ENV=production

# Copy only production dependencies
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

# Copy built output
COPY --from=build /app/dist ./dist

# Non-root user
RUN addgroup --system app && adduser --system --ingroup app app
USER app

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

## Multi-Stage Dockerfile (Bun)

```dockerfile
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun build ./src/index.ts --outdir ./dist --target bun

FROM oven/bun:1-slim AS production
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER bun
EXPOSE 3000
CMD ["bun", "run", "dist/index.js"]
```

## .dockerignore

```
node_modules
dist
.git
.env
.env.*
*.md
tests
coverage
.vscode
.idea
```

## Docker Compose (Development)

```yaml
services:
  api:
    build:
      context: .
      target: deps  # Stop at deps stage for dev
    command: npx tsx watch src/index.ts
    ports:
      - "3000:3000"
    volumes:
      - .:/app
      - /app/node_modules  # Preserve container node_modules
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: myapp
      POSTGRES_PASSWORD: myapp
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U myapp"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  pgdata:
```

## Health Check Endpoint

```typescript
app.get('/health', async (req, res) => {
  const checks = {
    uptime: process.uptime(),
    status: 'ok',
    timestamp: new Date().toISOString(),
  };

  try {
    await db.$queryRaw`SELECT 1`;
    await redis.ping();
    res.json(checks);
  } catch (err) {
    res.status(503).json({ ...checks, status: 'degraded', error: 'dependency check failed' });
  }
});
```

## Rules

- **Multi-stage builds** — separate deps/build/production stages
- **Non-root user** — never run as root in production
- **Frozen lockfiles** — `--frozen-lockfile` in CI/Docker
- **Health checks** — container orchestrators need them for readiness probes
- **Minimal final image** — only production deps and built output

## Never

- **No secrets in Dockerfile** — use env vars or mounted secrets
- **No `npm install` without lockfile** — always `--frozen-lockfile`
- **No `latest` tag in production** — pin specific versions
- **No root user** — `USER app` or `USER bun`
- **No dev dependencies in production image** — `--prod` flag
