# Changelog

All notable changes to NichHome Uptime are documented here.

This project uses [Semantic Versioning](https://semver.org/). Beta releases can
include breaking changes while the monitoring engine and integrations mature.

## [Unreleased]

### Planned

- Persistent uptime monitors and heartbeat history
- SNMP v2c/v3 polling and device discovery
- Docker Engine integration
- Discord webhook notifications

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

[Unreleased]: https://github.com/jcnicholls123/nichhome-uptime/compare/v1.0.0-beta.1...HEAD
[1.0.0-beta.1]: https://github.com/jcnicholls123/nichhome-uptime/releases/tag/v1.0.0-beta.1
