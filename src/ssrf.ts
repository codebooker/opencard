// Outbound-URL safety for tenant-configured endpoints (webhooks, CRM/Zapier,
// chat hooks). Tenant admins supply these URLs and the server later fetches
// them, so without validation a tenant could point us at internal services,
// localhost, or a cloud metadata endpoint (SSRF).
//
// Two layers:
//  - validateOutboundUrl(): synchronous, at config time — require https, reject
//    obviously-internal hostnames and literal private/loopback/link-local IPs.
//  - assertPublicUrl(): async, resolves DNS at fetch time and rejects if the
//    hostname maps to a private/loopback/link-local/metadata address (defeats
//    DNS-rebinding and hostnames that resolve internally).

import dns from "dns/promises";
import net from "net";
import https from "https";

export interface UrlCheck {
  ok: boolean;
  error?: string;
  url?: URL;
  addresses?: { address: string; family: number }[];
}

export class OutboundRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundRequestError";
  }
}

export type SafeFetchOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  maxResponseBytes?: number;
};

export type SafeFetchResponse = {
  status: number;
  ok: boolean;
  headers: Headers;
  text(): Promise<string>;
  bytes(): Promise<Buffer>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

// IPv4/IPv6 ranges that must never be reachable from a tenant-configured URL.
function isPrivateOrLocalAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map(Number);
    if (p[0] === 10) return true; // 10/8
    if (p[0] === 127) return true; // loopback
    if (p[0] === 0) return true; // "this" network
    if (p[0] === 169 && p[1] === 254) return true; // link-local incl. 169.254.169.254 metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // 172.16/12
    if (p[0] === 192 && p[1] === 168) return true; // 192.168/16
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT 100.64/10
    if (p[0] >= 224) return true; // multicast / reserved
    return false;
  }
  if (v === 6) {
    const a = ip.toLowerCase();
    if (a === "::1" || a === "::") return true; // loopback / unspecified
    if (a.startsWith("fe80")) return true; // link-local
    if (a.startsWith("fc") || a.startsWith("fd")) return true; // unique local
    if (a.startsWith("ff")) return true; // multicast
    // IPv4-mapped (::ffff:a.b.c.d) — check the embedded v4.
    const m = a.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateOrLocalAddress(m[1]);
    return false;
  }
  return false;
}

const BLOCKED_HOST_LITERALS = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "metadata", "metadata.google.internal"]);

// Config-time check (no DNS). Rejects non-https, blank, over-long, credentialed,
// and obviously-internal targets. Returns a parsed URL when ok.
export function validateOutboundUrl(raw: string | null | undefined): UrlCheck {
  const s = (raw || "").trim();
  if (!s) return { ok: false, error: "A URL is required." };
  if (s.length > 2000) return { ok: false, error: "URL is too long." };
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return { ok: false, error: "Enter a valid URL." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "The URL must start with https://." };
  if (url.username || url.password) return { ok: false, error: "URLs with embedded credentials aren't allowed." };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOST_LITERALS.has(host)) return { ok: false, error: "That host isn't allowed." };
  // Literal IP in the hostname: block private/local directly.
  if (net.isIP(host) && isPrivateOrLocalAddress(host)) {
    return { ok: false, error: "Private or local network addresses aren't allowed." };
  }
  // Bracketed IPv6 literal.
  if (host.startsWith("[") && host.endsWith("]")) {
    const inner = host.slice(1, -1);
    if (isPrivateOrLocalAddress(inner)) return { ok: false, error: "Private or local network addresses aren't allowed." };
  }
  return { ok: true, url };
}

// Fetch-time check: resolve the hostname and reject if ANY resolved address is
// private/local. Call right before fetching a tenant-configured URL.
export async function assertPublicUrl(raw: string): Promise<UrlCheck> {
  const base = validateOutboundUrl(raw);
  if (!base.ok || !base.url) return base;
  const host = base.url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    return isPrivateOrLocalAddress(host)
      ? { ok: false, error: "Blocked internal address." }
      : { ...base, addresses: [{ address: host, family: net.isIP(host) }] };
  }
  try {
    const results = await dns.lookup(host, { all: true });
    if (!results.length) return { ok: false, error: "Host did not resolve." };
    if (results.some((r) => isPrivateOrLocalAddress(r.address))) {
      return { ok: false, error: "Host resolves to a private or local address." };
    }
    return { ...base, addresses: results };
  } catch {
    return { ok: false, error: "Host did not resolve." };
  }
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

// Fetch a tenant-configured HTTPS URL without giving the network stack a chance
// to resolve a different address after validation. Redirects are rejected rather
// than followed: a public host redirecting to metadata/localhost is a common SSRF
// bypass, and webhook endpoints have no need for browser-style navigation.
export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResponse> {
  const checked = await assertPublicUrl(raw);
  if (!checked.ok || !checked.url || !checked.addresses?.length) {
    throw new OutboundRequestError(checked.error || "Outbound URL is not allowed.");
  }
  const target = checked.url;
  const chosen = checked.addresses[0];
  const maxBytes = Math.max(0, Math.min(opts.maxResponseBytes ?? 1_000_000, 8 * 1024 * 1024));

  return new Promise<SafeFetchResponse>((resolve, reject) => {
    const request = https.request(
      target,
      {
        method: opts.method || "GET",
        headers: opts.headers,
        signal: opts.signal,
        // Keep the original hostname for Host/SNI certificate verification while
        // connecting only to the exact public IP returned by our checked lookup.
        lookup: ((_hostname: string, _options: unknown, callback: Function) => {
          callback(null, chosen.address, chosen.family);
        }) as any,
      },
      (response) => {
        const status = response.statusCode || 0;
        if (REDIRECTS.has(status)) {
          response.resume();
          reject(new OutboundRequestError("Outbound redirects are not allowed."));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buf.length;
          if (total > maxBytes) {
            response.destroy(new OutboundRequestError("Outbound response exceeded the size limit."));
            return;
          }
          chunks.push(buf);
        });
        response.on("error", reject);
        response.on("end", () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) value.forEach((v) => headers.append(name, v));
            else if (value !== undefined) headers.set(name, String(value));
          }
          const body = Buffer.concat(chunks);
          resolve({
            status,
            ok: status >= 200 && status < 300,
            headers,
            text: async () => body.toString("utf8"),
            bytes: async () => Buffer.from(body),
            arrayBuffer: async () => {
              const copy = Buffer.from(body);
              return copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength) as ArrayBuffer;
            },
          });
        });
      }
    );
    request.on("error", reject);
    if (opts.body !== undefined) request.write(opts.body);
    request.end();
  });
}
