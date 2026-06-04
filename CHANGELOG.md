# Changelog

All notable changes to NichHome Uptime are documented here.

This project uses [Semantic Versioning](https://semver.org/). Beta releases can
include breaking changes while the monitoring engine and integrations mature.

## [Unreleased]

### Planned

- Additional historical reporting ranges
- Public status pages
- UniFi Network API integration for controller-wide gateway client totals

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
