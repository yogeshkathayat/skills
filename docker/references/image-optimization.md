# Image Optimization

## Size Comparison

| Base Image | Size | Use Case |
|-----------|------|----------|
| `ubuntu:24.04` | ~77MB | Full OS, dev tools |
| `debian:bookworm-slim` | ~74MB | Production, apt available |
| `node:22` | ~350MB | Dev (includes build tools) |
| `node:22-slim` | ~200MB | Production Node.js |
| `node:22-alpine` | ~130MB | Smaller, musl libc (test first) |
| `python:3.12-slim` | ~150MB | Production Python |
| `golang:1.23` | ~800MB | Build only |
| `gcr.io/distroless/static` | ~2MB | Statically linked binaries |
| `scratch` | 0MB | Empty — Go/Rust static binaries |

## Optimization Techniques

### 1. Multi-stage builds (biggest win)
See `multi-stage.md`. Only copy compiled output and prod deps to final stage.

### 2. Use `-slim` variants
```dockerfile
# ✓ Production
FROM node:22-slim

# ✗ Development image in production
FROM node:22
```

### 3. Clean up in the same layer
```dockerfile
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*
```

### 4. Prod-only dependencies
```dockerfile
RUN pnpm install --frozen-lockfile --prod    # No devDependencies
```

### 5. Specific COPY instead of COPY . .
```dockerfile
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
```

### 6. .dockerignore
See `build-context.md`. Reduces context transfer and prevents accidental inclusion.

## Check Image Size

```bash
docker images myimage               # See size
docker history myimage               # See layer sizes
dive myimage                         # Interactive layer explorer (github.com/wagoodman/dive)
```

## Target Sizes

| Stack | Target Production Size |
|-------|----------------------|
| Node.js API | 150-250MB |
| Python API | 100-200MB |
| Go binary | 5-30MB |
| Rust binary | 5-50MB |
| Java (JRE) | 200-350MB |
| Static site (nginx) | 30-50MB |

## Rules

- **Multi-stage is the #1 optimization** — everything else is incremental
- **`-slim` for production** — full images for build stages only
- **Clean up in same `RUN`** — separate `RUN rm` doesn't reduce image size
- **`--no-install-recommends`** for apt — skip suggested packages
