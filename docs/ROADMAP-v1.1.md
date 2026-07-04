# OpenCard Roadmap v1.1 — From Feature-Complete To Launch-Ready

The v1.0 roadmap (Phases 0–10) is complete: multi-tenant core, billing and
plans, SSO/SCIM/API/webhooks, the dealership product layer, lead capture and
attribution, email signatures, CRM sync, analytics, governance/compliance,
custom domains, wallet passes (Google), and events mode. The security pass and
UI modernization landed on top of that.

v1.1 is about a different question: **what breaks, embarrasses, or blocks us
when real customers show up?** The phases are ordered by that risk, not by
feature appeal. Phases 11–13 are launch gates; 14–15 are growth.

## Phase 11: Account Lifecycle Basics (launch gate)

The biggest functional holes are not features — they're table-stakes account
flows every SaaS is assumed to have. Right now there is **no password reset,
no signup email verification, and no MFA recovery**, so a locked-out owner is
a support ticket and a typo'd signup email is a silently broken account.

- Password reset: time-limited single-use token, emailed via the existing
  SMTP path; rate-limited; audited. Works for admin accounts on all tiers.
- Email verification on signup: unverified orgs can look around but not go
  live (cards unpublished) until the owner confirms the address.
- MFA recovery codes: one-time codes generated at enrollment, hashed at rest,
  shown once — so "lost my phone" doesn't require staff intervention.
- Session management: list active sessions per admin, revoke one/all;
  invalidate sessions on password change and on suspension.
- Admin invite flow: invite-by-email with a set-password link, replacing the
  current "admin types a password for you" pattern.

## Phase 12: Operations And Reliability (launch gate)

Everything runs on one VM deployed by rsync from a laptop, backups are a
documented-but-manual `pg_dump`, and nothing alerts anyone when it breaks.
Fine for a test box; not for paying tenants.

- CI: GitHub Actions running typecheck + the test suite on every push/PR.
- CD: push-to-deploy via SSH from Actions (deploy key in repo secrets),
  replacing double-click deploys; keep `deploy.command` as the manual fallback.
- Automated backups: nightly `pg_dump` cron on the VM, shipped off-box
  (object storage), retention window, and a **documented, rehearsed restore**.
  Include the uploads volume.
- Monitoring: uptime checks on `/healthz` for both domains, error tracking in
  the app (Sentry or similar), disk/memory alerts on the VM.
- Staging environment: a second compose stack (or second VM) that CI deploys
  first; production promotes from it.
- Performance pass: review Prisma indexes against the analytics and leads
  queries; load-test the public card path (it's the traffic magnet).
- Zero-downtime deploys — DONE: two web instances (web_a/web_b, one image)
  with container healthchecks; Caddy health-checks both upstreams and retries
  in-flight requests on failover; the pipeline builds first, then recreates
  one instance at a time with `up --wait`, so a broken image aborts the
  deploy while the old code keeps serving.

## Phase 13: Finish What's Started

Features that exist in half-state, promised in v1.0 docs, or stubbed in code:

- Apple Wallet: `.pkpass` packaging/signing is a 501 stub behind the cert
  config. Finish manifest + PKCS#7 signing, and update passes when cards
  change (both platforms).
- LDAP sync job: promised as v1.1 in ARCHITECTURE.md for on-prem AD shops —
  reuse the SCIM upsert logic on a schedule.
- Directory import and sync (Azure AD / Entra). SCIM provisioning exists but
  only covers users pushed *after* the integration is assigned; there's no
  backfill, no JIT, and no visibility. Add:
  - **Bulk import wizard** via Microsoft Graph: connect with the existing
    Azure app credentials, pick groups/OUs, preview the mapped cards
    (name/title/department/location from store codes), dry-run, then create —
    the day-one on-ramp for an org with 500 existing employees.
  - **SAML JIT provisioning** (opt-in per org): first SSO sign-in at /me
    creates the card from assertion attributes instead of "no card assigned",
    using the same mapping as SCIM.
  - **Sync health dashboard**: per-org view of what SCIM created/updated/
    deactivated, last-seen timestamps, orphaned cards (owner no longer in the
    directory), and mapping conflicts — with a reconcile action.
  - **Group → brand/location/department mapping rules** managed in the UI,
    shared by SCIM, Graph import, JIT, and the future LDAP job so all four
    paths provision identically.
- Signature deployment: Google Workspace and Microsoft 365 push (Gmail API /
  Graph), so signatures roll out org-wide instead of copy/paste per employee.
- CRM depth: the dispatcher has an explicit "provider not yet supported"
  path — decide the next first-class provider (likely a real Salesforce API
  integration beyond Web-to-Lead) and add Meta/Google Ads conversion hooks.
- NFC workflow: ordering, encoding instructions, assignment and replacement
  flows — listed in Phase 10 but never built; pairs naturally with events.

## Phase 14: Admin Experience And Growth

- Bulk employee import: CSV upload with column mapping, preview, and
  dry-run — the on-ramp for orgs without a directory; shares the preview/
  dry-run machinery with the Graph import wizard in Phase 13.
- Onboarding checklist: first-run panel for a new org (create brand → add
  location → make a card → share it → capture a lead), driving activation.
- Analytics visualization: the dashboards are all tables; add simple charts
  (views over time, funnel, source mix) — server-rendered SVG keeps the
  no-framework stance.
- Template tooling: duplicate templates, cross-brand copy, and a small
  starter gallery so new orgs don't design from scratch.
- API docs: publish `docs/API.md` as a real reference page, add example
  requests, and version the API surface.
- Notifications: lead alerts to Slack/Teams webhooks, not just email.

## Phase 15: Verticalization

The scaffolding exists (`Org.vertical`, the `Terminology` layer threaded
through the views) but dealership assumptions are baked into forms, lead
fields, and labels, and nothing ever sets a vertical. Public signup is open,
so non-dealership orgs already land in a dealership-flavored product — Stage 1
is a launch-adjacent cleanup, not a someday feature.

### Stage 1: Make the general vertical real (launch-adjacent)

- Fix the tenant bug first: `currentTerminology()` resolves terminology from
  an **arbitrary** org (`findFirst()`), not the signed-in tenant — one org's
  vertical leaks into every other org's admin UI.
- Vertical picker at signup: a **"Business type"** dropdown on the public
  signup form (customer-facing wording — never "vertical") with friendly
  labels: "Car dealership", "General business", and one entry per future
  pack. The choice sets `Org.vertical`, which drives terminology, lead-form
  defaults, department suggestions, and starter templates from day one.
  Options come from the installed vertical packs (Stage 2), so shipping a new
  pack automatically adds it to the dropdown. Same picker on the staff
  client form; staff can change an org's type later (with a warning about
  relabeled UI and lead-form changes).
- Gate dealership-only UI behind the vertical: OEM brands, Sales/Service
  URLs and timezone block in the location editor; vehicle-interest/trade-in/
  service-need lead fields; department suggestions; "Rooftop leaderboard"
  and similar copy; signup placeholders.
- Audit every public surface (card, lead form, signatures, vCard) renders
  cleanly for a general org.

### Stage 2: Vertical packs (config, not code)

Turn what "dealership" hardcodes into a data bundle so a new vertical is a
pack, not a fork: terminology, department suggestions, lead-form field
catalog, CTA suggestions, starter templates, signup placeholders. The
dealership pack becomes the first consumer; "general" is the empty pack.

### Stage 3: New verticals on demand (pull, not push)

Candidates that fit the brand→location→person model with field lead capture:
real-estate brokerages (agents/offices), home services (techs/branches),
franchise retail, insurance agencies. Pick by actual pipeline, not appeal —
each needs its own lead fields, integrations, and go-to-market, so treat a
new vertical as a business decision that ships as a pack.

## Phase 16: Expansion (pull, not push)

Unchanged philosophy from v1.0: responsive web + wallet passes first, a mobile
app only when field usage demands it (badge scanning, offline event capture,
push). Revisit after Phases 11–15 with real usage data. Same for i18n — add
when the first non-English tenant is in the pipeline, not before.

## Suggested Sequence

1. **11 + 12 in parallel** — different skill areas (product flows vs infra),
   both launch gates.
2. **15 Stage 1** alongside them — small, and public signup already exposes
   the gap (the terminology tenant bug should be fixed immediately).
3. **13** next — mostly bounded engineering with clear definitions of done.
4. **14 + 15 Stage 2** continuously after launch, prioritized by onboarding
   data and pipeline.
5. **15 Stage 3 + 16** only on demonstrated pull.
