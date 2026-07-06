# Codebase Analysis

## Executive Summary

OpenCard is a server-rendered Node.js/TypeScript application for digital business cards, lead capture, dealership/rooftop QR assets, admin management, directory provisioning, SSO, CRM/webhook integrations, billing, and data export/retention. It is moving from a self-hosted internal tool toward a multi-tenant SaaS shape.

The project is compact and understandable, with many targeted unit tests and a simple operational model. The main maturity gaps are around multi-tenant security hardening, route-level authorization consistency, outbound integration safety, documentation drift, and operational polish for production SaaS use.

## Technology Stack

- **Languages:** TypeScript, SQL, shell.
- **Runtime:** Node.js 22.
- **Web framework:** Express 4 with server-rendered HTML views.
- **Database:** PostgreSQL 16 through Prisma ORM.
- **Auth mechanisms:** DB-backed admin sessions, password auth with scrypt hashes, optional TOTP MFA, employee OIDC against Microsoft Entra, optional per-org SAML, signed employee email cookie, API bearer keys, SCIM bearer tokens.
- **Tenant isolation:** Application-level org filters plus optional Postgres RLS through an `opencard_app` role and `app.current_org_id`.
- **Integrations:** Microsoft Graph directory import, SCIM provisioning, Stripe checkout/webhooks, SMTP/Nodemailer, Slack/Teams incoming webhooks, generic webhooks, HubSpot, Salesforce Web-to-Lead, Google/Apple Wallet placeholders.
- **File/media handling:** Multer image uploads to local persistent volume, static `/uploads` serving, QR generation, PDFKit for ID cards.
- **Build/test:** TypeScript compiler, Node test runner, Prisma generate/migrate, npm scripts.
- **Deployment:** Docker multi-stage image, Docker Compose, Caddy reverse proxy, GitHub Actions CI/deploy, self-hosted runner.

## Application Architecture

The Express app in `src/server.ts` installs security headers, logging, parsers, cookie parsing, CSRF protection, rate limiters, static assets, uploaded-file serving, and route modules.

Major route surfaces:

- `/admin` - authenticated admin UI for tenants and platform staff.
- `/me` - employee self-service login and card editing.
- `/c` - public employee card pages, vCards, QR codes, wallet links, and lead capture.
- `/a` - public QR/NFC assets and asset lead capture.
- `/k` - public campaign short links.
- `/api/v1` - bearer-authenticated REST API with scopes.
- `/scim/v2` - SCIM provisioning endpoint.
- `/signup` - self-service tenant onboarding.
- `/stripe/webhook` - raw-body Stripe webhook endpoint.

Data model centers on `Org -> Brand -> Location -> Card`, with related leads, analytics events, departments, assets, campaigns, admin users, API keys, webhooks, CRM integrations, SAML config, directory config, and audit logs.

The code has two Prisma clients:

- `prisma`: privileged owner client used broadly in admin/public/auth paths.
- `tenantDb` via `runWithOrg`: least-privilege RLS client when `APP_DB_PASSWORD` is configured; otherwise it falls back to the owner client.

## Repository Structure

- `src/server.ts` - Express bootstrap and middleware wiring.
- `src/routes/` - main HTTP route modules.
- `src/middleware/` - auth and hardening middleware.
- `src/views/` - server-rendered HTML builders.
- `src/*.ts` - domain helpers for RBAC, auth, SAML, SCIM, webhooks, CRM sync, analytics, reports, lead routing, parsing, uploads, etc.
- `src/*.test.ts` - unit tests.
- `prisma/schema.prisma` - authoritative database schema.
- `prisma/migrations/` - committed Prisma migrations, including RLS policies.
- `docs/` - API/webhook/compliance/roadmap documentation.
- `deploy/` - production compose, Caddyfile, bootstrap, backup, healthcheck, and deploy docs.
- `.github/workflows/` - CI and deploy workflows.
- `Dockerfile`, `docker-compose.yml` - local and container build/deploy definitions.

## Local Development

Based on the README:

```bash
npm install
# set DATABASE_URL in .env to a local Postgres
npx prisma migrate dev
npm run seed
npm run dev
```

Docker quick start:

```bash
cp .env.example .env
docker compose up --build
```

Important setup notes:

- Local dependency installation is required before `npm run typecheck` or `npm test`; this checkout currently lacks local `node_modules`, so `tsc` was not found.
- `.env.example` does not include every environment variable used by the app, notably `APP_DB_PASSWORD`, `APP_URL`, `CARD_URL`, Stripe variables, SMTP variables, wallet variables, `TRUST_PROXY_HOPS`, `PLATFORM_DOMAIN`, and backup-related variables.
- README and deploy docs still describe an admin break-glass token login, but the code comments state that `ADMIN_TOKEN` auth was removed.

## Build and Deployment

Build scripts:

- `npm run build` - TypeScript build.
- `npm start` - runs `dist/server.js`.
- `npm run typecheck` - `tsc --noEmit`.
- `npm test` - compiles tests into `.test-build` and runs `node --test`.

Docker:

- Multi-stage Dockerfile builds TypeScript and Prisma client.
- Runtime image installs production dependencies and PostgreSQL client tools for backup/restore.
- Local compose starts Postgres and web, applies migrations, bootstraps the app DB role, seeds demo data, and starts the server.
- Production compose runs two web instances behind Caddy, requires `APP_DB_PASSWORD`, and mounts uploads/backups volumes.

CI/CD:

- `.github/workflows/ci.yml` runs `npm ci`, Prisma generate, typecheck, and tests.
- `.github/workflows/deploy.yml` deploys from `main` through a self-hosted runner and rolling Docker Compose update.

## Configuration and Environment Variables

Confirmed or inferred variables:

- Core: `DATABASE_URL`, `APP_DB_PASSWORD`, `PORT`, `NODE_ENV`, `BASE_URL`, `APP_URL`, `CARD_URL`, `TRUST_PROXY_HOPS`.
- Secrets: `SCIM_TOKEN`, `SESSION_SECRET`, `DB_PASSWORD`, `AZURE_CLIENT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SMTP_PASS`, wallet private key/cert paths.
- Auth/tenant: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `SELF_SERVICE_DEV_LOGIN`, `SIGNUPS_ENABLED`, `PLATFORM_DOMAIN`.
- Stripe: `STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_TEAM`, `STRIPE_PRICE_DEALER_GROUP`, `STRIPE_PRICE_ENTERPRISE`.
- SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.
- Upload/backup: `UPLOAD_DIR`, `BACKUP_DIR`, `SERVER_IPS`, `TENANTS_CNAME_TARGET`.
- Wallet: `WALLET_APPLE_PASS_TYPE_ID`, `WALLET_APPLE_TEAM_ID`, `WALLET_APPLE_CERT_PATH`, `WALLET_APPLE_KEY_PATH`, `WALLET_APPLE_WWDR_PATH`, `WALLET_GOOGLE_ISSUER_ID`, `WALLET_GOOGLE_SERVICE_EMAIL`, `WALLET_GOOGLE_SERVICE_KEY`.
- Misc deploy scripts: `S3_ENDPOINT`, `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `HEARTBEAT_URL`, `ALERT_EMAIL`.

Documentation gaps:

- `.env.example` is incomplete for production-like use.
- README still instructs setting and using `ADMIN_TOKEN`, but current auth code removed that path.
- Deploy README says to save/sign in with a break-glass admin token, conflicting with production compose comments.

## Testing

The repository has many focused unit tests across security-sensitive and domain modules, including auth, roles, tenant context, SAML core, API scopes, webhooks, assets, routing, retention, analytics, and integrations.

Commands attempted:

- `npm run typecheck` failed: `sh: tsc: command not found`.
- I did not run `npm test` because dependencies are absent and the test script writes `.test-build`; the request limited filesystem changes to the two reports.
- `npm audit --json` succeeded and found one high-severity vulnerable package (`nodemailer`).

Missing or recommended tests:

- Cross-tenant webhook dispatch isolation.
- Brand deletion tenant-scope regression.
- API relationship validation for `templateId`, `departmentId`, and other foreign keys.
- Production signup behavior when SMTP is missing.
- SSRF-safe URL validation.
- SAML replay/request-id validation.

## Code Quality Findings

| ID | Priority | Area | Issue | File/Area | Recommendation |
|---|---|---|---|---|---|
| CQ-01 | P0 | Security tests | No apparent regression test catches cross-tenant webhook dispatch | `src/webhooks.ts` | Add multi-tenant webhook dispatch tests before/with the fix |
| CQ-02 | P1 | Authorization | Destructive route uses coarse role check instead of scoped helper | `src/routes/admin.ts` brand delete | Centralize destructive route guard patterns |
| CQ-03 | P1 | Documentation | README/deploy docs reference removed `ADMIN_TOKEN` login | `README.md`, `deploy/README.md`, `.env.example` | Update docs and examples to match DB-backed admin bootstrap |
| CQ-04 | P1 | Configuration | Production signup defaults and SMTP-less fallback are risky | `deploy/docker-compose.prod.yml`, `src/routes/signup.ts` | Make signup/email verification behavior explicit and fail closed |
| CQ-05 | P2 | Architecture | `src/routes/admin.ts` is over 3,100 lines | `src/routes/admin.ts` | Split by domain: auth, clients, cards, leads, integrations, billing, data |
| CQ-06 | P2 | Tenant isolation | RLS is optional and many routes use owner Prisma client | `src/db.ts`, route modules | Document owner-client exceptions and fail closed in production |
| CQ-07 | P2 | Input validation | Outbound URLs use inconsistent validation | Webhooks/CRM/chat/campaigns | Use one shared URL validator and egress policy |
| CQ-08 | P2 | Secret handling | Directory secrets are encrypted, but CRM/webhook secrets are not | `secretbox.ts`, schema | Reuse secretbox or KMS for all recoverable secrets |
| CQ-09 | P2 | Operations | Two production web instances both run in-process schedulers | `src/server.ts`, prod compose | Move scheduled jobs to a singleton worker or DB-locked job runner |
| CQ-10 | P2 | Dependencies | Several major packages are behind latest major versions | `package.json` | Plan upgrades, especially Nodemailer and Prisma |
| CQ-11 | P3 | Docker | Runtime runs as root | `Dockerfile` | Add non-root user and writable directory ownership |
| CQ-12 | P3 | Observability | Typecheck/test could not run in current checkout without install | local environment | Document required bootstrap and keep CI as source of truth |

## Maintainability Risks

- The admin router is the largest support burden. It mixes pre-auth flows, platform admin, tenant admin, imports, backups, billing, CRUD, analytics, leads, integrations, and staff management.
- Authorization is mostly good but route-local. A small omission can produce high-impact bugs, as seen in brand deletion.
- Tenant isolation relies on a combination of application filters, optional RLS, and developer discipline around owner-vs-tenant Prisma clients.
- Several integration features store recoverable secrets with different patterns. This increases the chance of inconsistent redaction, rotation, and export behavior.
- Deployment and README drift can mislead a new operator, especially around admin bootstrap, RLS, and signup/email configuration.
- In-process hourly jobs run inside the web server. In a two-instance deployment, duplicate digest or prune jobs are possible unless the job functions internally deduplicate.

## Operational Risks

- **Cross-tenant data leakage:** webhook dispatch must be fixed before multi-tenant production.
- **Backups:** local and offsite backups exist, but offsite is optional and depends on external `backup.env`.
- **Restore:** staff console restore is powerful and uses superuser-style operations. It is guarded in UI, but should be operationally logged and tested regularly.
- **Monitoring:** healthcheck script exists, but alerting depends on SMTP and one of the web containers being available.
- **Rate limits:** in-memory per process. With two web instances, effective limits double and reset on restart. Consider Redis or database-backed limiting for auth/signup.
- **Schedulers:** hourly jobs run in every web process. Use a singleton worker, advisory locks, or queue.
- **Logs:** auth email bodies may include sensitive tokens when SMTP is absent. Avoid token-bearing logs.
- **Outbound network:** webhooks/CRM integrations need SSRF controls and ideally network-level egress restrictions.
- **Container hardening:** runtime root user and broad mounted volumes increase compromise blast radius.

## Recommended 30/60/90 Day Plan

### First 30 Days

- Fix SEC-01 webhook tenant scoping and add regression tests.
- Fix SEC-02 brand deletion authorization.
- Stop logging token-bearing email bodies and fail closed for production account lifecycle email.
- Disable production signup by default or require SMTP/email verification.
- Add outbound URL validation and egress blocking for integrations.
- Update README, `.env.example`, and deploy docs to match current admin bootstrap and required production variables.
- Upgrade Nodemailer and rerun `npm audit`, typecheck, and tests.

### Days 31-60

- Encrypt CRM and webhook recoverable secrets, and reduce webhook delivery payload/signature exposure.
- Add SAML replay/request-id validation.
- Validate API relationship IDs such as template IDs against org/brand/location.
- Split `src/routes/admin.ts` into smaller route modules with shared guard helpers.
- Add integration tests for tenant isolation across admin, API, SCIM, webhooks, and data exports.
- Make RLS mandatory for production and visible in health/startup diagnostics.

### Days 61-90

- Move scheduled jobs into a singleton worker or add DB advisory locks.
- Replace in-memory rate limiting with a shared store.
- Add structured security audit events for webhook/CRM config changes, restore actions, SAML changes, MFA disablement, and data exports.
- Harden Docker runtime with a non-root user and stricter writable paths.
- Improve operational runbooks for backup restore, secret rotation, incident response, and dependency upgrades.
- Review major dependency upgrades: Prisma 7, Express 5, Stripe 22, Dotenv 17.

