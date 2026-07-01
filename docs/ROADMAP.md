# OpenCard Product Roadmap

OpenCard is moving from a self-hosted digital business card app toward a
dealership-first SaaS product for brand-controlled contact identity, QR/NFC
lead capture, and sales attribution across multi-location teams.

The first vertical is car dealerships because dealer groups have the right
shape of pain: many rooftops, high employee turnover, strict brand requirements,
customer-facing sales/service/BDC teams, CRM-driven workflows, and real need for
measurable lead capture. The product should feel purpose-built for dealer
groups, while the core model stays generic enough to support franchises, real
estate brokerages, insurance agencies, field sales teams, clinics, and other
multi-location organizations later.

## Product Thesis

The card itself is not the moat. The moat is the system around the card:

- every employee and customer-facing asset stays on brand
- provisioning and offboarding are automatic
- QR/NFC/email signature interactions become trackable leads
- managers can see attribution by person, rooftop, department, campaign, and source
- captured leads can flow into the customer's CRM and marketing stack
- enterprise buyers can say yes because security, billing, auditability, and SSO are ready

The first major milestone is:

> A dealer group can sign up, pay, configure brands and rooftops, provision employees,
> publish cards and QR assets, capture customer leads, and export or sync those leads.

## Guiding Principles

1. **Dealership-specific UI, generic data model.**
   Use terms like rooftop, sales advisor, BDC, service lane, and customer lead in the dealership experience, but keep core entities generic: `Org`, `Brand`, `Location`, `Card`, `Lead`, `Source`, `Campaign`, and `Integration`.

2. **Brand control before decoration.**
   Prioritize governance, locked fields, templates, legal disclaimers, and role-based defaults before building a heavy card designer.

3. **Lead attribution is the business value.**
   Every QR scan, NFC tap, vCard save, email signature click, and form submission should carry source context.

4. **Enterprise readiness is not optional.**
   SSO, SCIM, audit logs, tenant isolation, backups, export/delete workflows, and plan controls must arrive before broad sales.

5. **Start narrow, expand cleanly.**
   Win dealer groups first, but avoid hardcoding dealership-only concepts into the core schema unless they are isolated as vertical extensions.

## Phase 0: Hardening The Existing App

Goal: make the current codebase safe enough to evolve into SaaS.

### Completed or In Progress

- Fail closed on weak default secrets.
- Harden admin/session cookies.
- Remove same-origin SVG upload risk.
- Add safer upload response headers.
- Add optional SAML sign-in controlled by super admins.
- Add vertical terminology support with dealership defaults.
- Keep SAML disabled until configured.
- Keep repo layout aligned with GitHub root.

- CSRF protection (Origin/Referer guard) on admin and self-service POST routes.
- Request rate limiting for login, SCIM, public lead capture, and API auth.
- Global security headers (CSP, nosniff, frame, referrer, permissions, HSTS).
- Structured request logging.
- Error-handling middleware with safe production responses.
- Basic automated tests (auth/sessions, TOTP/passwords, rate limit, CSRF, parsing, vCard).
- Replaced deprecated `multer` 1.x with the maintained `multer` 2.x.
- Database migrations (`prisma migrate deploy`, baseline-aware) instead of `db push` for production.

**Phase 0 complete.** Next up: Phase 1 (true multi-tenancy).

## Phase 1: True SaaS Multi-Tenancy

Goal: turn one-company-per-deployment into a real multi-tenant SaaS foundation.

### Tenant Isolation Strategy (decided)

We use **pooled multi-tenancy by default** — shared application and shared database
with strong logical isolation — rather than spinning up separate containers or
databases per customer. Reasoning:

- ISO 27001 certifies an information security management system (controls, risk
  assessment, access control, logging, encryption), not physical isolation
  between tenants. Logical isolation is an accepted control.
- Container-per-tenant multiplies operational risk (every migration, patch, and
  deploy fans out across N stacks; version skew makes consistent patching harder)
  and scales cost per customer instead of per load.
- The real isolation risk in shared multi-tenancy is an application bug that
  forgets a tenant filter. The right mitigation is defense-in-depth at the data
  layer, not separate containers.

Defense-in-depth, in layers:

1. **Application-level scoping** — every query and write is scoped by `orgId`
   (done in increment 1).
2. **Database-enforced Row-Level Security (RLS)** — Postgres policies keyed on
   `orgId` so the database itself refuses cross-tenant rows even if a query
   forgets its filter. The runtime app connects as a **least-privilege,
   non-superuser role** (`opencard_app`, `NOSUPERUSER NOBYPASSRLS`); migrations
   and seed run as the privileged owner, which bypasses RLS.
3. **Promote-to-isolated tier (future)** — keep the `orgId` boundary clean enough
   that an individual enterprise tenant can later be promoted to a dedicated
   database (or dedicated stack) when a customer has a contractual or
   data-residency requirement. This is an opt-in premium tier, not the default.

### Security & Compliance Groundwork (ISO 27001 path)

Start the management-system controls early, while the system is small:

- Least-privilege database roles (runtime app role separate from owner). **(in progress)**
- Centralized audit logging (who accessed/changed which tenant's data, when).
- Encryption in transit and at rest; documented secrets management.
- Automated backups with a *tested* restore procedure.
- Dependency/vulnerability scanning in CI.
- Documented change management (git + reviewed migrations already provide this).
- A lightweight asset inventory and risk register.

(Full SOC 2 / ISO 27001 control work is tracked in Phase 9; this is the early
technical groundwork.)

### Data Model

- Add strong tenant scoping to all tenant-owned models. **(done)**
- Ensure `Org` is the top-level customer account, not just demo metadata. **(done)**
- Add `orgId` to all data that must be tenant isolated: **(done)**
  - `Location`
  - `Template`
  - `User`
  - `Card`
  - `AnalyticsEvent`
  - `Lead`
  - `ApiKey`
  - `WebhookEndpoint`
  - `WebhookDelivery`
  - future integrations and billing records
- Keep `Brand` under `Org`, but avoid inferring tenant only through joins for security-critical writes. **(done)**
- Enforce isolation at the database with Postgres RLS, not only in application code. **(in progress)**
- Add tenant isolation tests for every route family.

### Increment Plan

1. **Tenant data model + app-level scoping.** `orgId` on every tenant-owned
   model, resolved from authoritative parents on writes, and every REST
   read/write scoped by the authenticated org. **(done)**
2. **Database-enforced RLS.** RLS policies on all tenant tables, a least-privilege
   runtime role, and a `runWithOrg` helper that sets the tenant context per
   transaction. API routes run under the enforced role first. **(in progress)**
3. **Tenant resolution seam + remaining routes under RLS.** *(in progress)*
   - A single `resolveOrgId(req)` seam with host-based strategy (custom domain /
     platform subdomain) ready but inert, falling back to the single default
     org. `Org.subdomain` / `Org.customDomain` fields added now. **(done)**
   - Public-card, self-service, and SCIM **write** paths moved onto the
     RLS-enforced client via `runWithOrg`. **(done)**
   - Admin + `rbac` cutover is deferred to increment 4 (it is intertwined with
     org-scoping `AdminUser` and the per-org role hierarchy; doing it together
     avoids churning the large admin surface twice).
   - **Deferred until there's a deploy target / first customer:** actually
     serving `acme.opencard.id` subdomains and `cards.acmecorp.com` custom
     domains — wildcard DNS, automatic TLS, and hostname routing at the proxy.
     None of this can be exercised on localhost; the code seam is ready so
     enabling it later is additive (populate the fields, point DNS, done).
   - **Slug scoping decision:** public card slugs stay *globally* unique for now
     (no host to disambiguate). When host-based routing lands, make slugs
     org-scoped so two customers can both use e.g. `john-smith`.
4. **Onboarding + per-org role hierarchy.** *(in progress)*
   - `AdminUser.orgId` added; admins are per-org and rbac is org-aware so an admin
     can never see or manage another org's data. **(done)**
   - Role hierarchy: platform_owner (cross-org) / org_owner / org_admin /
     brand_admin / location_admin (legacy super_admin + general_admin retained).
     **(done)**
   - Self-service signup at `/signup` creates an org + org_owner + first brand +
     rooftop; gated by `SIGNUPS_ENABLED` (on in dev, off in prod by default).
     **(done)**
   - Auth: MFA is now optional (password-first; enrol/disable under
     Admin -> Security); the ADMIN_TOKEN stays as break-glass platform access.
     Redesigned login page. **(done)**
   - Pure authorization + host-addressing logic unit-tested. DB-backed
     cross-tenant integration tests run in CI (the local `npm test` has no DB).
     **(remaining)**
   - `SamlConfig` org-scoping and the admin/rbac DB-RLS cutover move to Phase 3
     (per-org SSO) — admin is internal and now strictly app-level org-scoped,
     while the externally-reachable surfaces already enforce DB-RLS.

### Tenant Resolution

- Support customer subdomains, for example `mullinax.opencard.com`.
- Support custom domains for public cards, for example `cards.dealergroup.com`.
- Add org resolution middleware:
  - admin routes resolve from authenticated admin
  - public card routes resolve by slug/domain
  - API routes resolve by API key
  - SCIM routes resolve by tenant-specific token
- Make cross-tenant access impossible by default.

### Onboarding

- Add signup flow.
- Create first org, first admin, first brand, and first rooftop.
- Add guided checklist:
  - configure brand
  - add rooftop
  - create/import first employees
  - publish first cards
  - set up QR or email signature
  - invite team

### Admin Roles

- Keep current roles but scope them per org:
  - platform owner
  - org owner
  - org admin
  - brand admin
  - rooftop admin
  - department manager
  - employee/self-service user
- Add explicit platform admin surface separate from customer admin.

## Phase 2: Billing And Plans

Goal: make the product sellable and enforce plan boundaries.

### Increment status

- **Plans + entitlements engine (done).** `src/plans.ts` defines Starter / Team /
  Dealer Group / Enterprise with per-tier features and countable limits (pure +
  unit-tested). `src/entitlements.ts` resolves an org's plan and usage.
- **Feature gating + limits (done).** Org billing fields on the tenant; brand /
  rooftop / card / admin creation enforce plan limits; API keys, webhooks, and
  SSO are gated by plan feature. A Plan & usage admin page shows limits/usage and
  lets a platform owner assign a plan (interim, until checkout).
- **Account billing modes (done).** `Org.billingMode` = standard / demo / free.
  `src/access.ts` computes active vs expired from mode + status + trial deadline
  (unit-tested); an admin gate blocks writes and shows a "subscription required"
  wall when a demo/trial lapses (reads + billing stay open). Platform owners set
  mode, demo length (30/60 days), and plan from the Plan & usage page.
- **Stripe checkout / portal / webhooks (done, needs keys to activate).** Behind
  `STRIPE_SECRET_KEY`: `/admin/billing/checkout` creates a hosted Checkout
  session per plan, `/admin/billing/portal` opens the customer portal, and
  `POST /stripe/webhook` (raw-body, signature-verified) reconciles
  plan/subscriptionStatus/period/cancel from subscription + invoice events. All
  inert until keys are set. To activate: add Stripe test keys + per-plan Price
  ids to `.env`, and run `stripe listen --forward-to localhost:3000/stripe/webhook`.
  Cards are entered on Stripe's hosted page — the app never sees them.

### Billing

- Add Stripe customer and subscription records.
- Add hosted checkout.
- Add customer portal.
- Add subscription webhooks.
- Add trial state.
- Add failed payment handling.
- Add cancellation and downgrade flows.

### Plans

Suggested starting plan structure:

- **Starter**
  - basic cards
  - QR codes
  - limited analytics
  - manual employee management

- **Team**
  - brand templates
  - rooftop management
  - employee self-service
  - lead capture
  - email signatures
  - CSV export

- **Dealer Group**
  - multi-rooftop governance
  - SAML/OIDC
  - SCIM provisioning
  - webhooks
  - CRM sync
  - advanced analytics
  - custom domains

- **Enterprise**
  - audit logs
  - custom contract
  - advanced SSO/SCIM
  - priority support
  - data retention controls
  - dedicated onboarding

### Entitlements

- Build a central entitlement helper.
- Gate features by plan.
- Track usage:
  - active cards
  - admins
  - rooftops
  - custom domains
  - lead volume
  - API/webhook volume
  - CRM sync volume

## Phase 3: Per-Tenant SSO, SCIM, API, And Webhooks

Goal: make enterprise identity and integrations tenant-scoped.

### Increment status

- **Per-tenant SCIM tokens (done).** Each org can generate its own SCIM bearer
  token (only the hash is stored; shown once) from Admin → Integrations. The
  SCIM router resolves the tenant from the token, gates on the `scim` plan
  feature, and scopes every list/get/create/update/delete to that org so one
  customer's IdP can only provision into their own org. The legacy global
  `SCIM_TOKEN` still maps to the default org for back-compat.
- **API-key permission scopes (done).** Keys carry granted scopes
  (brands/stores/cards/leads/analytics read/write); each API route enforces the
  scope it needs and returns 403 `insufficient_scope` otherwise. Empty scopes =
  full access (back-compat with existing keys + admin token). Keys track
  last-used time and route, chosen via checkboxes at creation and shown in the
  key list.
- **Next:** per-org SAML/OIDC (needs host-based routing for the sign-in/ACS
  flow); webhook event expansion + delivery inspector/replay.

### SSO

- Move global SAML config into per-org auth config.
- Support SAML per org.
- Support OIDC per org.
- Support multiple identity providers only when a customer actually needs it.
- Add JIT admin/user provisioning rules.
- Add domain allowlists.

### SCIM

- Make SCIM tokens tenant-specific.
- Add per-org SCIM endpoint or tenant-aware token routing.
- Map SCIM attributes to:
  - brand
  - rooftop
  - department
  - role
  - manager
  - active state
- Add SCIM sync status and error logs in admin.
- Add deprovision policies:
  - deactivate card
  - redirect card
  - preserve analytics
  - transfer leads

### API Keys

- Scope API keys to org.
- Add key permissions:
  - cards read/write
  - leads read
  - analytics read
  - webhooks manage
- Add last-used metadata by route.

### Webhooks

- Scope webhooks to org.
- Add event subscriptions:
  - `lead.captured`
  - `card.created`
  - `card.updated`
  - `card.deleted`
  - `employee.deactivated`
  - `qr.scanned`
  - `vcard.saved`
  - `campaign.conversion`
- Add retry queue durability.
- Add delivery inspector with replay.

## Phase 4: Dealership Product Layer

Goal: make OpenCard feel like it was built for dealer groups.

### Dealership Vocabulary

- Use dealership terminology in the UI:
  - org = dealer group
  - location = rooftop
  - lead = customer lead
  - card = card or asset depending on type
  - source = QR/NFC/email/campaign source
- Keep terminology configurable for future verticals.

### Rooftop Management

- Add rooftop profile:
  - dealership name
  - OEM brands
  - address
  - phone
  - website
  - service URL
  - sales URL
  - CRM routing config
  - timezone
- Add departments:
  - Sales
  - Service
  - Parts
  - Finance
  - BDC
  - Management
- Add department-level defaults and CTAs.

### Role-Based Card Templates

- Add role templates:
  - Sales consultant
  - Sales manager
  - Service advisor
  - Parts advisor
  - Finance manager
  - BDC representative
  - General manager
- Each role template should define:
  - visible fields
  - locked fields
  - default CTAs
  - lead capture form
  - disclaimers
  - QR behavior
  - email signature block

### Turnover Workflow

- Add employee deactivation flow:
  - disable public card
  - transfer leads
  - preserve analytics
  - optionally redirect old card to rooftop or manager
  - remove self-service access
- Add replacement workflow:
  - clone card settings
  - reuse role template
  - assign new owner email

### Dealership Asset Types

Expand beyond employee cards:

- employee card
- rooftop card
- department card
- desk QR
- vehicle window QR
- service lane QR
- event QR
- campaign QR
- email signature
- showroom poster
- print badge

Use generic `Card` or a new `Asset` model depending on how much behavior diverges.

## Phase 5: Lead Capture And Attribution

Goal: make every card interaction useful to sales and marketing.

### Lead Forms

- Add configurable lead forms per card/template/asset.
- Add dealership-friendly fields:
  - name
  - email
  - phone
  - preferred contact method
  - vehicle interest
  - trade-in interest
  - service need
  - appointment request
  - notes
- Add consent checkbox and configurable privacy text.

### Source Tracking

- Track every interaction with:
  - org
  - brand
  - rooftop
  - department
  - card/asset
  - employee
  - source type
  - campaign
  - UTM values
  - referrer
  - device/browser
  - timestamp
- Add short source codes for physical QR/NFC assets.

### Lead Routing

- Route leads by:
  - card owner
  - rooftop
  - department
  - campaign
  - form type
  - CRM mapping
- Add notification options:
  - email
  - webhook
  - CRM sync
  - future SMS/slack-like channels

### Lead Lifecycle

- Add lead status:
  - new
  - sent
  - synced
  - failed
  - archived
- Add duplicate detection.
- Add lead export.
- Add lead handoff history.

## Phase 6: Email Signatures

Goal: make every employee email a controlled contact and lead channel.

### Signature Generator

- Generate branded signatures from card data.
- Include:
  - name/title
  - phones/email
  - rooftop address
  - brand logo
  - QR code
  - CTA buttons
  - campaign banner
  - legal disclaimer
- Provide copy-paste HTML.
- Provide plain text fallback.
- Provide preview per role/template.

### Signature Governance

- Lock brand/OEM elements.
- Allow admin-approved banners.
- Add campaign start/end dates.
- Add per-rooftop disclaimers.
- Add per-department CTAs.

### Deployment

- Start with manual copy/install.
- Add Google Workspace deployment later.
- Add Microsoft 365 deployment later.

## Phase 7: CRM And Marketing Integrations

Goal: make OpenCard part of the dealership revenue stack.

### Integration Strategy

Start with low-friction export paths, then add deep integrations.

1. CSV export
2. signed webhooks
3. Zapier/Make-compatible payloads
4. HubSpot
5. Salesforce
6. dealership CRM targets based on demand

Potential dealership CRM targets:

- VinSolutions
- DealerSocket
- Elead/CDK
- Tekion
- Reynolds and Reynolds
- DriveCentric

### CRM Sync

- Add integration records per org.
- Add field mapping.
- Add sync status.
- Add retry queue.
- Add dead-letter queue.
- Add admin-visible sync errors.
- Add per-rooftop routing rules.

### Marketing Integrations

- Add Google Analytics/Tag Manager support by org.
- Add Meta/Google Ads conversion hooks later.
- Add campaign-level landing URLs.

## Phase 8: Analytics And ROI Dashboards

Goal: show managers why they are paying.

### Core Analytics

- Card views
- QR scans
- NFC taps
- vCard downloads
- CTA clicks
- lead form opens
- lead captures
- CRM sync success/failure

### Dealership Dashboards

- Dealer group overview.
- Rooftop leaderboard.
- Department performance.
- Employee performance.
- Campaign performance.
- Source performance:
  - QR
  - NFC
  - email signature
  - event
  - vehicle window
  - service lane
- Lead conversion funnel.

### Reporting

- Date filters.
- CSV export.
- Scheduled email reports.
- Manager digest.
- Attribution by campaign/source.

## Phase 9: Brand Governance And Compliance

Goal: make marketing, legal, and IT comfortable.

### Brand Governance

- Brand kits:
  - logos
  - colors
  - fonts
  - approved images
  - disclaimers
  - CTA library
- Locked fields.
- Required fields.
- Approval workflow for employee edits.
- Template versioning.
- Brand/OEM-specific disclaimers.

### Security And Compliance

- Audit logs:
  - login
  - admin changes
  - card changes
  - SSO/SCIM changes
  - integration changes
  - billing changes
- Data export per org.
- Data deletion per org/user/lead.
- Retention policies.
- Backup/restore documentation.
- SOC 2 readiness path.
- GDPR/CCPA support path.
- DPA template later.

## Phase 10: Custom Domains, Wallet, NFC, And Expansion

Goal: expand channels once the SaaS core is sturdy.

### Domains

- Custom public card domains per org.
- Branded short links.
- Slug governance.
- DNS verification.
- TLS automation.

### Wallet Passes

- Apple Wallet contact/pass card.
- Google Wallet pass.
- Update pass when card changes.
- Track wallet saves.

### NFC

- NFC card ordering workflow.
- NFC encoding instructions.
- NFC asset assignment.
- Replacement/reassignment flows.

### Events

- Event mode for auto shows, tent sales, hiring events, and community events.
- Temporary campaign QR assets.
- Event lead forms.
- Event performance dashboards.

### Mobile App

Avoid building this too early. Start with responsive web and wallet passes.
Build a mobile app only when there is clear pull for field usage, push
notifications, badge scanning, or offline event capture.

## Suggested Build Sequence

### Milestone 1: SaaS Tenant Core

- Tenant isolation.
- Org onboarding.
- Per-org admin roles.
- Per-org SAML/SCIM/API/webhooks.
- Security middleware.
- Migrations.
- Basic tests.

### Milestone 2: Dealership MVP

- Rooftop terminology and settings.
- Departments.
- Role-based templates.
- Employee import.
- Lead capture forms.
- QR source tracking.
- Manager analytics.

### Milestone 3: Paid Beta

- Stripe billing.
- Plans and entitlements.
- Custom domains.
- Email signatures.
- CSV/webhook lead export.
- Audit logs.
- Backup/restore docs.

### Milestone 4: Revenue Integrations

- HubSpot or Salesforce first.
- Zapier/Make payload compatibility.
- CRM sync status.
- Lead routing by rooftop/department/source.
- Campaign dashboards.

### Milestone 5: Enterprise Readiness

- SCIM hardening.
- SSO hardening.
- Data retention.
- Advanced audit logs.
- Admin approval workflows.
- SOC 2 readiness plan.

## Near-Term Engineering Backlog

1. Move from single-deployment assumptions to tenant-aware route middleware.
2. Add `orgId` to tenant-owned tables.
3. Add tenant isolation tests.
4. Replace `prisma db push` production startup with migrations.
5. Add CSRF and rate limiting.
6. Replace deprecated upload dependency.
7. Move SAML config from global to per-org.
8. Move SCIM token from global to per-org.
9. Add `Department`.
10. Add `Source` or `AssetSource` for QR/NFC/email attribution.
11. Add role templates for dealership departments.
12. Add configurable lead forms.
13. Add basic manager dashboard by rooftop and employee.
14. Add email signature generation.
15. Add Stripe billing foundation.

## Open Product Questions

- Should public card URLs be global slugs, org-scoped slugs, or custom-domain scoped?
- Should non-person assets live in `Card` with a type field, or in a separate `Asset` model?
- Which CRM should be first for dealership pilots?
- Should employee self-service edits require admin approval by default?
- What is the first paid plan limit: active cards, rooftops, lead volume, or all three?
- Do dealer groups need OEM-level governance separate from dealer-group governance?
- Should custom domains be included in dealer group plans or reserved for enterprise?

## First Pilot Definition

A strong first pilot customer should have:

- 3 or more rooftops
- at least 50 customer-facing employees
- a clear CRM/export need
- enough turnover that provisioning/offboarding matters
- a marketing or operations owner who cares about brand consistency
- willingness to put QR codes in real workflows

The pilot is successful when:

- all active sales/service/BDC staff have cards
- at least one physical QR/NFC workflow is live
- email signatures are deployed for at least one department
- captured leads are exported or synced
- managers can see activity by rooftop and employee
- offboarding one employee does not require manual cleanup in five places

