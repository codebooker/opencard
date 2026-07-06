# Security Review

## Executive Summary

OpenCard is a TypeScript/Express and Prisma/Postgres application with a reasonably mature security baseline in several areas: strong startup checks for core secrets, hashed API keys and SCIM tokens, DB-backed admin sessions, CSRF origin checks for cookie-authenticated admin/self-service routes, security headers, rate limiting, Stripe webhook signature verification, and a planned least-privilege Postgres RLS role.

The current security posture is **high risk** for production because I found one confirmed cross-tenant data disclosure path in webhook dispatch and several high-priority issues around destructive authorization, auth-token logging, signup behavior, and outbound request SSRF. I did not find committed real credentials or private keys in the repository; the secret scan hits were environment-variable references or sample code.

The application should not be considered production-ready for a multi-tenant SaaS deployment until the P0/P1 items below are fixed and covered by tests.

## Top Risks

1. **P0: Cross-tenant webhook data leak.** `emitEvent()` delivers each event to every active webhook endpoint, regardless of org.
2. **P1: Brand deletion is not tenant-scoped.** An org owner can delete another tenant's brand if they know the brand id and exact name.
3. **P1: Password reset, signup, invite, and verification links can be logged with raw tokens when SMTP is not configured.**
4. **P1: Production compose enables public signup by default, while SMTP-less signup auto-verifies the account email.**
5. **P1: Admin-configured webhooks and CRM endpoints can make server-side requests to arbitrary hosts.**
6. **P2: Integration secrets and webhook replay material are stored and displayed in plaintext.**
7. **P2: SAML disables `InResponseTo` validation and has no replay cache.**
8. **P2: `nodemailer` has high-severity advisories from `npm audit`.**
9. **P2: API card writes accept `templateId` without validating that the template belongs to the card's tenant/brand.**
10. **P2: RLS enforcement is optional in local/default Docker, reducing defense in depth.**

## Findings Summary Table

| ID | Severity | Priority | Category | Finding | File/Area | Confidence |
|---|---|---|---|---|---|---|
| SEC-01 | Critical | P0 | Authorization / Data Protection | Webhook dispatch sends tenant events to every active webhook endpoint | `src/webhooks.ts` | High |
| SEC-02 | High | P1 | Authorization | Brand deletion route lacks tenant scope check | `src/routes/admin.ts` | High |
| SEC-03 | High | P1 | Authentication / Logging | Auth links with raw tokens are logged when SMTP is disabled | `src/notify.ts`, auth routes | High |
| SEC-04 | High | P1 | Authentication / Business Logic | Production signup can create verified accounts without email proof if SMTP is absent | `deploy/docker-compose.prod.yml`, `src/routes/signup.ts` | High |
| SEC-05 | High | P1 | SSRF / Infrastructure | Webhook and CRM URLs are fetched server-side without egress restrictions | Integrations and outbound HTTP | High |
| SEC-06 | Medium | P2 | Secrets / Data Protection | Integration secrets and webhook replay material are stored/displayed in plaintext | Prisma schema, admin views | High |
| SEC-07 | Medium | P2 | Authentication | SAML response replay protections are incomplete | `src/saml.ts`, `src/routes/selfservice.ts` | Medium |
| SEC-08 | Medium | P2 | Dependency | `nodemailer@6.10.1` has high-severity audit findings | `package.json`, `package-lock.json` | High |
| SEC-09 | Medium | P2 | Authorization / API | REST API card writes accept unvalidated `templateId` | `src/routes/api.ts` | Medium |
| SEC-10 | Medium | P2 | Infrastructure | RLS falls back to owner DB client when `APP_DB_PASSWORD` is unset | `src/db.ts`, `docker-compose.yml` | High |
| SEC-11 | Low | P3 | Infrastructure | Runtime container runs as root | `Dockerfile` | High |
| SEC-12 | Low | P3 | Authentication | MFA exists but is optional for admin/platform accounts | Admin auth/security routes | High |

## Immediate Action Plan

### Fix Immediately

- SEC-01: Scope webhook dispatch by org and add regression tests proving tenant A events never reach tenant B endpoints.

### Fix Next

- SEC-02: Use `canManageBrandScoped()` or an org-scoped query for brand deletion.
- SEC-03: Stop logging raw email bodies and auth tokens; fail closed in production when SMTP is not configured.
- SEC-04: Disable production signups by default and require email verification for signup.
- SEC-05: Add strict outbound URL validation and egress controls for webhooks, chat hooks, and CRM endpoints.

### Plan Soon

- SEC-06: Encrypt recoverable integration secrets and reduce webhook delivery retention/visibility.
- SEC-07: Add SAML request-id storage and replay validation.
- SEC-08: Upgrade `nodemailer` and re-run `npm audit`.
- SEC-09: Validate related IDs in API writes.
- SEC-10: Require RLS app-role configuration for all non-test deployments.

### Hardening / Cleanup

- SEC-11: Run the container as a non-root user.
- SEC-12: Enforce MFA for platform and org-owner accounts.

---

## Finding: Cross-tenant webhook events are delivered to every active endpoint

**Severity:** Critical  
**Confidence:** High  
**Category:** Authorization / Data Protection  
**Affected File(s):**

- `src/webhooks.ts:20`
- `src/webhooks.ts:25`
- `src/routes/cards.ts:185`
- `src/routes/assets.ts:87`

**Description:**  
The webhook dispatcher fetches all active webhook endpoints without filtering by `orgId`, then sends the event payload to every endpoint subscribed to that event name. Lead payloads include personal lead data, and card payloads include employee/card data. This is a confirmed cross-tenant data disclosure path when more than one tenant has webhooks enabled.

**Evidence:**  
`emitEvent()` calls `prisma.webhookEndpoint.findMany({ where: { active: true } })` and then delivers matching events to each endpoint. Callers such as public lead capture call `emitEvent("lead.captured", ...)` without an org-scoping argument.

**Attack Scenario:**  
Tenant B creates an active webhook endpoint subscribed to `lead.captured`. When Tenant A captures a lead, OpenCard sends Tenant A's lead payload to Tenant B's endpoint because the dispatcher is not tenant-scoped.

**Business Impact:**  
Customer lead PII and employee/card metadata can be disclosed across tenants. This is a major privacy and contractual breach risk.

**Recommended Fix:**  
Change `emitEvent` to require an `orgId` and query only endpoints in that org. Update all callers to pass the authoritative org id from the created entity/source. Add tests for two tenants with one webhook each.

**Suggested Code Change:**

```ts
export function emitEvent(orgId: string, event: WebhookEvent, data: unknown): void {
  void (async () => {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { orgId, active: true },
    });
    for (const ep of endpoints) {
      const events = Array.isArray(ep.events) ? (ep.events as string[]) : [];
      if (events.includes(event)) void deliver(ep, event, buildEnvelope(event, data), 1, true);
    }
  })();
}
```

**Priority:** P0

---

## Finding: Brand deletion is not tenant-scoped

**Severity:** High  
**Confidence:** High  
**Category:** Authorization  
**Affected File(s):**

- `src/routes/admin.ts:1288`
- `src/routes/admin.ts:1289`
- `src/routes/admin.ts:1290`
- `src/routes/admin.ts:1308`
- `src/rbac.ts:92`

**Description:**  
The destructive brand deletion route only checks `canDeleteBrand(reqAdmin(req))`, which is a coarse role check for `p.super`. It does not verify that the target brand belongs to the current admin's org or accessible scope before deleting the brand and all dependent records.

**Evidence:**  
`canDeleteBrand` returns `p.super`. The route then loads `prisma.brand.findUnique({ where: { id: req.params.id } })` without an `orgId` filter or `canManageBrandScoped()` check and deletes cards, users, templates, locations, and the brand.

**Attack Scenario:**  
A tenant `org_owner` obtains another tenant's brand id and exact brand name through logs, support artifacts, screenshots, or another leak. They submit the delete form endpoint and delete the other tenant's brand tree.

**Business Impact:**  
Cross-tenant destructive access can cause data loss, outage for public card pages, and loss of trust. Backups may restore data, but the incident would still be severe.

**Recommended Fix:**  
Replace the coarse role-only check with a scoped check before loading/deleting. Query the brand with `id` and `orgId` unless `RBAC.seesAllOrgs(p)` is true. Add a regression test where an `org_owner` attempts to delete a brand in another org.

**Suggested Code Change:**

```ts
const p = reqAdmin(req);
if (!(await RBAC.canManageBrandScoped(p, req.params.id))) return forbidden(res);
const brand = await prisma.brand.findFirst({
  where: RBAC.seesAllOrgs(p) ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId },
  include: { locations: true },
});
```

**Priority:** P1

---

## Finding: Raw account lifecycle tokens are logged when SMTP is not configured

**Severity:** High  
**Confidence:** High  
**Category:** Authentication / Logging  
**Affected File(s):**

- `src/notify.ts:29`
- `src/notify.ts:32`
- `src/routes/admin.ts:241`
- `src/routes/admin.ts:246`
- `src/routes/admin.ts:1046`
- `src/routes/admin.ts:1051`
- `src/routes/signup.ts:137`
- `src/routes/signup.ts:142`

**Description:**  
When SMTP is not configured, `sendMail()` logs the full email body. Password reset, email verification, invite, and signup messages include raw single-use tokens in URLs. Anyone with access to container logs can use these links within their validity windows.

**Evidence:**  
`sendMail()` logs `{ to, subject, text }` when no transporter exists. The auth routes interpolate raw tokens into the `text` argument.

**Attack Scenario:**  
A developer, operator, log shipper user, or attacker with read access to logs finds a password reset URL and uses it to reset an admin account. Signup and verification links can also be used to create or activate accounts.

**Business Impact:**  
Admin account takeover and unauthorized workspace creation/activation are possible from log access. Logs are commonly retained and broadly accessible compared with application databases.

**Recommended Fix:**  
Never log full email bodies containing credentials or auth links in production. In production, fail closed if SMTP is required for an account lifecycle flow. For local development, require an explicit `MAIL_LOG_AUTH_LINKS=1` opt-in and clearly label it unsafe.

**Suggested Code Change:**

```ts
if (!t) {
  console.log(JSON.stringify({ msg: "mail", to, subject, delivered: "not_sent_smtp_not_configured" }));
  if (config.isProduction) throw new Error("SMTP is required for this flow in production.");
  return { delivered: "not_sent" };
}
```

**Priority:** P1

---

## Finding: Production signup can auto-verify accounts without email proof

**Severity:** High  
**Confidence:** High  
**Category:** Authentication / Business Logic  
**Affected File(s):**

- `deploy/docker-compose.prod.yml:35`
- `deploy/docker-compose.prod.yml:46`
- `src/config.ts:58`
- `src/routes/signup.ts:208`

**Description:**  
Production compose defaults `SIGNUPS_ENABLED` to `1`, while SMTP settings are optional and default blank. The signup route falls back to a one-form flow when SMTP is not enabled and creates the tenant with `verified: true`.

**Evidence:**  
Production compose sets `SIGNUPS_ENABLED: ${SIGNUPS_ENABLED:-1}` and `SMTP_HOST: ${SMTP_HOST:-}`. The SMTP-less signup route calls `createTenant(..., verified: true)`.

**Attack Scenario:**  
If production is deployed before SMTP is configured, an internet user can create a verified workspace with any email address, including someone else's address or a disposable email.

**Business Impact:**  
Unauthorized signups, account squatting, spam workspaces, brand/domain abuse, and support burden. This also weakens trust in the owner verification gate used by public card and asset surfaces.

**Recommended Fix:**  
Default production signups to off until email is configured and launch controls are explicit. In production, require a verified email link before creating or activating a tenant. If SMTP is missing, show signup disabled rather than auto-verifying.

**Suggested Code Change:**

```yaml
SIGNUPS_ENABLED: ${SIGNUPS_ENABLED:-0}
SMTP_HOST: ${SMTP_HOST:?Set SMTP_HOST when SIGNUPS_ENABLED=1}
```

```ts
if (config.isProduction && !mailEnabled) {
  return res.status(503).send(disabledPage());
}
```

**Priority:** P1

---

## Finding: Outbound webhook and CRM URLs allow server-side request forgery

**Severity:** High  
**Confidence:** High  
**Category:** SSRF / Infrastructure  
**Affected File(s):**

- `src/routes/admin.ts:2616`
- `src/routes/admin.ts:2628`
- `src/routes/admin.ts:2663`
- `src/routes/admin.ts:2666`
- `src/routes/admin.ts:2809`
- `src/webhooks.ts:43`
- `src/crmsync-dispatch.ts:19`
- `src/crmsync-dispatch.ts:38`
- `src/notify.ts:50`

**Description:**  
Tenant admins can configure URLs that the server later fetches. Generic webhooks do not validate scheme or host at creation. CRM/Zapier and Salesforce override URLs are accepted without scheme/host restrictions. Chat webhooks require HTTPS but still do not block private, loopback, link-local, or metadata IP ranges.

**Evidence:**  
The routes store URLs from request bodies and the dispatchers call `fetch(url, ...)`. There is no shared URL validator that resolves DNS and blocks private network targets.

**Attack Scenario:**  
A tenant admin configures a webhook or CRM endpoint pointing at an internal service, localhost, a cloud metadata endpoint, or an internal admin panel. Triggering test delivery or lead capture causes the OpenCard server to connect to that target from its trusted network position.

**Business Impact:**  
Potential internal service probing, metadata exposure, credential theft, or abuse of internal-only endpoints. In a multi-tenant SaaS, tenant-controlled SSRF is a high-risk boundary issue.

**Recommended Fix:**  
Create one outbound URL validation and fetch layer. Require HTTPS for untrusted tenant-configured endpoints unless a provider requires otherwise. Resolve hostnames at request time and block loopback, RFC1918, link-local, multicast, and metadata ranges. Consider provider allowlists for Slack, Teams, HubSpot, Salesforce, Zapier, and Make. Add container/network egress firewall rules as a second layer.

**Suggested Code Change:**

```ts
async function assertSafeOutboundUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("HTTPS is required.");
  const addrs = await dns.lookup(url.hostname, { all: true });
  if (addrs.some((a) => isPrivateOrLocalAddress(a.address))) {
    throw new Error("Private network targets are not allowed.");
  }
  return url;
}
```

**Priority:** P1

---

## Finding: Integration secrets and webhook replay material are stored/displayed in plaintext

**Severity:** Medium  
**Confidence:** High  
**Category:** Secrets / Data Protection  
**Affected File(s):**

- `prisma/schema.prisma:168`
- `prisma/schema.prisma:670`
- `prisma/schema.prisma:690`
- `prisma/schema.prisma:691`
- `src/views/admin.ts:2458`
- `src/views/admin.ts:2777`
- `src/views/admin.ts:2780`
- `src/secretbox.ts:4`

**Description:**  
The schema stores CRM provider tokens and webhook endpoint secrets as plaintext strings. The admin UI displays webhook secrets. Webhook deliveries store request bodies and signatures for inspection and replay. The codebase already has an AES-GCM `secretbox` helper for recoverable secrets, but these integration secrets do not use it.

**Evidence:**  
`DirectoryConfig.clientSecret` is documented as encrypted, while `CrmIntegration.token` and `WebhookEndpoint.secret` are plaintext fields. The integrations view renders `e.secret`, and the delivery inspector renders request signatures and request bodies.

**Attack Scenario:**  
A database dump, admin UI compromise, or over-broad support access exposes third-party CRM tokens, webhook signing secrets, and PII-bearing webhook payloads. Stored signatures and request bodies may also enable replay against downstream systems that do not deduplicate.

**Business Impact:**  
Third-party account compromise, downstream data manipulation, privacy exposure, and breach notification obligations.

**Recommended Fix:**  
Encrypt recoverable integration secrets using `secretbox.seal/open` or a KMS-backed envelope key. Show webhook secrets only once at creation/regeneration. Redact signatures in routine UI. Add retention limits for delivery request/response bodies and consider storing only hashes or truncated redacted payloads by default.

**Suggested Code Change:**

```ts
import { seal, open } from "./secretbox";

// on write
token: provider === "hubspot" ? seal(token) : null

// on use
const token = integration.token ? open(integration.token) : null;
```

**Priority:** P2

---

## Finding: SAML response replay protections are incomplete

**Severity:** Medium  
**Confidence:** Medium  
**Category:** Authentication  
**Affected File(s):**

- `src/saml.ts:55`
- `src/saml.ts:56`
- `src/saml.ts:62`
- `src/routes/selfservice.ts:113`
- `src/routes/selfservice.ts:119`
- `src/routes/selfservice.ts:122`

**Description:**  
SAML validation explicitly sets `validateInResponseTo: ValidateInResponseTo.never` because SAML instances are stateless. The code relies on signature validation, audience restriction, and a five-minute max assertion age, but does not store request IDs or consumed assertion IDs.

**Evidence:**  
The SAML configuration disables `InResponseTo` validation. The login route starts SAML with RelayState carrying the org id, and the ACS validates the response but has no replay cache.

**Attack Scenario:**  
An attacker who captures a valid SAML response, for example through endpoint logs, browser compromise, proxy compromise, or a misconfigured IdP/test environment, can replay it during the allowed assertion lifetime to obtain the same user's session.

**Business Impact:**  
Session takeover for employee self-service and possibly admin access when the asserted email maps to an admin account.

**Recommended Fix:**  
Persist outbound SAML request IDs with short TTL, validate `InResponseTo`, and store consumed assertion IDs or response IDs until expiry. If IdP-initiated SSO is required, treat it as a separate mode with explicit replay cache and stricter tenant binding.

**Suggested Code Change:**  
Use a shared cache/table for request IDs and consumed assertion IDs, and configure node-saml with `ValidateInResponseTo.always` for SP-initiated flows.

**Priority:** P2

---

## Finding: High-severity vulnerable dependency in nodemailer

**Severity:** Medium  
**Confidence:** High  
**Category:** Dependency  
**Affected File(s):**

- `package.json:25`
- `package-lock.json:18`

**Description:**  
`npm audit --json` reports one high-severity vulnerable package: `nodemailer`. The direct dependency is `nodemailer@^6.10.1`, and the audit recommends upgrading to `nodemailer@9.0.3`.

**Evidence:**  
`npm audit --json` returned one high vulnerability for `nodemailer`, including DoS and injection-related advisories. `npm outdated --json` also reports `nodemailer` latest as `9.0.3`.

**Attack Scenario:**  
Depending on which Nodemailer features are used and how message fields are controlled, vulnerable parser or SMTP handling paths may be reachable through email notifications, reset messages, lead notifications, or healthcheck scripts.

**Business Impact:**  
Potential denial of service or email/header/transport abuse. The precise exploitability should be validated during the upgrade, but the audit signal is strong enough to prioritize.

**Recommended Fix:**  
Upgrade `nodemailer` to the fixed major version, run the test suite, and manually exercise SMTP flows: reset, invite, signup, verification, lead notification, and healthcheck email.

**Suggested Code Change:**

```bash
npm install nodemailer@^9.0.3
npm audit
npm test
```

**Priority:** P2

---

## Finding: REST API card writes accept unvalidated template IDs

**Severity:** Medium  
**Confidence:** Medium  
**Category:** Authorization / API  
**Affected File(s):**

- `src/routes/api.ts:22`
- `src/routes/api.ts:35`
- `src/routes/api.ts:181`

**Description:**  
The REST API write helper copies `templateId` directly from request bodies into card create/update data. Unlike the admin route, the API does not verify that the template belongs to the card's location brand and org.

**Evidence:**  
`cardWriteData()` assigns `out.templateId = str(b.templateId)`. The PATCH handler updates the card with `cardWriteData(req.body || {})` after checking only that the card exists in the API key's org.

**Attack Scenario:**  
An API key with `cards:write` can attach an arbitrary known template id to a card. If the id belongs to another brand or tenant, the card may inherit unintended hidden fields, CTAs, disclaimers, or styling, or the write may behave differently depending on database constraints.

**Business Impact:**  
Tenant/brand policy confusion, public card content manipulation, and possible cross-tenant relationship integrity issues.

**Recommended Fix:**  
Validate every relationship id in API writes against the current org and the card's brand/location. Prefer a typed allowlist DTO per route and reject unknown/unpermitted fields.

**Suggested Code Change:**

```ts
async function allowedApiTemplateId(db, orgId: string, locationId: string, templateId?: string | null) {
  if (!templateId) return null;
  const loc = await db.location.findFirst({ where: { id: locationId, orgId }, select: { brandId: true } });
  const tpl = loc && await db.template.findFirst({ where: { id: templateId, orgId, brandId: loc.brandId } });
  return tpl?.id ?? null;
}
```

**Priority:** P2

---

## Finding: RLS enforcement can silently fall back to the owner database client

**Severity:** Medium  
**Confidence:** High  
**Category:** Infrastructure / Defense in Depth  
**Affected File(s):**

- `src/db.ts:15`
- `src/db.ts:21`
- `src/db.ts:31`
- `src/db.ts:33`
- `docker-compose.yml:25`
- `docker-compose.yml:28`

**Description:**  
The application uses an `opencard_app` database role for RLS when `APP_DB_PASSWORD` is set, but falls back to the owner Prisma client when it is absent. Local Docker explicitly leaves `APP_DB_PASSWORD` optional. Production compose requires it, but local/default deployments and ad hoc environments can run with RLS inert.

**Evidence:**  
`tenantUrl()` returns null when `APP_DB_PASSWORD` is missing, and `tenantDb` becomes `prisma`. The local compose file documents that RLS is inert when `APP_DB_PASSWORD` is unset.

**Attack Scenario:**  
A deployment copied from the local quick-start or an ad hoc environment omits `APP_DB_PASSWORD`. Bugs that RLS is supposed to catch then rely entirely on application-level filters.

**Business Impact:**  
Reduced tenant-isolation defense in depth and inconsistent security behavior between development, staging, and production.

**Recommended Fix:**  
Fail closed when `NODE_ENV=production` and RLS is not enforced. Consider making `APP_DB_PASSWORD` mandatory in all Docker examples. Add a health endpoint or boot log that clearly reports whether RLS is enforced.

**Suggested Code Change:**

```ts
if (config.isProduction && !rlsEnforced) {
  throw new Error("APP_DB_PASSWORD is required in production so RLS is enforced.");
}
```

**Priority:** P2

---

## Finding: Runtime container runs as root

**Severity:** Low  
**Confidence:** High  
**Category:** Infrastructure  
**Affected File(s):**

- `Dockerfile:20`
- `Dockerfile:41`

**Description:**  
The runtime image does not create or switch to a non-root user. If the Node process is compromised, the attacker runs as root inside the container.

**Evidence:**  
The Dockerfile defines the runtime stage and `CMD` but has no `USER` directive.

**Attack Scenario:**  
A remote code execution or arbitrary file write vulnerability in the app or dependencies yields root privileges inside the container, increasing the impact against mounted volumes and container runtime escape chains.

**Business Impact:**  
Higher blast radius for application compromise.

**Recommended Fix:**  
Create a dedicated user, set ownership for `/app/uploads` and any needed writable directories, and run `USER node` or a custom unprivileged UID.

**Suggested Code Change:**

```dockerfile
RUN useradd -r -u 10001 opencard && chown -R opencard:opencard /app
USER opencard
```

**Priority:** P3

---

## Finding: MFA is optional for admin and platform accounts

**Severity:** Low  
**Confidence:** High  
**Category:** Authentication  
**Affected File(s):**

- `src/routes/admin.ts:181`
- `src/routes/admin.ts:192`
- `src/routes/admin.ts:989`
- `src/routes/admin.ts:998`
- `src/routes/admin.ts:1056`

**Description:**  
The application supports TOTP MFA and recovery codes, but admins can sign in without MFA unless they have voluntarily enabled it. Platform and org-owner accounts control tenant data, billing, integrations, and destructive operations.

**Evidence:**  
The login route asks for MFA only if `au.mfaEnabled && au.mfaSecret`; MFA enrollment and disablement are self-service actions.

**Attack Scenario:**  
A stolen admin password is enough to access a high-privilege account that has not enrolled MFA.

**Business Impact:**  
Admin account compromise can lead to tenant data exposure, deletion, webhook/CRM abuse, billing changes, or staff-account changes.

**Recommended Fix:**  
Require MFA enrollment for platform roles and org owners before allowing privileged admin surfaces. For SSO tenants, document and enforce MFA at the IdP or require local MFA for password sign-ins.

**Suggested Code Change:**  
Add middleware after `requireAdmin` that redirects privileged users without `mfaEnabled` to enrollment and blocks all non-enrollment POSTs until complete.

**Priority:** P3

---

## Secrets Review

No committed real secrets, private keys, API keys, passwords, or customer data were confirmed. A redacted local scan flagged only environment-variable references and sample code:

- `docs/WEBHOOKS.md:83` - sample `process.env.OPENCARD_WEBHOOK_SECRET`, not a secret value.
- `src/config.ts:51` and `src/config.ts:64` - environment-variable references, not values.
- `src/selfauth.ts:115` - environment-variable reference used in an OAuth token request, not a value.

No `.env` file was present in the repository; only `.env.example` was found.

## Dependency and Supply Chain Notes

Commands run:

- `npm audit --json` - completed with one high-severity vulnerable package: `nodemailer`.
- `npm outdated --json` - completed; notable major updates available include Prisma 7.x, Express 5.x, Stripe 22.x, Nodemailer 9.x, Dotenv 17.x.
- `npm run typecheck` - failed because local dependencies are not installed: `sh: tsc: command not found`.

I did not run `npm ci` because the request limited filesystem changes to the two report files.

