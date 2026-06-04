# NichHome Uptime

[![Release](https://img.shields.io/github/v/release/jcnicholls123/nichhome-uptime?include_prereleases)](https://github.com/jcnicholls123/nichhome-uptime/releases)
[![Build container](https://github.com/jcnicholls123/nichhome-uptime/actions/workflows/container.yml/badge.svg)](https://github.com/jcnicholls123/nichhome-uptime/actions/workflows/container.yml)

NichHome Uptime is a local-first infrastructure dashboard focused on uptime,
SNMP network telemetry, Docker container health, and Discord alert visibility.

> [!IMPORTANT]
> Authentication, uptime checks, SNMP telemetry, Docker fleet monitoring,
> incidents, and Discord alerts are operational.

## Current Features

- Guided first-run administrator setup
- SQLite persistence in `/data`
- Secure password hashing and cookie-backed sessions
- Optional authenticator-app TOTP MFA with scannable setup QR codes
- Protected dashboard and account security controls
- Mobile navigation and search across monitors and SNMP devices
- Persistent HTTP/HTTPS and TCP monitors with automatic checks
- Monitor editing, pause/resume, and heartbeat history
- Incident tracking and Discord down/recovery alerts
- SNMP v2c device status, identity, uptime, and background polling
- UniFi-focused SNMP details with system OIDs and discovered interfaces
- Profile-aware UniFi gateway, access point, and switch details
- Unified SNMP/service uptime, incidents, Discord alerts, and live fault state
- Ping IP/hostname monitors
- Real heartbeat uptime and response-time graphs
- TrueNAS SNMP profile with CPU, load, memory, storage, dataset/pool entries,
  interfaces, and TrueNAS MIB inventory
- Docker Engine fleet discovery with state, health, image, CPU, RAM, restart
  count, uptime history, incidents, and Discord alerts

All NichHome Uptime features are free. Unfinished features are clearly marked
as Coming soon and are not hidden behind a paid tier.

## Run with Docker

Build and run locally:

```bash
docker build -t nichhome-uptime .
docker run -d --name nichhome-uptime --restart unless-stopped -p 8080:8080 -v nichhome-data:/data -v /var/run/docker.sock:/var/run/docker.sock:ro nichhome-uptime
```

Open `http://localhost:8080`. The container health endpoint is available at
`http://localhost:8080/healthz`.

## Run with Docker Compose

```bash
docker compose up -d
```

The Compose deployment exposes the dashboard at `http://localhost:30080`.
On first launch, NichHome Uptime guides you through creating the initial
administrator account. MFA can then be enabled from the account menu.

GitHub Actions publishes multi-architecture images for AMD64 and ARM64 to:

```text
ghcr.io/jcnicholls123/nichhome-uptime:latest
```

Beta deployments can be pinned to `ghcr.io/jcnicholls123/nichhome-uptime:beta`
or an exact release such as
`ghcr.io/jcnicholls123/nichhome-uptime:1.0.0-beta.1`. See
[CHANGELOG.md](CHANGELOG.md) for release history.

## Deploy on TrueNAS SCALE

### Using a Custom App

1. Open **Apps**, select **Discover Apps**, then choose **Custom App**.
2. Set the application name to `nichhome-uptime`.
3. Use `ghcr.io/jcnicholls123/nichhome-uptime:latest` as the image.
4. Add container port `8080` and expose it on host port `30080`.
5. Add persistent storage for container path `/data`.
6. To enable Docker fleet monitoring, add host path `/var/run/docker.sock`
   mounted at container path `/var/run/docker.sock` as read-only.
7. Set the restart policy to **Unless Stopped**.
8. Save the app and open `http://TRUENAS-IP:30080`.

Docker socket access lets NichHome Uptime read the local TrueNAS Docker Engine.
Only mount it for this trusted local application. The socket grants powerful
access to the Docker host even when the filesystem mount is marked read-only.

For TrueNAS SNMP monitoring, enable **System > Services > SNMP**, configure a
community, then add the TrueNAS hostname/IP as an SNMP device in NichHome.

### Using YAML/Compose

TrueNAS releases that provide an **Install via YAML** option can use the
contents of `compose.yaml`, then install the app.

Persistent storage at `/data` is required to retain the admin account, MFA
secret, and application database across upgrades.

When upgrading an existing interface-only installation, edit the TrueNAS app
YAML to add the `/data` volume shown below, then redeploy using the latest
image. The first launch after upgrading opens the initial administrator setup.

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
    volumes:
      - nichhome-data:/data
      - /var/run/docker.sock:/var/run/docker.sock:ro
volumes:
  nichhome-data:
```

The TrueNAS application name must be lowercase, such as `nichhome-uptime`.
If port `30080` is already in use, change only the number before the colon.
Do not configure host networking, a custom user, or a read-only root
filesystem. Keep `/data` mounted to persistent storage.

## Development

Install dependencies and start the Node service:

```bash
npm install
npm start
```

## Roadmap

- Real monitor creation and persistent history
- SNMP v2c/v3 polling and device discovery
- Discord webhook notifications
- Incidents and public status pages
