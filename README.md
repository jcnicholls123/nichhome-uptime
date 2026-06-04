# NichHome Uptime

NichHome Uptime is a responsive infrastructure dashboard focused on uptime,
SNMP network telemetry, Docker container health, and Discord alert visibility.

> [!IMPORTANT]
> The current release is a deployable dashboard interface populated with demo
> telemetry. Live SNMP polling, Docker socket integration, persistent monitor
> configuration, and Discord webhook delivery are planned backend features.

## Run with Docker

Build and run locally:

```bash
docker build -t nichhome-uptime .
docker run -d --name nichhome-uptime --restart unless-stopped -p 8080:8080 nichhome-uptime
```

Open `http://localhost:8080`. The container health endpoint is available at
`http://localhost:8080/healthz`.

## Run with Docker Compose

```bash
docker compose up -d
```

The Compose deployment exposes the dashboard at `http://localhost:30080`.

GitHub Actions publishes multi-architecture images for AMD64 and ARM64 to:

```text
ghcr.io/jcnicholls123/nichhome-uptime:latest
```

## Deploy on TrueNAS SCALE

### Using a Custom App

1. Open **Apps**, select **Discover Apps**, then choose **Custom App**.
2. Set the application name to `nichhome-uptime`.
3. Use `ghcr.io/jcnicholls123/nichhome-uptime:latest` as the image.
4. Add container port `8080` and expose it on host port `30080`.
5. Set the restart policy to **Unless Stopped**.
6. Save the app and open `http://TRUENAS-IP:30080`.

### Using YAML/Compose

TrueNAS releases that provide an **Install via YAML** option can use the
contents of `compose.yaml`, then install the app.

No dataset mounts, environment variables, custom user IDs, or host-network
access are required for this interface-only release. The container runs
unprivileged and supports automatic health checks.

### TrueNAS Troubleshooting

Use the following minimal YAML in **Apps > Discover Apps > Install via YAML**:

```yaml
name: nichhome-uptime
services:
  nichhome-uptime:
    image: ghcr.io/jcnicholls123/nichhome-uptime:latest
    pull_policy: always
    restart: unless-stopped
    ports:
      - "30080:8080"
```

The TrueNAS application name must be lowercase, such as `nichhome-uptime`.
If port `30080` is already in use, change only the number before the colon.
Do not configure storage, host networking, a custom user, or a read-only root
filesystem.

## Development

The dashboard is intentionally dependency-free. Open `index.html` directly or
serve the project directory with any static web server.

## Roadmap

- Real monitor creation and persistent history
- SNMP v2c/v3 polling and device discovery
- Docker Engine API integration
- Discord webhook notifications
- Authentication, incidents, and public status pages
