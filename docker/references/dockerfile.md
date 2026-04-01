# Dockerfile Patterns

## Instruction Reference

| Instruction | Purpose | Example |
|-------------|---------|---------|
| `FROM` | Base image | `FROM node:22-slim AS deps` |
| `WORKDIR` | Set working directory | `WORKDIR /app` |
| `COPY` | Copy files from context | `COPY package.json ./` |
| `RUN` | Execute command in build | `RUN npm ci --frozen-lockfile` |
| `ENV` | Set environment variable | `ENV NODE_ENV=production` |
| `ARG` | Build-time variable | `ARG BUILD_VERSION` |
| `EXPOSE` | Document port | `EXPOSE 3000` |
| `CMD` | Default run command | `CMD ["node", "dist/main.js"]` |
| `ENTRYPOINT` | Fixed run command | `ENTRYPOINT ["./entrypoint.sh"]` |
| `USER` | Run as user | `USER app` |
| `HEALTHCHECK` | Health check command | `HEALTHCHECK CMD curl -f http://localhost:3000/health` |
| `LABEL` | Image metadata | `LABEL version="1.0.0"` |

## Layer Ordering (Most Stable First)

```dockerfile
# 1. Base image (rarely changes)
FROM node:22-slim

# 2. System packages (changes occasionally)
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# 3. Dependencies (changes when lockfile changes)
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

# 4. Source code (changes most frequently)
COPY . .
RUN pnpm build

# 5. Runtime config (static)
USER app
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

## Combining RUN Commands

```dockerfile
# ✓ Good — single layer, cleanup in same layer
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      curl \
      ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# ✗ Bad — cleanup in separate layer doesn't reduce image size
RUN apt-get update && apt-get install -y curl
RUN rm -rf /var/lib/apt/lists/*
```

## COPY vs ADD

- **Use `COPY`** for local files — explicit, no magic
- **Use `ADD`** only for tar extraction (`ADD archive.tar.gz /app/`) or remote URLs
- Never use `ADD` for simple file copies

## CMD vs ENTRYPOINT

```dockerfile
# CMD — default command, can be overridden
CMD ["node", "dist/main.js"]
# docker run myimage               → runs node dist/main.js
# docker run myimage npm test       → runs npm test (overrides CMD)

# ENTRYPOINT — fixed command, CMD becomes arguments
ENTRYPOINT ["node"]
CMD ["dist/main.js"]
# docker run myimage               → runs node dist/main.js
# docker run myimage dist/cli.js   → runs node dist/cli.js
```

Use `CMD` for applications. Use `ENTRYPOINT` + `CMD` when the binary is fixed but arguments vary.

## Non-Root User

```dockerfile
# Create user and group
RUN addgroup --system app && adduser --system --ingroup app app

# Switch to non-root
USER app
```

Place `USER` after `COPY` and `RUN` — those often need root. Only the final runtime needs non-root.

## Rules

- **One process per container** — don't run supervisor processes
- **Exec form for CMD/ENTRYPOINT** — `["node", "main.js"]`, not `node main.js` (enables signal handling)
- **`WORKDIR` before `COPY`** — establishes the working directory
- **`EXPOSE` is documentation** — it doesn't publish ports; `docker run -p` does

## Never

- **No `COPY . .` without `.dockerignore`** — copies everything including `.git`, `node_modules`
- **No shell form for CMD** — `CMD node main.js` doesn't handle SIGTERM properly
- **No `ADD` for local files** — use `COPY`
- **No `apt-get upgrade`** — pin base image version instead
