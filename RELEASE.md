# Release Process

NichHome Uptime follows Semantic Versioning:

- `v1.0.0-beta.1`: prerelease builds while core monitoring features mature
- `v1.0.0`: first stable release
- `v1.1.0`: backward-compatible features
- `v1.0.1`: backward-compatible fixes

## Create a Release

1. Move completed entries from `Unreleased` into a dated version section in
   `CHANGELOG.md`.
2. Update the version in `package.json` and `package-lock.json`.
3. Commit and push the release changes to `main`.
4. Tag the commit using the matching version prefixed with `v`.
5. Push the tag.

The GitHub release workflow validates that the tag matches `package.json`,
runs the full test suite, and creates a GitHub prerelease or stable release.
The container workflow publishes exact-version, `beta`, and `latest` tags as
appropriate.
