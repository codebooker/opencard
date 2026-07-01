import crypto from "crypto";

// Pure webhook helpers — no db/config, so they're unit-testable in isolation.

// HMAC-SHA256 signature over the raw request body, prefixed like GitHub/Stripe.
export function signBody(secret: string, body: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

// The stable delivery envelope consumers receive.
export function buildEnvelope(event: string, data: unknown, at: Date = new Date()): string {
  return JSON.stringify({ event, createdAt: at.toISOString(), data });
}

export function deliveryHeaders(event: string, signature: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "User-Agent": "OpenCard-Webhooks/1",
    "X-OpenCard-Event": event,
    "X-OpenCard-Signature": signature,
  };
}

// Cap stored request/response bodies so a chatty endpoint can't bloat the DB.
export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…[truncated]" : s;
}

// Keep a small, safe subset of response headers for inspection (drops set-cookie
// and anything sensitive/large).
export function pickHeaders(entries: Iterable<[string, string]>): Record<string, string> {
  const keep = new Set([
    "content-type",
    "content-length",
    "server",
    "date",
    "x-request-id",
    "cf-ray",
    "retry-after",
  ]);
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (keep.has(k.toLowerCase())) out[k.toLowerCase()] = v;
  }
  return out;
}
