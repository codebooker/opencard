import { test } from "node:test";
import assert from "node:assert/strict";
import { rateLimit, csrfGuard } from "./middleware/hardening";
import { config } from "./config";

function fakeRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    send(b: unknown) {
      this.body = b;
      return this;
    },
  };
}
function fakeReq(over: any = {}) {
  return { method: "POST", originalUrl: "/x", headers: {}, ip: "1.2.3.4", socket: { remoteAddress: "1.2.3.4" }, ...over };
}

test("rateLimit allows up to max, then 429s", () => {
  const mw = rateLimit({ name: "t", windowMs: 60_000, max: 2 });
  let nextCount = 0;
  const next = () => {
    nextCount++;
  };
  const r1 = fakeRes();
  mw(fakeReq() as any, r1 as any, next);
  const r2 = fakeRes();
  mw(fakeReq() as any, r2 as any, next);
  const r3 = fakeRes();
  mw(fakeReq() as any, r3 as any, next);
  assert.equal(nextCount, 2);
  assert.equal(r3.statusCode, 429);
  assert.ok(r3.headers["Retry-After"]);
});

test("rateLimit key ignores spoofed X-Forwarded-For", () => {
  const mw = rateLimit({ name: "spoof", windowMs: 60_000, max: 2 });
  let nextCount = 0;
  const next = () => {
    nextCount++;
  };
  // Same req.ip, rotating XFF each request — must share one bucket and 429.
  for (let i = 0; i < 3; i++) {
    var res = fakeRes();
    mw(fakeReq({ headers: { "x-forwarded-for": `10.0.0.${i}` } }) as any, res as any, next);
  }
  assert.equal(nextCount, 2);
  assert.equal(res!.statusCode, 429);
});

test("rateLimit only counts configured methods", () => {
  const mw = rateLimit({ name: "post-only", windowMs: 60_000, max: 1, methods: ["POST"] });
  let nextCount = 0;
  const next = () => {
    nextCount++;
  };
  mw(fakeReq({ method: "GET" }) as any, fakeRes() as any, next);
  mw(fakeReq({ method: "GET" }) as any, fakeRes() as any, next);
  assert.equal(nextCount, 2); // GETs are never limited
});

test("csrfGuard allows safe methods and same-origin POSTs", () => {
  let passed = 0;
  const next = () => {
    passed++;
  };
  csrfGuard(fakeReq({ method: "GET", originalUrl: "/admin/brands" }) as any, fakeRes() as any, next);
  csrfGuard(
    fakeReq({ originalUrl: "/admin/brands", headers: { origin: config.baseUrl } }) as any,
    fakeRes() as any,
    next
  );
  assert.equal(passed, 2);
});

test("csrfGuard blocks cross-origin POSTs to guarded surfaces", () => {
  const res = fakeRes();
  let passed = false;
  csrfGuard(
    fakeReq({ originalUrl: "/admin/brands", headers: { origin: "https://evil.example" } }) as any,
    res as any,
    () => {
      passed = true;
    }
  );
  assert.equal(passed, false);
  assert.equal(res.statusCode, 403);
});

test("csrfGuard exempts SAML ACS and ignores non-guarded paths", () => {
  let passed = 0;
  const next = () => {
    passed++;
  };
  // SAML assertion comes cross-origin from the IdP — must be allowed
  csrfGuard(
    fakeReq({ originalUrl: "/me/saml/acs", headers: { origin: "https://idp.example" } }) as any,
    fakeRes() as any,
    next
  );
  // public card POST is not a cookie-authed surface — not guarded here
  csrfGuard(
    fakeReq({ originalUrl: "/c/john/connect", headers: { origin: "https://elsewhere.example" } }) as any,
    fakeRes() as any,
    next
  );
  assert.equal(passed, 2);
});
