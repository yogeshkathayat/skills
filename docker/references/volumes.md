# Volumes & Storage

## Volume Types

| Type | Syntax | Persistence | Use Case |
|------|--------|-------------|----------|
| Named volume | `mydata:/data` | Survives `docker compose down` | Database data, uploads |
| Bind mount | `./src:/app/src` | Host filesystem | Development (live reload) |
| tmpfs | `tmpfs: /tmp` | In-memory, lost on stop | Temp files, caches |
| Anonymous | `/data` (no name) | Lost on container removal | Disposable scratch space |

## Named Volumes (Production)

```yaml
services:
  postgres:
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:                    # Managed by Docker, persists across restarts
```

## Bind Mounts (Development)

```yaml
services:
  api:
    volumes:
      - .:/app                  # Mount source code for hot reload
      - /app/node_modules       # Anonymous volume — keeps container's node_modules
```

The `/app/node_modules` trick prevents the host's `node_modules/` from overriding the container's installed dependencies.

## Backup Named Volumes

```bash
# Backup
docker run --rm -v pgdata:/data -v $(pwd):/backup alpine tar czf /backup/pgdata-backup.tar.gz -C /data .

# Restore
docker run --rm -v pgdata:/data -v $(pwd):/backup alpine tar xzf /backup/pgdata-backup.tar.gz -C /data
```

## Rules

- **Named volumes for data** — databases, uploads, state that survives restarts
- **Bind mounts for dev** — source code, config files
- **tmpfs for ephemeral data** — temp files, session stores, caches
- **Back up named volumes** before `docker compose down -v`

## Never

- **No `docker compose down -v` without confirmation** — destroys volume data
- **No bind mounts in production** — use named volumes or external storage
- **No storing application state in container filesystem** — it's ephemeral
