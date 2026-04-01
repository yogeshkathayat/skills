# Debugging

## Container Won't Start

```bash
# Check logs
docker logs <container>
docker logs --tail 50 -f <container>

# Check exit code
docker inspect <container> --format='{{.State.ExitCode}}'

# Check OOM kill
docker inspect <container> --format='{{.State.OOMKilled}}'

# Start with shell to debug
docker run -it --entrypoint sh myimage
```

## Exec Into Running Container

```bash
docker exec -it <container> sh           # Shell
docker exec -it <container> bash         # Bash (if available)
docker exec <container> cat /etc/hosts   # One-off command
docker exec <container> env              # Check environment
```

## Network Debugging

```bash
# List networks
docker network ls

# Inspect network
docker network inspect bridge

# Test DNS resolution between containers
docker exec api ping postgres
docker exec api nslookup postgres

# Debug with netshoot (full networking toolkit)
docker run -it --network container:<target> nicolaka/netshoot
```

## Inspect Image

```bash
docker inspect myimage                    # Full metadata
docker history myimage                    # Layer history (check for secrets!)
docker inspect --format='{{.Config.Cmd}}' myimage  # Default command

# Interactive layer exploration
dive myimage                              # Third-party tool
```

## Resource Issues

```bash
docker stats                              # CPU, memory, network, I/O per container
docker system df                          # Disk usage: images, containers, volumes, cache
docker system prune                       # Clean unused data
docker system prune -a --volumes          # Clean everything (careful!)
```

## Build Debugging

```bash
# Build with full output
docker build --progress=plain .

# Build without cache
docker build --no-cache .

# Build to specific stage
docker build --target build .

# Check context size
docker build --no-cache . 2>&1 | grep "sending build context"
```

## Common Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Container exits immediately | CMD fails or no foreground process | Check logs, use exec form CMD |
| Port not accessible | Port not published or wrong mapping | Check `-p host:container` |
| DNS resolution fails | Not on same network | Check `docker network ls`, use same network |
| File permission denied | Non-root user can't read files | `chown` files before `USER` directive |
| OOMKilled | Memory limit exceeded | Increase `mem_limit` or optimize app |
| Slow build | Large context or no cache | Add `.dockerignore`, use BuildKit cache |
| Health check failing | Wrong port or missing curl | Test health endpoint inside container |

## Rules

- **Check logs first** — most issues are visible in `docker logs`
- **Use `--entrypoint sh`** to debug startup failures
- **`docker stats`** for resource issues
- **`dive`** to inspect image layers for bloat or leaked secrets
