# Security

## Non-Root User

```dockerfile
RUN addgroup --system app && adduser --system --ingroup app app
USER app
```

Always the last directives before `CMD`. Build steps (`RUN apt-get`, `RUN npm install`) run as root.

## Read-Only Filesystem

```yaml
# docker-compose
services:
  api:
    read_only: true
    tmpfs:
      - /tmp
      - /app/tmp
```

```bash
# docker run
docker run --read-only --tmpfs /tmp myimage
```

## Drop Capabilities

```yaml
services:
  api:
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE  # Only if binding port < 1024
```

## Secret Mounts (BuildKit)

```dockerfile
# syntax=docker/dockerfile:1
RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN=$(cat /run/secrets/npm_token) npm ci
```

```bash
docker build --secret id=npm_token,src=.npmrc .
```

Secrets are available only during the `RUN` command — not baked into any layer.

## Image Scanning

```bash
# Trivy (recommended)
trivy image myimage:latest

# Docker Scout
docker scout cves myimage:latest

# Snyk
snyk container test myimage:latest
```

Run in CI — block deployment on critical/high vulnerabilities.

## Rules

- **Non-root user** in production containers
- **Drop all capabilities**, add back only what's needed
- **Scan images in CI** — Trivy, Scout, or Snyk
- **BuildKit secrets** for private registries, API keys during build
- **No `--privileged`** unless absolutely required (and document why)
- **Minimal base images** — less attack surface

## Never

- **No `ARG PASSWORD=...`** — visible in `docker history`
- **No `ENV SECRET_KEY=...`** — persisted in image layers
- **No `COPY .env`** — inject at runtime, not build time
- **No `--privileged` without justification** — gives full host access
- **No running as root** — unless the container requires it (and document why)
