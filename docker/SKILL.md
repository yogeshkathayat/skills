---
name: docker
version: 1.0.0
description: |
  Docker and container infrastructure skill: Dockerfiles, multi-stage builds, Compose, networking,
  volumes, health checks, registries, BuildKit, security hardening, CI/CD integration, debugging,
  and orchestration patterns. Use when the task touches container configuration, images, or
  deployment infrastructure.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
paths:
  - "Dockerfile"
  - "Dockerfile.*"
  - "*.dockerfile"
  - "docker-compose*.yml"
  - "docker-compose*.yaml"
  - "compose*.yml"
  - "compose*.yaml"
  - ".dockerignore"
  - "docker/**"
  - ".github/workflows/*.yml"
argument-hint: "[Docker task: Dockerfile, Compose, registry, debugging]"
arguments:
  - request
when_to_use: |
  Use when the task touches Dockerfiles, docker-compose, container configuration, image builds,
  registry workflows, or container debugging. Examples: "write a Dockerfile", "optimize this image",
  "add a service to compose", "debug why the container won't start", "set up multi-stage build",
  "push to ECR/GCR", "add health checks". Do not use for Kubernetes manifests (use a k8s skill)
  or for application code that happens to run in containers.
effort: high
---

<EXTREMELY-IMPORTANT>
This skill is a routing shell over the Docker reference set.

Non-negotiable rules:
1. Read `references/stack.md` first to determine the project's base images, registry, and build conventions.
2. Then load only the references needed for the actual task.
3. **Multi-stage builds by default** — separate dependency install, build, and production stages.
4. **Non-root user in production** — never run containers as root. Add a user and `USER` directive.
5. **No secrets in images** — no `ARG`/`ENV` for passwords, no `COPY .env`, no secrets in build layers.
6. **Pin base image versions** — `node:22-slim`, not `node:latest`. Use digest pinning for critical images.
7. **`.dockerignore` is mandatory** — exclude `node_modules`, `.git`, `.env`, `dist`, test artifacts.
8. **Frozen lockfiles in builds** — `--frozen-lockfile` / `--ci` for reproducible installs.
</EXTREMELY-IMPORTANT>

# docker

## Inputs

- `$request`: The Docker task — Dockerfile, Compose, registry, optimization, or debugging target

## Goal

Route Docker work through proven container patterns so images are small, secure, reproducible, and follow the project's infrastructure conventions.

## Step 0: Read the stack contract

Always start with:

- `references/stack.md`

That establishes: base images, registry, build tool (Docker/BuildKit/Podman), CI integration, and locked conventions.

**Success criteria**: The project's container infrastructure choices are explicit before writing any Dockerfile or Compose config.

## Step 1: Load only the relevant references

Use the routing table to pick reference files. Do not bulk-load the full reference tree.

| Task | Read |
|------|------|
| Base images, registry, build conventions, CI | `references/stack.md` |
| Writing or editing a Dockerfile | `references/dockerfile.md` |
| Multi-stage builds, layer optimization, caching | `references/multi-stage.md` |
| docker-compose services, networking, volumes | `references/compose.md` |
| .dockerignore, build context optimization | `references/build-context.md` |
| Health checks, readiness, startup probes | `references/health-checks.md` |
| Security: non-root, read-only FS, capabilities, scanning | `references/security.md` |
| Image size optimization, distroless, slim, alpine | `references/image-optimization.md` |
| Registry: push, pull, tagging, ECR/GCR/GHCR/DockerHub | `references/registry.md` |
| BuildKit features, cache mounts, secret mounts | `references/buildkit.md` |
| CI/CD: GitHub Actions, GitLab CI, build+push pipelines | `references/ci-cd.md` |
| Debugging: logs, exec, inspect, networking issues | `references/debugging.md` |
| Language-specific: Node.js, Python, Go, Rust, Java | `references/language-patterns.md` |
| Volumes, bind mounts, tmpfs, named volumes | `references/volumes.md` |
| Networking: bridge, host, overlay, DNS, port mapping | `references/networking.md` |

Multiple tasks? Read multiple files. The references are self-contained.

**Success criteria**: Only the task-relevant Docker conventions are in play.

## Step 2: Implement with the core Docker guardrails

Keep these rules active:

- multi-stage builds: deps → build → production
- `.dockerignore` excludes everything unnecessary from build context
- pin base image tags — never `:latest` in production
- non-root `USER` in the final stage
- `COPY` only what's needed in each stage — not the entire repo
- health checks on every long-running service
- no secrets in `ARG`, `ENV`, or `COPY` — use BuildKit `--mount=type=secret`
- combine `RUN` commands to minimize layers — but keep readability
- order layers from least to most frequently changing (deps before code)

**Success criteria**: The container is small, secure, reproducible, and follows the project's conventions.

## Step 3: Verify the build

Use the narrowest relevant verification:

- `docker build` succeeds
- image size is reasonable for the language/framework
- container starts and health check passes
- `.dockerignore` excludes the right files (`docker build --dry-run` or check context size)
- no secrets visible in `docker history` or `docker inspect`

**Success criteria**: The image builds, runs, and passes basic health validation.

## Guardrails

- Do not inline the whole Docker handbook in `SKILL.md`.
- Do not skip `references/stack.md`.
- Do not use `latest` tags for base images in production Dockerfiles.
- Do not `COPY . .` without a proper `.dockerignore`.
- Do not run containers as root.
- Do not put secrets in build args or env vars baked into images.
- Do not add `disable-model-invocation`; this is a normal domain skill.

## When To Load References

- `references/stack.md`
  Always.

- then only the task-relevant files under `references/`

## Output Contract

Report:

1. which Docker references were loaded
2. the build pattern chosen (multi-stage, single, etc.)
3. the change made
4. the verification run (build success, image size, health check)
