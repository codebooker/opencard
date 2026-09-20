# Changelog

## Unreleased — single-company self-hosting transition

This work is in progress and has not been published as a tagged release.

- Changed the application from a multi-customer SaaS to one business per installation.
- Removed public organization signup, subscription billing, plan tiers, and card limits.
- Added Docker Compose setup, optional Caddy HTTPS proxy, and first-owner bootstrap instructions.
- Added local database/upload snapshots, workspace-content restore, and optional S3-compatible offsite copies.
- Added an AGPL-3.0-only license, a project website with a static demo card, and a GitHub Pages deployment workflow.

See [the README](README.md) for the current feature list and [the deployment guide](deploy/README.md) before using this build in production.
