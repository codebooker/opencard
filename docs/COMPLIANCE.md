# Security and privacy operations

OpenCard is software you operate for your company. This page describes technical controls and responsibilities; it is not a certification or legal-compliance claim.

## Access and data

- Run one company per database. The app and migration reject a database containing multiple `Org` records. The `orgId` columns remain for scoped queries and upgrade compatibility.
- The bundled Compose setup provisions a least-privilege PostgreSQL app role and enables row-level security. Do not point the web process at the database owner account in production.
- Admin and employee access are separate. Limit owner accounts, enable MFA, and remove accounts when people leave. Keep `SESSION_SECRET`, database passwords, integration credentials, and backup access keys private.
- Admin → Audit records security-relevant actions. Admin → Data & privacy provides a data export, lead erasure, and retention settings. Review the behavior against your own legal obligations before using real personal data.
- Configure HTTPS, a trusted reverse proxy, and mail before exposing login or password reset to users. Keep the host and dependencies patched.

## Backups

Admin → Backups can take and restore workspace-content snapshots. Those are not a complete machine-recovery plan: uploaded files and the full database must also be saved. The host-side `deploy/backup.sh` captures a PostgreSQL dump and uploads archive; it can send them to Wasabi or another S3-compatible store. See [deployment and restore guidance](../deploy/README.md).

Backups contain personal information and possibly sealed integration secrets. Restrict access, use provider-side encryption, apply your own retention rules, and test a complete restore on a separate installation. Preserve the original `SESSION_SECRET` so restored encrypted credentials can be opened.

## Release hygiene

Review migrations before upgrades, back up before applying them, and use the tagged application version that matches a restored database. Run the test suite and scan dependencies for vulnerabilities. The repository's CI is a baseline, not a substitute for operator monitoring and incident response.
