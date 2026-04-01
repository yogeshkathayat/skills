# Multi-Stage Builds

## Pattern

```dockerfile
# Stage 1: Dependencies
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

# Stage 2: Build
FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# Stage 3: Production
FROM node:22-slim AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
RUN addgroup --system app && adduser --system --ingroup app app
USER app
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

## Why Three Stages

| Stage | Contains | Size impact |
|-------|----------|-------------|
| `deps` | All dependencies (dev + prod) | Not in final image |
| `build` | Compiled output + dev tools | Not in final image |
| `production` | Only prod deps + compiled output | Final image |

The final image excludes: TypeScript compiler, test frameworks, build tools, dev dependencies, source code.

## Go (Scratch Target)

```dockerfile
FROM golang:1.23 AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /server ./cmd/server

FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /server /server
ENTRYPOINT ["/server"]
```

## Python

```dockerfile
FROM python:3.12-slim AS build
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY . .

FROM python:3.12-slim AS production
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
COPY --from=build /app/src ./src
ENV PATH="/app/.venv/bin:$PATH"
RUN adduser --system app
USER app
CMD ["python", "-m", "myapp"]
```

## Rust

```dockerfile
FROM rust:1.82 AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim AS production
COPY --from=build /app/target/release/myapp /usr/local/bin/myapp
RUN adduser --system app
USER app
CMD ["myapp"]
```

## Cache Optimization

```dockerfile
# Copy dependency manifests first (cache layer)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Then copy source (invalidates only this layer on code change)
COPY . .
RUN pnpm build
```

## Targeting Specific Stages

```bash
docker build --target deps .     # Stop at deps stage (for dev)
docker build --target build .    # Stop at build stage (for testing)
docker build .                   # Full production build (default: last stage)
```

## Rules

- **Deps before source** — lockfile changes less than source code
- **Prod deps only in final stage** — `--prod` / `--no-dev`
- **Non-root in final stage** — not in build stages
- **`--from=<stage>`** to copy between stages — not from build context
