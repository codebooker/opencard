# OpenCard Webhooks

Webhooks push events to your systems in real time — e.g. send every captured
lead straight into your CRM, or mirror card changes into another directory.

---

## Configuring an endpoint

In **Admin → Integrations** (super admin):

1. Under **Webhooks**, enter your **Endpoint URL** (must be `https://…`).
2. Tick the **events** you want.
3. **Add webhook.** A signing **secret** is generated and shown on the row — copy it; you'll need it to verify signatures.

You can add multiple endpoints, each subscribed to a different set of events.
The most recent delivery's status (✓/✗ + HTTP code + time) is shown next to each
endpoint, and failed attempts are logged.

---

## Events

| Event | Fires when |
|-------|-----------|
| `lead.captured` | Someone submits the two-way "share your details" form on a card |
| `card.created` | A card is created (admin, REST API, or Azure AD/SCIM provisioning) |
| `card.updated` | A card is edited (admin, self-service `/me`, or REST API) |
| `card.deleted` | A card is deleted |

---

## Delivery format

Each event is an HTTP `POST` to your URL with a JSON body:

```json
{
  "event": "lead.captured",
  "createdAt": "2026-06-29T05:20:00.000Z",
  "data": { /* event-specific payload, see below */ }
}
```

### Headers

| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` |
| `User-Agent` | `OpenCard-Webhooks/1` |
| `X-OpenCard-Event` | the event name, e.g. `lead.captured` |
| `X-OpenCard-Signature` | `sha256=<hex>` — HMAC-SHA256 of the **raw request body**, keyed with your endpoint secret |

### Responding

Return any **2xx** status to acknowledge. Anything else (or a timeout) is treated
as a failure and retried. Respond quickly and do heavy work asynchronously.

- **Timeout:** 8 seconds per attempt.
- **Retries:** up to 3 attempts. After a failed attempt OpenCard waits ~3s, then ~6s before retrying.
- Each attempt is logged; the latest result appears in the admin UI.

---

## Verifying the signature

Always verify `X-OpenCard-Signature` before trusting a payload. Compute
`HMAC-SHA256(rawBody, endpointSecret)`, hex-encode it, prefix with `sha256=`, and
compare with the header using a constant-time comparison. **Use the raw body
bytes** — parsing and re-serializing JSON will change the bytes and break the check.

### Node.js (Express)

```js
const crypto = require("crypto");
const express = require("express");
const app = express();

// capture the raw body for signature verification
app.use("/hooks/opencard", express.raw({ type: "application/json" }));

app.post("/hooks/opencard", (req, res) => {
  const secret = process.env.OPENCARD_WEBHOOK_SECRET; // the endpoint secret
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(req.body).digest("hex");
  const got = req.header("X-OpenCard-Signature") || "";

  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).send("bad signature");
  }

  const payload = JSON.parse(req.body.toString("utf8"));
  console.log(payload.event, payload.data);
  res.sendStatus(200); // ack fast
});
```

### Python (Flask)

```python
import hmac, hashlib
from flask import Flask, request, abort

app = Flask(__name__)
SECRET = b"<your endpoint secret>"

@app.post("/hooks/opencard")
def hook():
    raw = request.get_data()  # raw bytes
    expected = "sha256=" + hmac.new(SECRET, raw, hashlib.sha256).hexdigest()
    got = request.headers.get("X-OpenCard-Signature", "")
    if not hmac.compare_digest(expected, got):
        abort(401)
    payload = request.get_json()
    print(payload["event"], payload["data"])
    return "", 200
```

---

## Payloads

### `lead.captured`

```json
{
  "event": "lead.captured",
  "createdAt": "2026-06-29T05:20:00.000Z",
  "data": {
    "id": "cmqx...",
    "name": "Pat Buyer",
    "email": "pat@example.com",
    "phone": "+1 555 222 3333",
    "company": "Buyer LLC",
    "note": "Interested in downtown listings",
    "createdAt": "2026-06-29T05:20:00.000Z",
    "card": { "id": "cmqx...", "slug": "john-smith", "fullName": "John Smith" }
  }
}
```

### `card.created` / `card.updated`

`data` is the full card object (same shape as the REST API card):

```json
{
  "event": "card.updated",
  "createdAt": "2026-06-29T05:25:00.000Z",
  "data": {
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
    "phones": [{ "label": "Work", "value": "+1 555 123 4567" }],
    "emails": [{ "label": "Work", "value": "john.smith@maplewoodrealestate.ca" }],
    "websites": [{ "label": "Company", "value": "https://maplewoodrealestate.ca" }],
    "socials": [{ "type": "linkedin", "value": "https://linkedin.com/in/johnsmith" }],
    "updatedAt": "2026-06-29T05:25:00.000Z"
  }
}
```

### `card.deleted`

```json
{
  "event": "card.deleted",
  "createdAt": "2026-06-29T05:30:00.000Z",
  "data": { "id": "cmqx...", "slug": "john-smith" }
}
```

---

## Best practices

- **Verify every signature** (above) and reject mismatches.
- **Be idempotent.** Retries mean you may receive the same event more than once;
  de-duplicate on `data.id` + `event`, or store processed delivery ids.
- **Ack within ~8s**, then process asynchronously (queue the payload).
- **Don't trust order.** Events may arrive out of order under retries; treat
  `card.updated` payloads as the current snapshot rather than a diff.
- **Use HTTPS** and keep the secret out of source control.

---

## Testing

Point an endpoint at a request inspector (e.g. a webhook-testing service or your
own logging endpoint), subscribe to `lead.captured`, then submit the "share your
details" form on any public card (`/c/<slug>`). The delivery — and its success
status — appears under **Admin → Integrations**.
