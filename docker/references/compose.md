# Docker Compose

## Basic Structure

```yaml
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
      target: production
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data

  worker:
    build:
      context: .
      target: production
    command: node dist/worker.js
    env_file: .env
    depends_on:
      - redis
      - postgres
    restart: unless-stopped

volumes:
  pgdata:
  redisdata:
```

## Development Override

```yaml
# docker-compose.override.yml (auto-loaded by docker compose)
services:
  api:
    build:
      target: deps
    command: pnpm start:dev
    volumes:
      - .:/app
      - /app/node_modules    # Preserve container node_modules
    ports:
      - "3000:3000"
      - "9229:9229"          # Node.js debugger
```

## Service Dependencies

```yaml
depends_on:
  postgres:
    condition: service_healthy    # Wait for health check to pass
  redis:
    condition: service_started    # Just wait for container start
  migrations:
    condition: service_completed_successfully  # Wait for one-shot to finish
```

## Profiles

```yaml
services:
  api:
    # Always started

  debug-tools:
    image: nicolaka/netshoot
    profiles: ["debug"]           # Only started with --profile debug

  mailhog:
    image: mailhog/mailhog
    profiles: ["dev"]             # Only started with --profile dev
```

```bash
docker compose up                          # Only non-profile services
docker compose --profile dev up            # Include dev profile
docker compose --profile debug up          # Include debug tools
```

## Commands

```bash
docker compose up -d                       # Start detached
docker compose down                        # Stop and remove containers
docker compose down -v                     # Also remove volumes (data loss!)
docker compose logs -f api                 # Follow logs for one service
docker compose exec api sh                 # Shell into running container
docker compose run --rm api npm test       # One-off command
docker compose ps                          # List running services
docker compose build --no-cache            # Force rebuild
docker compose pull                        # Pull latest images
```

## Rules

- **Health checks on databases** — `depends_on.condition: service_healthy` waits for readiness
- **Named volumes for data** — `pgdata:` persists across `docker compose down`
- **Override files for dev** — `docker-compose.override.yml` auto-loaded, adds dev config
- **Profiles for optional services** — debug tools, mail catchers, admin UIs

## Never

- **No `docker compose down -v` without confirmation** — destroys data
- **No hardcoded passwords in committed compose files** — use `.env` + env_file
- **No `links:`** — deprecated, use service names as DNS hostnames
- **No `container_name:` unless necessary** — prevents scaling
