# OpenCard REST API

Version: **v1**
Base URL: `<BASE_URL>/api/v1` (e.g. `https://cards.yourco.com/api/v1`)
Content type: `application/json`

The API lets other systems (CRMs, HRIS, automation tools, internal apps) read and
manage brands, stores, cards, leads, and analytics.

---

## Authentication

Every request must send a bearer token:

```
Authorization: Bearer <token>
```

Authenticate with a revocable API key:

| Token | How to get it | Use |
|-------|---------------|-----|
| **API key** (`oc_live_…`) | Admin → **Integrations** → *Create API key* (super admin). Shown once; only a hash is stored, scoped to that key's org + granted scopes. | The only accepted API credential. Revocable. |

There is no static admin/master token. Requests without a valid API key
receive `401`.

```bash
curl https://cards.yourco.com/api/v1/brands \
  -H "Authorization: Bearer oc_live_xxxxxxxxxxxxxxxxxxxxxxxx"
```

> Manage keys under **Admin → Integrations**. Revoking a key takes effect immediately.

---

## Conventions

- **Responses** are JSON. Successful reads/writes return `{ "data": ... }`.
- **Timestamps** are ISO-8601 UTC strings.
- **Multi-value fields** (`phones`, `emails`, `websites`) are arrays of
  `{ "label": "...", "value": "..." }`. `socials` is an array of
  `{ "type": "...", "value": "..." }`. `address` is an object (see below).
- **Limits:** list endpoints currently return up to **500** records (no pagination yet).
- **Rate limiting:** none enforced by the app today; put it behind your gateway if needed.

### Error format

| Status | `error` value | Meaning |
|--------|---------------|---------|
| `401` | `missing_bearer_token` | No `Authorization: Bearer` header |
| `401` | `invalid_api_key` | Unknown or revoked key |
| `404` | `not_found` | Resource does not exist |
| `422` | e.g. `locationId_firstName_lastName_required` | Missing/invalid input |
| `500` | `no_org` | Deployment not seeded |

```json
{ "error": "not_found" }
```

---

## Endpoints

```
GET    /api/v1                          API info
GET    /api/v1/brands                   List brands
GET    /api/v1/brands/:id               Get a brand
POST   /api/v1/brands                   Create a brand
GET    /api/v1/stores?brandId=          List stores (optionally by brand)
GET    /api/v1/stores/:id               Get a store
POST   /api/v1/stores                   Create a store
GET    /api/v1/cards?locationId=&brandId=&ownerEmail=   List cards (filterable)
GET    /api/v1/cards/:id                Get a card
POST   /api/v1/cards                    Create a card
PATCH  /api/v1/cards/:id                Update a card (partial)
DELETE /api/v1/cards/:id                Delete a card
GET    /api/v1/leads?cardId=&since=     List captured leads
GET    /api/v1/analytics?cardId=        Aggregate analytics
```

---

## Brands

A brand owns a default design (logo, colors, layout) and a self-service policy.

### Object

```json
{
  "id": "cmqx...",
  "name": "Maplewood Real Estate",
  "logoUrl": "https://.../logo.png",
  "primaryColor": "#1f6f43",
  "layout": "wave",
  "selfEditFields": ["photo", "bio", "phones", "emails", "socials"],
  "createdAt": "2026-06-29T05:02:37.250Z"
}
```

### List / Get

```bash
curl .../api/v1/brands         -H "Authorization: Bearer $TOKEN"
curl .../api/v1/brands/cmqx... -H "Authorization: Bearer $TOKEN"
```

### Create

`POST /api/v1/brands`

| Field | Required | Notes |
|-------|----------|-------|
| `name` | yes | |
| `logoUrl` | no | |
| `primaryColor` | no | hex; default `#1f6f43` |
| `layout` | no | `classic` \| `banner` \| `minimal` \| `wave`; default `classic` |

```bash
curl -X POST .../api/v1/brands \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Acme Co.","primaryColor":"#2563eb","layout":"wave"}'
```

---

## Stores

A store (location) belongs to a brand and can override the logo, color, and layout,
and carries a default address. The `code` field is what Azure AD provisioning maps
users against.

### Object

```json
{
  "id": "cmqx...",
  "brandId": "cmqx...",
  "name": "Downtown Office",
  "code": "MW-DT",
  "logoUrl": null,
  "primaryColor": null,
  "layout": null,
  "address": { "line1": "100 King St", "city": "Toronto", "region": "ON", "postal": "M5H 1A1", "country": "Canada" },
  "createdAt": "2026-06-29T05:02:37.250Z"
}
```

### List / Get / Create

```bash
curl ".../api/v1/stores?brandId=cmqx..." -H "Authorization: Bearer $TOKEN"

curl -X POST .../api/v1/stores \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"brandId":"cmqx...","name":"North Branch","code":"MW-N",
       "address":{"city":"Toronto","region":"ON","country":"Canada"}}'
```

`brandId` and `name` are required.

---

## Cards

The core resource — one per person.

### Object

```json
{
  "id": "cmqx...",
  "slug": "john-smith",
  "url": "https://cards.yourco.com/c/john-smith",
  "prefix": "Mr.",
  "firstName": "John",
  "lastName": "Smith",
  "fullName": "Mr. John Smith",
  "title": "President",
  "department": null,
  "company": "Maplewood Real Estate",
  "ownerEmail": "john.smith@maplewoodrealestate.ca",
  "locationId": "cmqx...",
  "active": true,
  "showQr": null,
  "phones": [{ "label": "Work", "value": "+1 555 123 4567" }],
  "emails": [{ "label": "Work", "value": "john.smith@maplewoodrealestate.ca" }],
  "websites": [{ "label": "Company", "value": "https://maplewoodrealestate.ca" }],
  "socials": [{ "type": "linkedin", "value": "https://linkedin.com/in/johnsmith" }],
  "updatedAt": "2026-06-29T05:10:00.000Z"
}
```

### List

`GET /api/v1/cards` — optional filters (combine freely):

| Query param | Filters by |
|-------------|-----------|
| `locationId` | Cards in one store |
| `brandId` | Cards across a brand's stores |
| `ownerEmail` | The card owned by an email (case-insensitive) |

```bash
curl ".../api/v1/cards?brandId=cmqx..." -H "Authorization: Bearer $TOKEN"
```

### Get

```bash
curl .../api/v1/cards/cmqx... -H "Authorization: Bearer $TOKEN"
```

### Create

`POST /api/v1/cards` — required: `locationId`, `firstName`, `lastName`.

Writable fields: `prefix`, `firstName`, `lastName`, `pronouns`, `title`,
`department`, `company`, `bio`, `photoUrl`, `ownerEmail`, `templateId`,
`layout`, `primaryColor`, `logoUrl`, `active`, `showQr` (bool; `null` = inherit
brand's QR setting), and the JSON fields
`phones`, `emails`, `websites`, `socials`, `address`.

```bash
curl -X POST .../api/v1/cards \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "locationId": "cmqx...",
    "firstName": "Jane", "lastName": "Doe",
    "title": "VP Sales", "company": "Acme Co.",
    "ownerEmail": "jane@acme.com",
    "emails": [{"label":"Work","value":"jane@acme.com"}],
    "phones": [{"label":"Mobile","value":"+1 555 987 6543"}],
    "socials": [{"type":"linkedin","value":"https://linkedin.com/in/janedoe"}]
  }'
```

A unique `slug` is generated from the name. Returns `201` with the card object.
Fires the `card.created` webhook.

### Update

`PATCH /api/v1/cards/:id` — send only the fields you want to change. The JSON
array fields replace the whole array when provided. Set `address` to `null` to clear it.

```bash
curl -X PATCH .../api/v1/cards/cmqx... \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"SVP Sales","active":true}'
```

Fires `card.updated`.

### Delete

```bash
curl -X DELETE .../api/v1/cards/cmqx... -H "Authorization: Bearer $TOKEN"
```

Returns `{ "data": { "id": "...", "deleted": true } }`. Fires `card.deleted`.

---

## Leads

Contacts captured via a card's two-way "share your details" form.

`GET /api/v1/leads`

| Query param | Filters by |
|-------------|-----------|
| `cardId` | Leads from one card |
| `since` | ISO date/datetime; leads created on/after it |

```bash
curl ".../api/v1/leads?since=2026-06-01" -H "Authorization: Bearer $TOKEN"
```

```json
{
  "data": [
    {
      "id": "cmqx...",
      "name": "Pat Buyer",
      "email": "pat@example.com",
      "phone": "+1 555 222 3333",
      "company": "Buyer LLC",
      "note": "Interested in downtown listings",
      "createdAt": "2026-06-29T05:20:00.000Z",
      "card": { "id": "cmqx...", "slug": "john-smith", "firstName": "John", "lastName": "Smith" }
    }
  ]
}
```

> For real-time lead delivery into a CRM, prefer the **`lead.captured` webhook**
> (see WEBHOOKS.md) over polling this endpoint.

---

## Analytics

`GET /api/v1/analytics` — event totals. Add `?cardId=` for a single card.

```bash
curl ".../api/v1/analytics?cardId=cmqx..." -H "Authorization: Bearer $TOKEN"
```

```json
{ "data": { "totals": { "view": 128, "vcard": 34, "click": 51, "connect": 6 } } }
```

Event types: `view` (card opened), `vcard` (Add-to-Contacts), `click` (a link
tapped), `qr` (QR image fetched), `connect` (lead form submitted).

---

## Field reference

**Labeled value** (phones, emails, websites)
```json
{ "label": "Work", "value": "+1 555 123 4567" }
```

**Social link** — `type` is one of `linkedin`, `twitter`, `instagram`,
`facebook`, `youtube`, `tiktok`, `github`, `whatsapp`, `website`, `other`.
```json
{ "type": "linkedin", "value": "https://linkedin.com/in/jane" }
```

**Address**
```json
{ "line1": "100 King St", "line2": "Suite 5", "city": "Toronto", "region": "ON", "postal": "M5H 1A1", "country": "Canada" }
```

---

## Changelog

- **v1** — brands, stores, cards (CRUD), leads, analytics; API-key + admin-token auth.
