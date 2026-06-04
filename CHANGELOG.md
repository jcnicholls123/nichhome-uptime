# Changelog

All notable changes to NichHome Uptime are documented here.

This project uses [Semantic Versioning](https://semver.org/). Beta releases can
include breaking changes while the monitoring engine and integrations mature.

## [Unreleased]

### Planned

- SNMPv3 polling and broader device discovery
- Docker Engine integration
- Additional historical reporting ranges
- Public status pages

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

[Unreleased]: https://github.com/jcnicholls123/nichhome-uptime/compare/v1.0.0-beta.7...HEAD
[1.0.0-beta.7]: https://github.com/jcnicholls123/nichhome-uptime/releases/tag/v1.0.0-beta.7
[1.0.0-beta.6]: https://github.com/jcnicholls123/nichhome-uptime/releases/tag/v1.0.0-beta.6
[1.0.0-beta.5]: https://github.com/jcnicholls123/nichhome-uptime/releases/tag/v1.0.0-beta.5
[1.0.0-beta.4]: https://github.com/jcnicholls123/nichhome-uptime/releases/tag/v1.0.0-beta.4
[1.0.0-beta.3]: https://github.com/jcnicholls123/nichhome-uptime/releases/tag/v1.0.0-beta.3
[1.0.0-beta.2]: https://github.com/jcnicholls123/nichhome-uptime/releases/tag/v1.0.0-beta.2
[1.0.0-beta.1]: https://github.com/jcnicholls123/nichhome-uptime/releases/tag/v1.0.0-beta.1
