# NichHome Uptime

[![Release](https://img.shields.io/github/v/release/jcnicholls123/nichhome-uptime)](https://github.com/jcnicholls123/nichhome-uptime/releases/latest)
[![Build container](https://github.com/jcnicholls123/nichhome-uptime/actions/workflows/container.yml/badge.svg)](https://github.com/jcnicholls123/nichhome-uptime/actions/workflows/container.yml)

NichHome Uptime is a local-first infrastructure dashboard focused on uptime,
SNMP network telemetry, Docker container health, UniFi Protect camera state, and
Discord alert visibility.

> [!IMPORTANT]
> Authentication, uptime checks, SNMP telemetry, Docker fleet monitoring,
> UniFi Protect camera monitoring, incidents, and Discord alerts are operational.

## Current Features

- Guided first-run administrator setup
- SQLite persistence in `/data`
- Secure password hashing and cookie-backed sessions
- Optional authenticator-app TOTP MFA with scannable setup QR codes
- Protected dashboard and account security controls
- Optional account nickname/display name for friendlier greetings
- Auvik-inspired network command centre with topology health, urgent alerts,
  fleet roll-ups, and traffic snapshots
- Admin feature visibility toggles for hiding unused SNMP, Docker, UniFi
  Network, UniFi Protect, or Network Map modules without deleting data
- Mobile navigation and search across monitors, SNMP devices, Docker, and
  Protect cameras
- Persistent HTTP/HTTPS and TCP monitors with automatic checks
- Private-network TCP auto-discovery with editable service names and selective
  monitor import
- Monitor editing, pause/resume, and heartbeat history
- Incident tracking and Discord down/recovery alerts
- Configurable variable alert rules for SNMP values and Docker CPU, memory,
  restart, and health metrics
- SNMP v2c and v3 device status, identity, uptime, and background polling
- Dedicated SNMP fleet workspace with active alerts and fleet health
- Assignable TrueNAS, UniFi, standard, and imported telemetry profiles
- Safe Zabbix and NichHome XML SNMP template import with custom OID polling
- Bounded SNMP walk administration tool with readable OID categories
- UniFi-focused SNMP details with system OIDs and discovered interfaces
- Profile-aware UniFi gateway, access point, and switch details
- Unified SNMP/service uptime, incidents, Discord alerts, and live fault state
- Ping IP/hostname monitors
- Real heartbeat uptime and response-time graphs
- Dual-axis uptime and response-time reporting graphs with timestamps
- Historical SNMP interface bandwidth graphs with inbound/outbound bitrate
- Selectable total or per-interface SNMP bandwidth graphs in device details
- Reporting ranges from one hour to 90 days with durable hourly rollups
- TrueNAS SNMP profile with CPU, load, memory, storage, dataset/pool entries,
  interfaces, and TrueNAS MIB inventory
- Docker Engine fleet discovery with state, health, image, CPU, RAM, restart
  count, uptime history, incidents, and Discord alerts
- Configurable Docker hosts using a mounted socket path or reachable HTTP/HTTPS
  Docker API endpoint
- Active-container Docker fleet tracking with duplicate-host protection and
  automatic cleanup of stale historical fleet records
- UniFi Network Integration API host setup with site, adopted-device,
  expandable connected-client visibility, offline-device incident, Discord
  alert, and topology monitoring
- UniFi Protect host setup with local API-key camera discovery, camera
  connection/recording state, incidents, Discord alerts, and topology mapping
- Dedicated Docker fleet details workspace and inferred infrastructure network
  topology map
- Editable manual map nodes, relationships, positions, status, and details
- Editable inferred topology nodes with persistent names, positions, details,
  and intelligent infrastructure icons
- Drag-to-position topology canvas nodes with saved overrides
- Replace-mode topology links for correcting inferred parent relationships
- Relationship-aware reset-layout action for clearing odd topology positions
  without deleting data
- Browser notification preferences for new active incidents
- Dedicated notification centre with active alert metrics, channel status,
  recent events, and quick Discord/browser controls
- Severity-based alert rules with consecutive-check thresholds and structured
  Discord embed notifications
- Alert sources for SNMP baseline/profile metrics, Docker containers, and
  UniFi Network device update availability
- Structured Discord embeds for monitor, SNMP, Docker, recovery, and test alerts
- Easy alert templates, dependencies, acknowledgements, and admin maintenance
  mode without Zabbix-style setup complexity
- UniFi AP client totals and radio/VAP telemetry plus gateway WAN/LAN traffic,
  speed, error, and discard counters

All NichHome Uptime features are free. Unfinished features are clearly marked
as Coming soon and are not hidden behind a paid tier.

## Network Auto-Discovery

Select **Add monitor > Auto-scan network** or **Auto-scan network** above the
monitored services list. Enter your LAN IPv4 CIDR, an address range, or one
address. Leave ports blank
to scan common services, or enter up to 64 comma-separated ports/ranges. Enter
`all` or `1-65535` to scan every TCP port on one private/local address.

Open ports receive suggested names from their service and reverse-DNS hostname.
Rename and select the results you want, then import them as normal TCP
monitors. Scans are restricted to private/local IPv4 networks and a maximum of
256 addresses.

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
8. Save the app and open the mapped dashboard URL for your TrueNAS host.

Docker socket access lets NichHome Uptime read the local TrueNAS Docker Engine.
Only mount it for this trusted local application. The socket grants powerful
access to the Docker host even when the filesystem mount is marked read-only.

You can also select **Add monitor > Docker host** or **Add Docker host** on the
container fleet panel. A socket path only works when that socket is already
mounted inside the NichHome container. If the TrueNAS app editor provides no
host-path mount option, configure a Docker API endpoint reachable from
NichHome instead. Avoid exposing an unencrypted Docker API outside a trusted
private network because Docker daemon access is highly privileged.

For TrueNAS SNMP monitoring, enable **System > Services > SNMP**, configure a
community, then add the TrueNAS hostname/IP as an SNMP device in NichHome.
SNMP v3 can also be used by selecting v3 in the device form and entering the
username, security level, and matching authentication/privacy credentials.

## Public Configuration Model

NichHome Uptime is designed for public reuse. Do not edit source files to add
private addresses, tokens, passwords, webhook URLs, or hostnames. Configure
integrations through the UI, environment variables, mounted `/data` storage, or
import files. API keys and webhook URLs entered in the UI are stored in the
local SQLite database under `/data`.

## SNMP Setup

1. Enable SNMP on the device you want to monitor.
2. Prefer SNMP v3 where available. For v2c, use a read-only community string.
3. In NichHome, open **SNMP Devices**, add the device hostname/IP, version,
   port, timeout, and polling interval.
4. Assign a built-in profile or import a Zabbix/NichHome XML SNMP template.
5. Use the device details page to review system identity, custom profile
   metrics, and interface counters.

SNMP interface metrics can be used as alert-rule targets. Each discovered
interface exposes inbound/outbound bps, admin/oper status, speed, errors, and
discards. This supports WAN usage alerts, switch-port-down alerts, and
error/discard increase alerts.

## UniFi Network Setup

Create a UniFi Network Integration API key with read access, then open
**UniFi Network** in NichHome and add the controller/console base URL plus API
key. NichHome polls sites, adopted gateways/switches/APs, firmware/update
availability, device online/offline state, and connected clients. Alert rules
can target update availability and device state.

## UniFi Protect Setup

Create a UniFi Protect API key with camera read access, then open
**UniFi Protect** and add the console base URL plus API key. NichHome polls
camera state, recording mode, last seen time, and last poll time. Alert rules
can target camera `status`, Protect `state`, `recording_mode`,
`last_seen_age_seconds`, and `last_poll_age_seconds`.

## Custom HTTP/API Items

Custom items are host-attached pollers for HTTP/HTTPS, REST/JSON APIs, XML/RSS
feeds, and text endpoints. Create them through the API or UI forms that expose
custom items. Each item supports:

- host attachment, name, key, units, interval, and timeout
- method, URL, headers, and optional request body
- JSON path, XML path, regex, or raw-text extraction
- history storage, latest value, graphing, and alert-rule targeting

Use headers for bearer tokens or API keys. Do not put secrets in URLs.

## Zabbix Import

Use `POST /api/zabbix/import` with an authenticated session to import a Zabbix
JSON export. The importer is idempotent: rerunning the same file updates
existing hosts/items where possible instead of duplicating them.

Mapped data includes hosts, descriptions, tags, macros, web scenarios, HTTP
checks, SNMP items, graphable custom items, severity, operational data, and
supported trigger expressions. Secret-like macro names such as token, key,
password, or secret are not exposed in API responses; users should re-enter or
remap missing secrets after import where an integration requires them.

## Alert Rules

Alert rules support Zabbix-style functions:

- `last`, `min`, `max`, `avg`, `count`, `nodata`, and `change`
- time windows such as 1 minute, 2 minutes, 5 minutes, and 30 minutes
- `triggerCount` and `recoveryCount`
- acknowledgement of current problems

Targets include monitors, custom items, SNMP devices, SNMP interfaces, Docker
containers, UniFi Network devices, UniFi Protect cameras, and Hikvision cameras.

## Notifications

Discord, Telegram, and email notifications include problem/resolved state,
target name, metric name, severity, current value, expression/threshold, reason,
and recommended action where configured. Discord supports a webhook URL and an
optional thread ID from the Admin Settings notification tab.

## Retention

Admin Settings includes retention controls. The default is 30 days. Cleanup
applies to heartbeat history, SNMP metrics, SNMP interface history, Docker
metrics, custom metric history, and reporting rollups.

## SNMP Profiles and Walks

Open **SNMP Devices** from the sidebar for the complete fleet workspace. From
there you can run a bounded SNMP walk, assign built-in device profiles, import
Zabbix or NichHome SNMP XML templates, poll the fleet, and inspect active SNMP
alerts.

Zabbix imports accept SNMP_AGENT item and item_prototype OIDs, including
prototype indexes such as `{#SNMPINDEX}`. NichHome XML imports accept numeric
OID fields and string/table/gauge/timeticks style metric types. String values
are supported, and simple regex preprocessing can extract values from SNMP
extend output. NichHome does not execute template scripts. Walks use the saved
device credentials and return at most 1,000 results per request.

UniFi AP client totals use the station counts reported by the AP VAP table.
Controller-wide sites, adopted devices, and connected clients are available
through the UniFi Network API workspace.

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
