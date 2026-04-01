# BuildKit Features

## Enable BuildKit

Docker 23+ uses BuildKit by default. For older versions:

```bash
DOCKER_BUILDKIT=1 docker build .
```

## Cache Mounts (Package Managers)

```dockerfile
# syntax=docker/dockerfile:1

# npm/pnpm — cache downloaded packages between builds
RUN --mount=type=cache,target=/root/.npm npm ci
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

# pip
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

# Go modules
RUN --mount=type=cache,target=/go/pkg/mod go mod download

# apt
RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt/lists \
    apt-get update && apt-get install -y curl
```

## Secret Mounts

```dockerfile
# syntax=docker/dockerfile:1

# Access private npm registry during build
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci

# Access private Git repos
RUN --mount=type=secret,id=ssh,type=ssh git clone git@github.com:org/private-repo.git
```

```bash
docker build --secret id=npmrc,src=.npmrc .
docker build --ssh default .
```

## Build Arguments with Defaults

```dockerfile
ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-slim

ARG BUILD_VERSION=dev
LABEL version=${BUILD_VERSION}
```

```bash
docker build --build-arg BUILD_VERSION=1.2.3 .
```

## Inline Cache Export/Import

```bash
# Export cache metadata with the image
docker build --cache-from myimage:latest --build-arg BUILDKIT_INLINE_CACHE=1 -t myimage:latest .

# CI: use registry as cache source
docker build \
  --cache-from type=registry,ref=registry/myimage:cache \
  --cache-to type=registry,ref=registry/myimage:cache,mode=max \
  -t myimage:latest .
```

## Rules

- **Cache mounts for package managers** — dramatically speeds up rebuilds
- **Secret mounts over build args** — secrets don't persist in image layers
- **Inline cache for CI** — shares build cache via registry
- **`# syntax=docker/dockerfile:1`** — enables BuildKit features in Dockerfile
