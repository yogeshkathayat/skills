# Networking

## Network Types

| Driver | When |
|--------|------|
| `bridge` | Default. Containers on same host communicate by service name |
| `host` | Container shares host network stack. No port mapping needed |
| `none` | No networking. Isolated container |
| `overlay` | Multi-host (Docker Swarm). Containers across machines |

## Compose Networking

```yaml
services:
  api:
    ports:
      - "3000:3000"         # host:container
    networks:
      - backend

  postgres:
    networks:
      - backend             # Only accessible from backend network

  nginx:
    ports:
      - "80:80"
      - "443:443"
    networks:
      - frontend
      - backend

networks:
  frontend:
  backend:
```

## DNS Resolution

Within a Compose network, services resolve by name:

```typescript
// api connects to postgres via service name
const db = new Pool({ host: 'postgres', port: 5432 });

// api connects to redis via service name
const redis = new Redis({ host: 'redis', port: 6379 });
```

## Port Mapping

```yaml
ports:
  - "3000:3000"              # host 3000 → container 3000
  - "8080:3000"              # host 8080 → container 3000
  - "127.0.0.1:3000:3000"   # localhost only (not exposed externally)
```

## Expose vs Ports

```yaml
expose:
  - "3000"     # Available to other containers on the network, NOT to host
ports:
  - "3000:3000"  # Available to host AND other containers
```

## Custom Network

```bash
docker network create mynet
docker run --network mynet --name api myimage
docker run --network mynet --name db postgres
# api can reach db via hostname "db"
```

## Rules

- **Service names as hostnames** — `postgres`, `redis`, not IP addresses
- **Separate networks** for isolation — frontend services can't reach the database directly
- **`127.0.0.1:` prefix** for dev-only ports — prevents external access
- **`expose` for internal, `ports` for external** access

## Never

- **No `--network host` in production** without security review — exposes all container ports
- **No hardcoded IPs** — use service names for DNS resolution
- **No publishing database ports** in production — only accessible via internal network
