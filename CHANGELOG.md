# Changelog

All notable changes to NichHome Uptime are documented here.

This project uses [Semantic Versioning](https://semver.org/). Beta releases can
include breaking changes while the monitoring engine and integrations mature.

## [Unreleased]

### Planned

- SNMP v2c/v3 polling and device discovery
- Docker Engine integration
- Historical uptime graphs and reporting ranges
- Public status pages

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

[Unreleased]: https://github.com/jcnicholls123/nichhome-uptime/compare/v1.0.0-beta.3...HEAD
[1.0.0-beta.3]: https://github.com/jcnicholls123/nichhome-uptime/releases/tag/v1.0.0-beta.3
[1.0.0-beta.2]: https://github.com/jcnicholls123/nichhome-uptime/releases/tag/v1.0.0-beta.2
[1.0.0-beta.1]: https://github.com/jcnicholls123/nichhome-uptime/releases/tag/v1.0.0-beta.1
