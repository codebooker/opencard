# OpenCard

OpenCard is a multi-tenant SaaS platform for digital business cards. Each person
gets a fast, mobile-first card page (`/c/:slug`) with **Add to Contacts**, a
**branded QR code**, and built-in **lead capture** — and every organization gets
its own isolated workspace, branding, analytics, and billing.

It's built for everyone from a single professional on the Individual plan to a
multi-location brand running hundreds of cards across many sites, with directory
auto-provisioning and SSO. The data model is vertical-neutral, so the same
platform serves dealerships, brokerages, agencies, franchises, and ordinary teams
— each org just relabels the shared concepts to fit its world.

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the design deep-dive and
**[docs/](./docs/)** for API, webhook, and compliance references. Production
deployment and disaster recovery live in **[deploy/](./deploy/)**.

## What it does

- **Public card pages** (`/c/:slug`) — mobile-first, themed per brand → location →
  card, with vCard download and an accessible, no-CDN front end.
- **Branded QR codes** — custom colors, gradients, and a center logo. A card's QR
  points at its page; standalone QR codes can redirect anywhere you choose while
  still recording the scan as a lead, with rough (city-level) geolocation from an
  offline IP lookup.
- **Lead capture & CRM** — public "connect" forms, two-way contact capture, CSV
  export, and optional sync to external CRMs.
- **Analytics** — views, link clicks, contacts saved, QR scans (with geo), and
  campaign attribution.
- **Admin workspace** (`/admin`) — manage brands, locations, cards, users,
  billing, integrations, and analytics, with per-brand / per-location branding.
- **Directory auto-provisioning** — Azure AD / Entra via SCIM 2.0: add someone to
  the directory and their card is created in the right location automatically.
- **SSO** — Azure AD OIDC for employees and per-org SAML for admins/employees.
- **REST API & webhooks** — programmatic access to brands, locations, cards,
  leads, and analytics; HMAC-signed event delivery.
- **Marketing site, legal, and billing** — public landing page at the app root,
  Terms/Privacy with signup acceptance, an accessibility widget, a contact form,
  and Stripe-backed subscriptions.

## Multi-tenancy & isolation

Every org is a hard-isolated tenant. Beyond application-level scoping, the app
connects to Postgres as a least-privilege `opencard_app` role with **row-level
security** enforced, so a query can only ever see its own org's rows — the app
refuses to start in production without it. Tenants are resolved by `Host` header,
which also powers custom domains (on-demand TLS via Caddy).

## Plans

Four tiers, defined in [`src/plans.ts`](./src/plans.ts) and enforced through
`src/entitlements.ts` (feature flags + countable limits); real prices live in
Stripe:

- **Individual** — one person, one card.
- **Team** — self-service editing, email signatures, CSV export, API.
- **Multi Location Brand** — adds webhooks, SSO, SCIM, custom domains, CRM sync.
- **Enterprise** — everything, at scale (talk-to-us).

## Tech stack

Node.js + TypeScript, Express with server-rendered HTML (no client framework),
Prisma ORM over PostgreSQL 16, and `sharp` for QR/image rendering. Runs as a
Docker Compose stack — Caddy (TLS + reverse proxy) in front of two web
containers and Postgres.

## Quick start (Docker)

```bash
cp .env.example .env
# edit .env: set SESSION_SECRET and SCIM_TOKEN to long random strings
# (openssl rand -hex 32), and BASE_URL to the public URL.

docker compose up --build
```

This starts Postgres + the app, applies the schema, seeds demo data, and serves
on `http://localhost:3000`. The marketing site is at `/`, a sample card at
`/c/...` (see `prisma/seed.ts`), and admin at `/admin`.

Create your first admin account (there is no static admin token — admin login is
a real, revocable per-user account):

```bash
# once the app container is up
docker compose exec web node dist/scripts/make-admin.js you@yourco.com "Your Name"
# prints a one-time password; sign in at /admin/login and change it
```

## Local dev (without Docker)

```bash
npm install
# point DATABASE_URL at a local Postgres in .env
npx prisma migrate dev   # apply migrations (creates tables)
npm run seed             # optional demo data
npm run dev              # http://localhost:3000
```

`npm run build` compiles to `dist/`; `npm start` runs the compiled server.
`npm run typecheck` type-checks without emitting. `npm test` runs the unit tests.

## Database migrations

Schema changes are versioned with Prisma Migrate (committed under
`prisma/migrations/`), not `prisma db push`.

- **Production / Docker:** the container runs `prisma migrate deploy` on boot to
  apply pending migrations. A database created before migrations were adopted is
  baselined automatically.
- **Changing the schema:** edit `prisma/schema.prisma`, then
  `npx prisma migrate dev --name <change>` and commit the generated folder.

## Managing brands, locations, and cards

In `/admin`:

1. **New brand** — set the brand logo, primary color, and default layout.
2. **+ Location** under a brand — optionally override logo, color, and layout,
   set its address, and give it a **code** (e.g. `MW-DT`) — that's what the
   directory maps against. (Orgs can relabel "location" as store, rooftop, etc.)
3. **+ New card** in a location — fill in the person's details. Leave design
   fields blank to inherit. A card's look resolves most-specific-first:
   `card override → location → template → brand`.

## Branded QR codes

Design QR codes in the admin **QR Codes** section: pick foreground/background
colors, an optional gradient, a dot style, and a center logo. Each card exposes a
rendered PNG at `/c/:slug/qr.png`; standalone codes can target any destination
URL and still log the scan (with city-level geo) as a lead before redirecting.
The engine lives in `src/qr-style.ts` (SVG) and `src/qr-render.ts` (rasterization).

## Auth, SSO & provisioning

**Admin accounts** are always real, revocable, per-user (email + password,
scrypt-hashed, with TOTP MFA — required for platform/staff accounts). Bootstrap
or recover one from the box:

```bash
node dist/scripts/make-admin.js you@yourco.com "Your Name" [role]
# default role: platform_owner. Prints a one-time password; change it after login.
```

**SCIM (Azure AD / Entra):** create a non-gallery Enterprise app →
Provisioning → Automatic. Tenant URL `https://<host>/scim/v2`, secret token =
`SCIM_TOKEN`. Map a directory attribute (e.g. `costCenter`) to the location code
so users route to the right location; unmatched users fall back to brand, then
the first location, and an admin can re-assign in one click. Deactivating a user
sets their card inactive. Endpoints: `GET/POST /Users`,
`GET/PUT/PATCH/DELETE /Users/:id`, `GET /ServiceProviderConfig` (bearer auth).

**SAML** is off by default; a super admin enables it per-org at
`/admin/integrations` with the IdP SSO URL, issuer, and signing cert. **OIDC**
(Azure AD) signs employees in at `/me` via `AZURE_TENANT_ID` /
`AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`.

## REST API

Base URL `<BASE_URL>/api/v1`, `Authorization: Bearer <key>`. Create/revoke keys in
**Admin → Integrations** (raw key shown once).

```
GET    /api/v1/brands            GET /api/v1/brands/:id      POST /api/v1/brands
GET    /api/v1/stores?brandId=   GET /api/v1/stores/:id      POST /api/v1/stores
GET    /api/v1/cards?locationId=&brandId=&ownerEmail=
GET    /api/v1/cards/:id
POST   /api/v1/cards             PATCH /api/v1/cards/:id      DELETE /api/v1/cards/:id
GET    /api/v1/leads?cardId=&since=
GET    /api/v1/analytics?cardId=
```

Card create/update accept `phones`/`emails`/`websites`/`socials` as arrays of
objects. Full reference: **[docs/API.md](./docs/API.md)**.

## Webhooks

Subscribe URLs to events in **Admin → Integrations**. Each delivery is a JSON POST
with `X-OpenCard-Event` and `X-OpenCard-Signature: sha256=<hmac>` — verify with
`HMAC-SHA256(rawBody, endpointSecret)`. Events: `lead.captured`, `card.created`,
`card.updated`, `card.deleted`. Failed deliveries retry up to 3 times. Details:
**[docs/WEBHOOKS.md](./docs/WEBHOOKS.md)**.

## Project layout

```
prisma/schema.prisma      data model (Org→Brand→Location→Card, events, leads)
prisma/seed.ts            demo brands/locations/cards
src/server.ts             express bootstrap + tenant resolution
src/routes/cards.ts       public card page, vCard, QR, event + lead capture
src/routes/signup.ts      self-serve signup (magic link + beta access gate)
src/routes/api.ts         REST API v1
src/routes/scim.ts        SCIM 2.0 provisioning for Entra/Azure AD
src/routes/admin.ts       admin router (assembles the groups below)
src/routes/admin/*.ts     admin route groups (auth, console, cards, branding,
                          analytics, leads, integrations, accounts, billing)
src/views/marketing.ts    public landing page
src/views/card.ts         public card rendering
src/views/legal.ts        Terms of Service + Privacy Policy
src/plans.ts              plan tiers + feature/limit definitions
src/entitlements.ts       plan enforcement (features + limits)
src/qr-style.ts           branded QR SVG engine (colors, gradients, logo)
src/qr-render.ts          QR rasterization (SVG → PNG via sharp)
src/geo.ts                offline IP → city-level geolocation
src/stripe.ts             billing / subscriptions
src/db.ts, db-bootstrap.ts  Prisma client + least-privilege RLS role setup
deploy/                   production Docker Compose, Caddy, backup + migration runbooks
```

## Security

- Strong random `SESSION_SECRET` (also encrypts CRM tokens + webhook secrets at
  rest) and `SCIM_TOKEN`.
- `APP_DB_PASSWORD` set so the app runs as the least-privilege `opencard_app` role
  with Postgres row-level security enforced (required in production).
- TLS terminated by Caddy; `BASE_URL` on https; `/admin` behind MFA (and SSO where
  configured).
- Outbound integration URLs are SSRF-guarded; audit logs record
  security-relevant actions.
- Nightly Postgres + uploads backups, offsite (see `deploy/backup.sh` and
  `deploy/MIGRATION.md`).

## Docs & roadmap

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — system design and data model.
- **[docs/API.md](./docs/API.md)**, **[docs/WEBHOOKS.md](./docs/WEBHOOKS.md)**,
  **[docs/COMPLIANCE.md](./docs/COMPLIANCE.md)**.
- **[docs/ROADMAP.md](./docs/ROADMAP.md)** — product roadmap.
- **[deploy/MIGRATION.md](./deploy/MIGRATION.md)** — restore / server-move runbook.
</content>
