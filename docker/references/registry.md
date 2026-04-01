# Registry Operations

## Docker Hub

```bash
docker login
docker tag myimage:latest username/myimage:1.0.0
docker push username/myimage:1.0.0
```

## GitHub Container Registry (ghcr.io)

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
docker tag myimage:latest ghcr.io/org/myimage:1.0.0
docker push ghcr.io/org/myimage:1.0.0
```

## AWS ECR

```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 123456789.dkr.ecr.us-east-1.amazonaws.com
docker tag myimage:latest 123456789.dkr.ecr.us-east-1.amazonaws.com/myimage:1.0.0
docker push 123456789.dkr.ecr.us-east-1.amazonaws.com/myimage:1.0.0
```

## Google Artifact Registry

```bash
gcloud auth configure-docker us-docker.pkg.dev
docker tag myimage:latest us-docker.pkg.dev/project-id/repo/myimage:1.0.0
docker push us-docker.pkg.dev/project-id/repo/myimage:1.0.0
```

## Multi-Architecture Builds

```bash
docker buildx create --use
docker buildx build --platform linux/amd64,linux/arm64 -t myimage:1.0.0 --push .
```

## Tagging Best Practices

```bash
# Tag with semver + git SHA for traceability
VERSION=1.2.3
SHA=$(git rev-parse --short HEAD)
docker tag myimage:latest registry/myimage:$VERSION
docker tag myimage:latest registry/myimage:sha-$SHA
docker push registry/myimage:$VERSION
docker push registry/myimage:sha-$SHA
```

## Rules

- **Semver tags for releases** — `1.0.0`, `1.0.1`
- **SHA tags for CI** — `sha-abc1234` for exact traceability
- **Multi-arch builds** for ARM support (Apple Silicon, AWS Graviton)
- **Scan before push** — `trivy image` before pushing to production registry
