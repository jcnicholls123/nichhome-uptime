# Changelog

All notable changes to NichHome Uptime are documented here.

This project uses [Semantic Versioning](https://semver.org/). Beta releases can
include breaking changes while the monitoring engine and integrations mature.

## [Unreleased]

### Planned

- Additional historical reporting ranges
- Public status pages

## [1.0.0-beta.30] - 2026-06-05

### Added

- Account profiles now support an optional nickname/display name for the
  dashboard greeting, account button, and avatar initials while keeping the
  login username unchanged

## [1.0.0-beta.29] - 2026-06-05

### Added

- Topology links can now replace an inferred parent, so incorrect relationships
  can be corrected without deleting devices
- Admin preferences now control browser notifications, inferred topology links,
  UniFi client topology visibility, and default map-link behaviour
- UniFi, gateway, switch, access point, camera, Docker, server, cloud, web, and
  alert badges now render as line icons instead of plain text initials

## [1.0.0-beta.28] - 2026-06-05

### Fixed

- The dashboard greeting now uses the signed-in username and local time of day
  instead of the hardcoded `Good evening, James.`

## [1.0.0-beta.27] - 2026-06-05

### Added

- Alert rules now include baseline SNMP device metrics such as status,
  response time, uptime, interface counts, errors, and discards
- UniFi Network devices can now be alert targets, including an update-available
  firmware/software metric and a ready-made update alert template

### Fixed

- Alert metric dropdowns now show useful empty states instead of appearing
  broken when a source has no targets or no collected metrics

## [1.0.0-beta.26] - 2026-06-05

### Added

- UniFi Network device cards now show client counts and expandable client lists
- Network topology nodes can be dragged and saved as position overrides

### Changed

- UniFi clients stay visible on the UniFi dashboard but are no longer added as
  monitored-looking nodes on the global topology map
- SNMP interface speed labels now make it clearer that IF-MIB speeds are
  reported/capability values

### Fixed

- Imported SNMP profile polling now tolerates bad scalar OIDs and walks table
  OIDs separately, allowing Raspberry Pi temperature and throttling extend
  values to appear even when the same template includes table bases

## [1.0.0-beta.25] - 2026-06-05

### Added

- SNMP profile imports now accept NichHome XML templates with `<oid>` fields,
  lowercase metric types, `<unit>` values, and regex `<pattern>` preprocessing

### Fixed

- Raspberry Pi SNMP-only templates no longer fail with a misleading
  SNMP_AGENT/Zabbix-only OID error

## [1.0.0-beta.24] - 2026-06-05

### Added

- Zabbix SNMP imports now include top-level `item` and discovery
  `item_prototype` SNMP_AGENT OIDs, including `{#SNMPINDEX}` prototypes
- Imported SNMP profile metrics now support string values and optional regex
  extraction for SNMP extend output such as Raspberry Pi temperature/throttling
  values
- Clicking outside a modal dialog now closes the popup

### Fixed

- Zabbix templates with valid SNMP_AGENT OIDs are no longer rejected just
  because some items use CHAR or TEXT value types

## [1.0.0-beta.23] - 2026-06-05

### Fixed

- Feature visibility toggles now hide sidebar navigation items reliably even
  when the nav button CSS sets its own display mode

## [1.0.0-beta.22] - 2026-06-05

### Added

- UniFi Network Integration API support for local consoles, including host
  setup, API-key testing, site sync, adopted device sync, connected client sync,
  background polling, and manual refresh
- UniFi Network workspace with console, site/device, and connected-client views
- Offline UniFi Network device incidents with Discord down/recovery alerts
- UniFi Network topology nodes for consoles, sites, devices, and connected
  clients, including uplink relationships when available
- Admin visibility toggle for the UniFi Network module

## [1.0.0-beta.21] - 2026-06-05

### Added

- Admin feature visibility toggles for SNMP, Docker, UniFi Protect, and Network
  Map modules without deleting saved data
- Persistent topology overrides for discovered nodes so inferred SNMP, Docker,
  monitor, subnet, and Protect nodes can be renamed, repositioned, and assigned
  icons
- Smart infrastructure icon badges for UniFi, Protect cameras, gateways,
  switches, access points, Docker, servers, cloud, web services, and alerts

### Changed

- UniFi Protect rows now use branded UniFi and camera identity badges instead
  of plain text initials

## [1.0.0-beta.20] - 2026-06-05

### Added

- UniFi Protect host setup with local API-key camera discovery, camera
  connection and recording state, offline incidents, Discord alerts, and
  network-map topology nodes
- Protect cameras now appear in monitored services, global search, fleet health,
  and the dedicated UniFi Protect workspace

### Changed

- Mobile readability has been increased across cards, forms, status labels,
  tables, and graph labels
- Uptime response graphs now skip missing samples and scale around normal
  response values so occasional outliers do not dominate low-latency charts

## [1.0.0-beta.19] - 2026-06-05

### Added

- Selectable SNMP interface graphs in device details, including total traffic
  and per-interface inbound/outbound throughput views
- Clear SNMP graph helper text showing whether the chart is total device
  traffic or a specific interface, including interface speed when available

## [1.0.0-beta.18] - 2026-06-04

### Added

- Easy alert templates for Docker baselines and SNMP storage/health rules
- Zabbix-style alert dependencies so child rules can be suppressed while a
  parent rule is already active
- Alert acknowledgements for active variable-rule incidents
- Admin Settings workspace with maintenance mode, alert counts, Discord status,
  runtime version, data directory, and SQLite database path
- Maintenance mode for suppressing new variable-rule incidents during planned
  work

## [1.0.0-beta.17] - 2026-06-04

### Fixed

- Ping monitors now parse the actual ICMP reply latency from the OS ping output
  instead of timing the full command execution overhead
- The network map now links monitors directly to matching SNMP or Docker host
  IPs before falling back to inferred `/24` subnet groups

## [1.0.0-beta.16] - 2026-06-04

### Added

- Historical SNMP interface counter storage and selectable bandwidth graphs with
  inbound/outbound bitrate scales and timestamps
- Dual-axis uptime performance graphs with uptime percentages, response
  milliseconds, reporting timestamps, and clearer visual styling
- Structured Discord embeds for monitor, SNMP device, Docker host, Docker
  container, recovery, and test notifications

### Fixed

- New alert rules no longer open in locked edit mode with greyed-out SNMP,
  target, metric, and condition fields

## [1.0.0-beta.15] - 2026-06-04

### Added

- Selectable 1-hour, 24-hour, 7-day, 30-day, and 90-day reporting ranges
- Durable hourly reporting rollups for long-range uptime and response charts
- Zabbix-style alert severity, descriptions, recommended actions, editable
  rules, pause controls, and consecutive trigger/recovery check counts
- Structured colour-coded Discord alert embeds with source, current value,
  trigger expression, reason, and recommended action
- Persistent manual map nodes and links, editable node status/details/type/X/Y
  position, deletions, and a visual linked topology canvas

## [1.0.0-beta.14] - 2026-06-04

### Added

- Dedicated Docker fleet workspace with resource summaries, stacks, container
  details, and recent CPU/RAM metric history
- Configurable SNMP and Docker variable alert rules with numeric and text
  operators, automatic recovery, incidents, and Discord notifications
- Derived per-filesystem TrueNAS storage usage percentages for threshold rules
- Inferred network topology workspace covering local subnets, SNMP devices,
  Docker hosts and containers, and monitored services

## [1.0.0-beta.13] - 2026-06-04

### Added

- Full TCP port discovery using `all` or `1-65535` for one private/local IPv4
  address at a time

### Fixed

- Orphaned Docker container rows and metrics from deleted historical hosts are
  now removed during startup
- Docker fleet responses now exclude orphaned and stopped rows at the API
  boundary
- Duplicate container IDs and stopped containers returned by Docker-compatible
  TrueNAS endpoints are filtered before storage

## [1.0.0-beta.12] - 2026-06-04

### Fixed

- Docker fleet polling now tracks active containers only instead of importing
  every historical exited container from the Docker daemon
- Existing installations automatically remove legacy unassigned containers,
  duplicate Docker hosts, orphaned metrics, and stale container records
- Duplicate socket and HTTP/HTTPS Docker daemon registrations are rejected
- Repeated Docker fleet refreshes no longer increase the container count

### Changed

- Docker fleet totals now focus on configured hosts, active containers,
  healthy containers, and unhealthy containers

## [1.0.0-beta.11] - 2026-06-04

### Added

- Private-network TCP auto-discovery from Add Monitor and the monitored
  services panel
- IPv4 CIDR, start-end range, and single-host scan inputs
- Common TCP service-name suggestions, reverse-DNS host naming, editable
  monitor names, duplicate detection, and selective bulk import
- Live integration coverage that discovers and imports a real TCP service

### Security

- Discovery is restricted to private/local IPv4 networks, 256 addresses, 64
  ports, and 8,192 probes per scan
- Only one discovery scan can run at a time, with bounded connection and
  reverse-DNS timeouts
- Discovery uses direct TCP probes and never executes user-provided shell or
  Nmap arguments

## [1.0.0-beta.10] - 2026-06-04

### Added

- Configurable Docker host monitors with socket, HTTP, and HTTPS daemon
  connections, connection testing, editing, deletion, and per-host status
- Docker host setup through both Add Monitor and the container fleet panel
- Docker host incidents, home-page uptime contribution, and Discord
  down/recovery notifications
- UniFi AP VAP client totals, radio/VAP/system enterprise telemetry, and
  SNMP-reported client summary
- 64-bit IF-MIB traffic counters, high-speed links, errors, and discards for
  UniFi gateway, AP, switch, and standard SNMP interfaces

### Changed

- Existing installations with a mounted Docker socket automatically receive a
  Local Docker Engine host on upgrade
- Container fleet data is grouped by its configured Docker host
- UCG gateway details now focus on WAN/LAN interface statistics and explicitly
  identify controller-wide client totals as requiring UniFi Network API access

## [1.0.0-beta.9] - 2026-06-04

### Added

- Dedicated SNMP fleet workspace with health totals, active SNMP alerts,
  profiles, device actions, and a complete fleet view
- SNMP v3 polling with no-auth, authentication, and authentication/privacy
  security levels using SHA/MD5 and AES/DES options
- Bounded administrator SNMP walk tool with readable OID categories and a
  1,000-result safety limit
- Built-in assignable TrueNAS and UniFi profiles
- Safe Zabbix XML SNMP template import and custom OID polling
- SNMP administration shortcut in account settings and device-level walk
  actions

### Security

- Saved SNMP v2c communities and SNMP v3 authentication/privacy keys are never
  returned by the API
- Imported Zabbix scripts and preprocessing are ignored; only numeric SNMP
  item OIDs are accepted

## [1.0.0-beta.8] - 2026-06-04

### Added

- TrueNAS SNMP profile with processor load, system load, UCD memory,
  HOST-RESOURCES storage/pool/dataset entries, interfaces, and TrueNAS MIB
  inventory
- Local Docker Engine fleet discovery using the mounted Docker socket
- Docker container state, health, image, CPU, memory, restart count, Compose
  project, history, incidents, and Discord down/recovery alerts
- Real Docker container fleet dashboard and unified Docker uptime health

### Changed

- Docker and TrueNAS fleet health now contributes to overall uptime, degraded
  counts, graphs, incidents, and live alerts
- TrueNAS and Compose deployment examples now mount the Docker socket for
  local container fleet monitoring

## [1.0.0-beta.7] - 2026-06-04

### Added

- SNMP devices in monitored services, overall uptime totals, and the 24-hour
  uptime graph
- Real SNMP incidents with automatic resolution and existing Discord
  down/recovery alerts
- Live flashing active-alert strip, incident indicator, degraded card, and
  sidebar health state
- Editable SNMP device name, address, port, community, polling interval,
  timeout, and enabled state
- UniFi gateway, access point, and switch profile detection

### Changed

- UCG and UniFi access point details now focus on useful physical interfaces
  and hide obvious Linux tunnel, loopback, and virtual interfaces
- Dashboard health and incidents refresh automatically every 30 seconds
- Manual dashboard refresh now checks both service monitors and SNMP devices

## [1.0.0-beta.6] - 2026-06-04

### Added

- Scannable QR codes for authenticator-app MFA setup
- Mobile off-canvas navigation with a burger menu and accessible account
  settings

### Changed

- Mobile search is now a full-width usable field and filters both monitors and
  SNMP devices
- Increased mobile dashboard, navigation, card, form, and modal text sizes
- Improved mobile monitor rows and modal action buttons

## [1.0.0-beta.5] - 2026-06-04

### Added

- Ping IP/hostname monitor type using real ICMP checks inside the container
- UniFi-focused SNMP device profile and automatic UniFi/Ubiquiti detection
- SNMP device details view with refreshable system OIDs and poll history
- SNMP interface discovery with status, MAC address, speed, and traffic
  counters

### Changed

- SNMP device cards now open a full details view
- Container now includes the system ping utility required for ICMP monitoring

## [1.0.0-beta.4] - 2026-06-04

### Added

- Real SNMP v2c device polling using configurable host, port, community,
  interval, and timeout
- Standard SNMP system name, description, and uptime polling
- Stored SNMP device status and metrics with background and manual polling
- Discord down and recovery alerts for SNMP devices
- Real 24-hour uptime and response-time graphs from stored heartbeats

### Fixed

- Confirm-password field no longer appears on the normal login screen
- Increased text sizes throughout the dashboard, forms, modals, events, and
  monitor rows for better readability

## [1.0.0-beta.3] - 2026-06-04

### Added

- Monitor editing, pause/resume controls, and recent heartbeat history
- Real incident creation when monitors fail and resolution when they recover
- Real incident stream, incident count, and incident browser
- Discord webhook configuration, test notifications, and down/recovery alerts
- Functional monitor search

### Changed

- Removed all Pro labels and feature gating
- Replaced fabricated event, SNMP, Docker, and graph data with honest
  Coming soon states
- Disabled monitor checks now display as paused

## [1.0.0-beta.2] - 2026-06-04

### Added

- Real persisted HTTP/HTTPS uptime monitors
- Real persisted TCP port monitors
- Automatic background checks with configurable intervals and timeouts
- Manual monitor checks, response times, last errors, and monitor deletion
- SQLite heartbeat history foundation
- Working Add Monitor dashboard flow
- Live overview counts, availability percentage, and average response time from
  real monitors

### Changed

- Reduced initial administrator password minimum from 12 to 8 characters
- Clarified that the optional MFA authentication code comes from an
  authenticator app
- Unimplemented navigation items now clearly say they are coming next instead
  of pretending to switch to a working view

## [1.0.0-beta.1] - 2026-06-04

### Added

- NichHome Uptime responsive infrastructure dashboard
- Guided first-run administrator setup
- SQLite-backed application persistence
- Secure `scrypt` password hashing
- Cookie-backed authenticated sessions
- Optional TOTP authenticator MFA
- Account security controls and sign-out
- Docker and TrueNAS SCALE deployment configuration
- Persistent `/data` volume for the application database
- AMD64 and ARM64 container publishing to GitHub Container Registry
- Automated authentication, MFA, syntax, and container build checks
- Runtime version endpoint and visible dashboard version badge

### Security

- HTTP-only, same-site session cookies
- Login attempt rate limiting
- Origin checks for state-changing requests
- Security response headers and Content Security Policy

### Known Limitations

- Dashboard telemetry remains demonstration data
- Live SNMP, Docker, Discord, incident, and public status-page integrations are
  not yet implemented

[Unreleased]: https://github.com/jcnicholls123/nichhome-uptime/compare/v1.0.0-beta.8...HEAD
[1.0.0-beta.8]: https://github.com/jcnicholls123/nichhome-uptime/releases/tag/v1.0.0-beta.8
[1.0.0-beta.7]: https://github.com/jcnicholls123/nichhome-uptime/releases/tag/v1.0.0-beta.7
[1.0.0-beta.6]: https://github.com/jcnicholls123/nichhome-uptime/releases/tag/v1.0.0-beta.6
[1.0.0-beta.5]: https://github.com/jcnicholls123/nichhome-uptime/releases/tag/v1.0.0-beta.5
[1.0.0-beta.4]: https://github.com/jcnicholls123/nichhome-uptime/releases/tag/v1.0.0-beta.4
[1.0.0-beta.3]: https://github.com/jcnicholls123/nichhome-uptime/releases/tag/v1.0.0-beta.3
[1.0.0-beta.2]: https://github.com/jcnicholls123/nichhome-uptime/releases/tag/v1.0.0-beta.2
[1.0.0-beta.1]: https://github.com/jcnicholls123/nichhome-uptime/releases/tag/v1.0.0-beta.1
