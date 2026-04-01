# Stack — Locked Decisions

Every other reference file assumes these decisions. Do not deviate.

## Build Tool

| Tool | When |
|------|------|
| Docker + BuildKit | Default. `DOCKER_BUILDKIT=1` or Docker 23+ (BuildKit is default) |
| Podman | Rootless/daemonless environments. OCI-compatible, drop-in replacement |
| Kaniko | CI builds without Docker daemon (GKE, GitLab CI) |
| Buildah | OCI image builds without daemon, scripted pipelines |

## Base Images

| Language | Production | Development |
|----------|-----------|-------------|
| Node.js | `node:22-slim` | `node:22` (full, includes build tools) |
| Bun | `oven/bun:1-slim` | `oven/bun:1` |
| Python | `python:3.12-slim` | `python:3.12` |
| Go | `scratch` or `gcr.io/distroless/static-debian12` | `golang:1.23` |
| Rust | `debian:bookworm-slim` or `scratch` | `rust:1.82` |
| Java | `eclipse-temurin:21-jre-jammy` | `eclipse-temurin:21-jdk-jammy` |
| General | `debian:bookworm-slim` | `ubuntu:24.04` |
| Minimal | `gcr.io/distroless/cc-debian12` | N/A |

### Image Selection Rules

- **`-slim`** variants: no build tools, smaller, good for interpreted languages
- **`-alpine`**: smallest, but musl libc can cause compatibility issues — test first
- **`distroless`**: no shell, no package manager — most secure, hardest to debug
- **`scratch`**: empty — only for statically linked binaries (Go, Rust)

## Registry

| Registry | When |
|----------|------|
| Docker Hub | Public images, open source |
| GitHub Container Registry (ghcr.io) | GitHub-hosted projects |
| AWS ECR | AWS deployments |
| Google Artifact Registry | GCP deployments |
| Azure Container Registry | Azure deployments |
| Self-hosted | On-prem or air-gapped environments |

## Tagging Strategy

```
registry/org/image:latest          # Mutable — dev/staging only
registry/org/image:1.2.3           # Semver — production releases
registry/org/image:sha-abc1234     # Git SHA — CI traceability
registry/org/image:main-20240101   # Branch + date — CI builds
```

Production deployments should use semver or SHA tags, never `:latest`.

## Never

- **No `:latest` in production** — pin specific versions
- **No full base images in production** — use `-slim` or distroless
- **No `alpine` without testing** — musl libc compatibility issues are common
- **No secrets in Dockerfiles** — use BuildKit secret mounts or runtime env injection
