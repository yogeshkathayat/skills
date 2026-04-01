# Build Context & .dockerignore

## .dockerignore (Required)

```
# Version control
.git
.gitignore

# Dependencies (installed in container)
node_modules
.pnpm-store
vendor
.venv
__pycache__
target

# Build output
dist
build
out
.next

# Environment and secrets
.env
.env.*
!.env.example

# IDE and OS
.vscode
.idea
*.swp
.DS_Store
Thumbs.db

# Test and coverage
coverage
.nyc_output
test-results
playwright-report

# Documentation
*.md
!README.md
LICENSE

# Docker
Dockerfile
docker-compose*.yml
.dockerignore

# CI
.github
.gitlab-ci.yml
.circleci
```

## Why .dockerignore Matters

Without `.dockerignore`, `docker build` sends the entire directory as build context. A repo with `node_modules/` (500MB) and `.git/` (100MB) means every build uploads 600MB+ before anything happens.

## Check Context Size

```bash
# See what Docker sends as build context
docker build --no-cache --progress=plain . 2>&1 | head -5
# Look for "sending build context to Docker daemon" size

# List what would be included
tar -czf - --exclude-from=.dockerignore . | wc -c
```

## Rules

- **Always have a `.dockerignore`** — no exceptions
- **Exclude `node_modules`** — they're installed inside the container from lockfile
- **Exclude `.git`** — not needed in builds, adds significant size
- **Exclude `.env`** — secrets don't belong in build context
- **Keep `.dockerignore` updated** — review when adding new directories
