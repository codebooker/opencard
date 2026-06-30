# OpenCard

Self-hosted, in-house digital business cards.
Multi-brand and multi-store: each brand and each location has its own logo and
design, cards auto-provision from Azure AD, and everything runs in Docker on your
own infrastructure. No per-seat SaaS fees.

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the design and feature overview.
See **[docs/ROADMAP.md](./docs/ROADMAP.md)** for the dealership-first SaaS roadmap.

## What it does

- Hosted mobile card page per employee (`/c/:slug`) with theme inherited from
  brand → store → card.
- **Add to Contacts** vCard download, and a **QR code** per card (`/c/:slug/qr.png`).
- **Admin** at `/admin` to manage brands, stores, and cards, with per-brand /
  per-store logos and colors.
- **Analytics** (views, link clicks, contacts saved, leads) and **two-way contact
  capture** with CSV export.
- **Azure AD / Entra auto-provisioning** via a SCIM 2.0 endpoint — add an employee
  to the directory and a card is created automatically in the right store.

## SaaS direction: dealership-first, general underneath

OpenCard is moving toward a dealership-first SaaS wedge while keeping the core
data model vertical-neutral. Internally the app still uses generic concepts like
`Org`, `Brand`, `Location`, `Card`, and `Lead`. Each org can carry terminology
that changes how those concepts are presented in the UI. For the dealership
vertical, locations display as **rooftops**, lead capture can be positioned as
customer lead capture, and the same structure can later support franchises,
real estate brokerages, insurance agencies, and other multi-location teams.

## Quick start (Docker)

```bash
cp .env.example .env
# edit .env: set ADMIN_TOKEN and SCIM_TOKEN to long random strings,
# and BASE_URL to the public URL (e.g. https://cards.yourco.com)

docker compose up --build
```

This starts Postgres + the app, applies the schema, seeds demo data, and serves
on `http://localhost:3000`.

- Admin: <http://localhost:3000/admin> → sign in with your `ADMIN_TOKEN`.
- Demo cards: `/c/john-smith`, `/c/james-chen`, `/c/max-mcgonagall`.

## Local dev (without Docker)

```bash
npm install
# point DATABASE_URL at a local Postgres in .env
npx prisma db push       # create tables
npm run seed             # optional demo data
npm run dev              # http://localhost:3000
```

`npm run build` compiles to `dist/`; `npm start` runs the compiled server.
`npm run typecheck` type-checks without emitting.

## Managing brands, stores, and cards

In `/admin`:

1. **New brand** — set the brand logo, primary color, and default layout
   (`classic`, `banner`, or `minimal`).
2. **+ Store** under a brand — optionally override the logo, color, and layout
   for that location, and set its address. Give it a **store code** (e.g.
   `MW-DT`) — that's what Azure AD maps against.
3. **+ New card** in a store — fill in the person's details. Multi-value fields
   (phones/emails/websites) are one per line as `Label | value`; socials as
   `type | url`. Leave design fields blank to inherit from the store/brand.

A card's final look resolves most-specific-first:
`card override → store → template → brand`.

## Azure AD / Entra auto-provisioning (SCIM)

So cards are created automatically when an employee is added to the directory.

1. In Entra admin center: **Enterprise applications → New application → Create
   your own → non-gallery app**.
2. Open the app → **Provisioning → Automatic**.
3. **Tenant URL:** `https://cards.yourco.com/scim/v2`
   **Secret Token:** the `SCIM_TOKEN` from your `.env`.
4. **Test Connection**, then save. Under **Mappings**, keep the default user
   attribute mappings (userName, name, emails, title, department, active).
5. To route users to the right store, map a directory attribute to the SCIM
   `costCenter` or `organization` field and set it to the store code (e.g.
   `MW-DT`). OpenCard matches that against `Location.code`. If there's no match
   it falls back to brand name, then to the first store, and an admin can
   re-assign in one click.
6. **Assign users/groups** to the app and turn provisioning **On**.

When a user is assigned, Entra POSTs to `/scim/v2/Users` and OpenCard creates the
User + Card. Deactivating/unassigning a user sets the card inactive (the public
page returns 404).

Endpoints implemented: `GET/POST /Users`, `GET/PUT/PATCH/DELETE /Users/:id`,
`GET /ServiceProviderConfig`. Bearer-auth with `SCIM_TOKEN`.

### On-prem Active Directory

For on-prem AD, either (a) sync AD → Entra ID and use the SCIM path above
(recommended for hybrid), or (b) run a scheduled LDAP→OpenCard sync job
(roadmap, v1.1) that upserts users via the same logic. The provisioning code
path in `src/routes/scim.ts` is reused for both.

## Admin SSO (production)

The default admin login is a shared `ADMIN_TOKEN` (fine for first-run / offline /
air-gapped). For production, put the `/admin` routes behind Azure AD OIDC:
set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and front the app
with your identity-aware proxy, or extend `src/middleware/auth.ts` with an OIDC
flow (`openid-client`). The token path remains as a break-glass fallback.

## Optional SAML sign-in

SAML is disabled by default. A super admin can turn it on at
`/admin/integrations` after entering the IdP SSO URL, optional IdP issuer, and
IdP signing certificate. The page shows the service provider Entity ID and
Assertion Consumer Service URL to paste into the IdP. When enabled, `/me/login`
offers SAML sign-in and maps the returned email address to either an admin
account or the employee's card owner email.

## REST API

Base URL `<BASE_URL>/api/v1`. Authenticate with `Authorization: Bearer <key>`.
Create/revoke keys in **Admin → Integrations** (the raw key is shown once). The
admin token also works as a bearer for convenience.

```
GET    /api/v1/brands            GET /api/v1/brands/:id      POST /api/v1/brands
GET    /api/v1/stores?brandId=   GET /api/v1/stores/:id      POST /api/v1/stores
GET    /api/v1/cards?locationId=&brandId=&ownerEmail=
GET    /api/v1/cards/:id
POST   /api/v1/cards             PATCH /api/v1/cards/:id      DELETE /api/v1/cards/:id
GET    /api/v1/leads?cardId=&since=
GET    /api/v1/analytics?cardId=
```

Card create/update accept JSON with `phones`/`emails`/`websites`/`socials` as
arrays of objects (e.g. `[{"label":"Work","value":"+1 555 123 4567"}]`). Example:

```bash
curl -X POST <BASE_URL>/api/v1/cards \
  -H "Authorization: Bearer oc_live_..." -H "Content-Type: application/json" \
  -d '{"locationId":"...","firstName":"Jane","lastName":"Doe","title":"VP Sales",
       "emails":[{"label":"Work","value":"jane@yourco.com"}],"ownerEmail":"jane@yourco.com"}'
```

## Webhooks

Subscribe URLs to events in **Admin → Integrations**. On each event we POST JSON:

```json
{ "event": "lead.captured", "createdAt": "2026-…Z", "data": { … } }
```

Events: `lead.captured`, `card.created`, `card.updated`, `card.deleted`.
Headers include `X-OpenCard-Event` and `X-OpenCard-Signature: sha256=<hmac>` —
verify by computing `HMAC-SHA256(rawBody, endpointSecret)` and comparing. Failed
deliveries retry up to 3 times; recent delivery status is shown in the admin UI.

## Project layout

```
prisma/schema.prisma   data model (Org→Brand→Location→Card, events, leads)
prisma/seed.ts         demo brands/stores/cards
src/server.ts          express bootstrap
src/routes/cards.ts    public card page, vCard, QR, event + lead capture
src/routes/admin.ts    admin CRUD for brands/stores/cards, analytics, leads
src/routes/scim.ts     SCIM 2.0 provisioning for Entra/Azure AD
src/views/             server-rendered HTML (card.ts, admin.ts, html.ts)
src/vcard.ts           vCard 3.0 generation
src/qr.ts              QR code generation
src/public/styles.css  self-hosted styles (no CDN)
docker-compose.yml     app + postgres
```

## Security checklist before going live

- Set strong random `ADMIN_TOKEN` and `SCIM_TOKEN`.
- Terminate TLS in front of the app (reverse proxy) and set `BASE_URL` to https.
- Put `/admin` behind SSO/IdP (see above).
- Back up the Postgres volume (`db_data`).

## Roadmap

The current roadmap is tracked in **[docs/ROADMAP.md](./docs/ROADMAP.md)**.
