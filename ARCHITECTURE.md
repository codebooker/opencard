# OpenCard — Self-Hosted Digital Business Cards

A self-hosted, in-house digital business card platform.
Runs entirely in Docker on your own infrastructure. No per-seat SaaS fees.

## Why we're building this

Per-seat SaaS card tools charge per active card/seat. Everything we need — hosted
card pages, "Add to Contacts" (vCard), QR codes, an admin to manage the team, basic
analytics, lead capture, and auto-provisioning of cards from Azure AD — is
reproducible with a small, standard web stack we control.

## Feature set

| Capability                              | OpenCard v1                                            |
|-----------------------------------------|-------------------------------------------------------|
| Hosted mobile card page                 | `GET /c/:slug` — server-rendered, themeable           |
| Add to Contacts                         | `GET /c/:slug/vcard` — RFC-6350 vCard 3.0 download    |
| QR code per card                        | `GET /c/:slug/qr.png` — PNG, also shown in admin       |
| Card data model (name, title, phones…)  | Postgres via Prisma (see Data model)                  |
| Templates / central branding            | `Template` + `Org` records, applied to cards          |
| Admin / team management                 | `/admin` CRUD, bulk CSV import                          |
| Analytics (views, clicks, scans)        | `AnalyticsEvent` table + `/admin/analytics`           |
| Two-way contact sharing (lead capture)  | `/c/:slug/connect` form → `Lead` table                |
| Auto-provision from Azure AD            | **SCIM 2.0** endpoint (`/scim/v2/Users`)              |
| Auto-provision from on-prem AD          | LDAP sync job (documented; v1.1)                       |
| Apple/Google Wallet pass                | v2 (roadmap)                                            |

## Stack

- **Runtime:** Node.js 22 + TypeScript
- **Web:** Express (server-rendered HTML — fast card pages, no client framework needed)
- **DB:** PostgreSQL 16 via Prisma ORM
- **QR:** `qrcode` npm package
- **vCard:** generated directly (vCard 3.0)
- **Styling:** a single self-hosted CSS file (no CDN dependency — works fully offline/air-gapped)
- **Deploy:** `docker-compose` (app + postgres). One command to stand up.

Rationale: an internal tool maintained by an IT team benefits from a small,
boring, dependency-light stack over a heavy SPA framework. Card pages are
public and SEO/share-preview friendly when server-rendered, and the whole thing
fits in two containers.

## Multi-brand / multi-location (multi-store)

The company runs **multiple brands**, and each brand has **multiple locations
(stores)**. Each brand has its own design and logo, and each location can
override the logo and design again. So the hierarchy is:

For SaaS, those model names stay intentionally generic. A vertical can change
the vocabulary shown to admins without changing the database shape. The first
target vertical is car dealerships, where a `Location` is presented as a
**rooftop** and the same model can later fit franchises, brokerages, agencies,
and other multi-location teams.

```
Org (your company / the deployment)
 └─ Brand            ← own logo, colors, fonts, default layout
     └─ Location     ← "store"; can override logo + colors + layout, has its own address
         └─ Card     ← employee card; can override its own theme
```

**Design inheritance (resolved per card, most specific wins):**

```
logo    = card.logoUrl   ?? location.logoUrl      ?? brand.logoUrl
color   = card.primaryColor ?? location.primaryColor ?? template.primaryColor ?? brand.primaryColor
layout  = card.layout    ?? location.layout       ?? template.layout       ?? brand.layout
address = card.address   ?? location.address
```

This means: change a brand's logo once and every card under it updates; give one
store a different logo and only that store's cards change; a single rep can still
override their own card. Templates are scoped to a Brand so each brand gets its
own set of designs.

## Data model

- **Org** — the top-level tenant (your company / this deployment).
- **Brand** — a brand under the org. Owns default design: logo, primary/text/bg
  colors, font, default layout. Has many Locations and Templates.
- **Location** — a store/site under a brand. Optional overrides for logo, primary
  color, and layout, plus its own address. Has many Users/Cards. A `code` field
  (e.g. store number) is used to map directory users to the right store.
- **Template** — a reusable design preset, scoped to a Brand (`layout`, colors,
  font). Cards may point at a template or just inherit from location/brand.
- **User** — an employee (synced from AD/Azure AD or created by admin), attached
  to a Location. Holds identity (email, AD object id) and links to one Card.
- **Card** — prefix, full name, pronouns, title, department, company, bio, photo,
  plus JSON arrays of phones, emails, websites, social links, and an address.
  Belongs to a Location. Unique `slug` for the public URL; optional theme/logo
  overrides; `active` flag.
- **AnalyticsEvent** — `cardId`, `type` (`view` | `click` | `vcard` | `qr` | `connect`),
  `meta`, `ip`, `userAgent`, `createdAt`. Aggregatable per location/brand via the card.
- **Lead** — captured contact from two-way sharing: name, email, phone, company,
  note, the `cardId` it came from, `createdAt`.

See `prisma/schema.prisma` for the authoritative definition.

## Auto-provisioning from Azure AD (the key requirement)

Cards are created automatically when an employee is added to the directory.

**Primary path — SCIM 2.0 (Azure AD / Entra ID):**
Entra ID has native "automatic user provisioning" that pushes users to any SCIM
2.0 endpoint. OpenCard exposes `/scim/v2/Users` (and `/Groups`). In Entra you
create an Enterprise Application → Provisioning → set the Tenant URL to
`https://cards.yourco.com/scim/v2` and a secret token. When a user is assigned
to the app, Entra POSTs a SCIM `User`; OpenCard creates the `User` + a `Card`
pre-filled from the directory attributes (displayName, jobTitle, department,
mail, mobilePhone). Deactivation in Entra (`active:false`) deactivates the card.
This is the standard SCIM 2.0 provisioning flow.

**Mapping users to the right brand/store:** the SCIM user's
`organization` (company name) maps to a **Brand** and its
`addresses[].locality` / a custom store-code attribute maps to a **Location**
(matched on `Location.code` or name). If no match is found the user lands in a
configurable default location, and an admin can re-assign in one click. So a new
hire at "North Store" of "Acme Coffee" automatically gets a card with Acme
Coffee's branding and the North Store logo.

**On-prem Active Directory (v1.1):**
A scheduled LDAP sync job binds to AD, queries `(&(objectClass=user)...)`, and
upserts Users/Cards. For hybrid environments, prefer syncing AD → Entra and
using the SCIM path above. Documented in README.

**Admin SSO:** admins log into `/admin` via Azure AD OIDC (documented in README);
a static admin token is provided for first-run/offline.

## Security notes

- SCIM endpoint authenticated by bearer token (`SCIM_TOKEN`).
- Admin area behind auth (OIDC or admin token).
- Public card pages are intentionally public (that's the point) but contain only
  what the employee/admin chose to publish.
- All secrets via env (`.env`), never committed.

## Roadmap beyond v1

1. Apple Wallet / Google Wallet passes.
2. LDAP on-prem sync job (packaged as a cron container).
3. CRM export (HubSpot/Salesforce) of captured leads.
4. Per-employee self-serve editing (OIDC login → edit own card only).
5. Custom domains per card and richer template designer.
