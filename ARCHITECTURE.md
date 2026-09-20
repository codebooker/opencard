# OpenCard architecture

OpenCard is a self-hosted digital business card application for **one company per installation**. It is not a hosted multi-customer service. There is no public company signup, payment processor, plan tier, or card count limit.

## Runtime

- Node.js 24, TypeScript, Express, and server-rendered HTML. Public cards, admin pages, and employee self-service share one app.
- PostgreSQL 16 with Prisma migrations. The `Org` row represents the company that owns this installation. `Brand`, `Location`, `Card`, and related records retain `orgId` for consistent access control and existing-database upgrades; startup and the single-workspace migration reject databases with more than one company.
- Docker Compose supplies PostgreSQL and the web process. Caddy HTTPS is an optional profile. The default web bind is loopback-only so an operator must deliberately configure external access.
- Uploaded images live in a Docker volume; database and uploads both require backup. See [the deployment guide](deploy/README.md).

## Card and admin flows

Public `/c/:slug` pages render the current card, with contact links, vCard download, QR sharing, and optional lead capture. Card style inherits from brand, then template/location, then card overrides. Administrators manage brands, locations, people, templates, QR assets, campaigns, analytics, integrations, and backups under `/admin`. Employees edit allowed fields on their own card under `/me` after their company configures sign-in.

SSO, SCIM, Microsoft Graph import, CSV import, API keys, CRM sync, and webhooks are optional organization integrations. None requires a paid tier. An operator can omit their credentials and still use core cards.

## Security and operations

Session, database, and application-role secrets are installation-specific. The web runtime uses a least-privilege PostgreSQL role with row-level security when `APP_DB_PASSWORD` is configured; the bundled Compose setup requires it. Public and authenticated routes apply scoped access checks, request throttling, and security headers. Review [security and privacy operations](docs/COMPLIANCE.md) for the operator's responsibilities.

Backups are available in the admin UI for workspace-content snapshots, and `deploy/backup.sh` captures both a full PostgreSQL dump and uploads for disaster recovery. The host script can copy encrypted-at-rest-sensitive archives to Wasabi or another S3-compatible target through rclone. Treat all backups as sensitive and rehearse restoration.

## Project website

`site/` is a separate static project website, published to GitHub Pages. It includes a fictional [demo card](site/demo/index.html). The static sample does not require or connect to a running OpenCard installation.
