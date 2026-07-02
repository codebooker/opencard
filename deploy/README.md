# Deploying OpenCard

Production runs three containers behind Caddy: **db** (Postgres), **web** (the app),
and **caddy** (TLS reverse proxy), plus **portainer** for container management.
Cloudflare sits in front for DNS and edge TLS.

- `opencard.id` (+ `*.opencard.id`) → the app + admin (and per-tenant subdomains)
- `tapshare.cards` → public card pages

Everything is driven from your Mac by two double-click scripts, because the app
can't reach the VM directly. Your Mac connects to the VM over SSH.

## One-time setup

1. **Point your SSH key at the VM.** Make sure you can `ssh root@<vm-ip>` from your
   Mac (Hetzner adds your key at creation, or set one up).
2. **Create your deploy config.** Copy `deploy/deploy.config.example` to
   `deploy/deploy.config` and fill in `VM_HOST`, `VM_USER`, and (optionally)
   `SSH_KEY`. This file is gitignored.
3. **Provision the VM.** Double-click `provision.command`. It syncs the project,
   installs Docker + Portainer, opens the firewall (22/80/443), and generates
   `deploy/.env` on the VM with fresh random secrets. **Save the admin token it
   prints** — that's your break-glass platform login.
4. **TLS: create a Cloudflare Origin Certificate.** In Cloudflare → SSL/TLS →
   Origin Server → Create Certificate. Cover these hostnames:
   `opencard.id, *.opencard.id, tapshare.cards, *.tapshare.cards`. Save the
   certificate to `deploy/certs/origin.pem` and the private key to
   `deploy/certs/origin.key` **on the VM** (`/opt/opencard/deploy/certs/`).
   Set the Cloudflare SSL/TLS mode to **Full (strict)**.
5. **DNS.** In Cloudflare, add A records for `opencard.id`, `tapshare.cards`, and
   the wildcards (`*.opencard.id`, `*.tapshare.cards`) → your VM's IP, all
   **proxied** (orange cloud).

## Deploy / update

Double-click `deploy.command`. It syncs the latest code, builds, applies database
migrations, provisions the RLS role, and (re)starts the containers. Run it any
time you want to ship changes.

## After it's up

- App/admin: `https://opencard.id/admin` — sign in with the break-glass token
  (or create your owner account at `https://opencard.id/signup`).
- Public cards: `https://tapshare.cards/c/<slug>`.
- **Portainer** is bound to localhost only. Reach it with an SSH tunnel:
  `ssh -L 9443:localhost:9443 root@<vm-ip>` then open `https://localhost:9443`.

## Turning on Stripe (when ready)

Edit `deploy/.env` on the VM: set `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
`STRIPE_WEBHOOK_SECRET`, and the `STRIPE_PRICE_*` ids, then run `deploy.command`
again. Add a Stripe webhook endpoint pointing at
`https://opencard.id/stripe/webhook`.

## Notes

- `deploy/.env` and `deploy/certs/` live only on the VM and are never synced over
  or committed. Rotate the secrets there if they're ever exposed.
- `SEED_DEMO=0` in production, so no demo data is created — just a clean bootstrap
  org so the platform can start. Real customers self-sign-up.
- Data lives in Docker volumes (`db_data`, `uploads_data`). Back these up.

## Branded login on client custom domains

Clients can have a login page carrying their own logo + colors on their own
hostname (e.g. `cards.mullinaxford.com`), brand-wide or per rooftop.

**How it works**

1. In the admin, set the **Branded login domain** on a brand (brand-wide) or a
   rooftop (override). This registers the host in `TenantDomain` (approved).
2. The client adds a **CNAME**: `cards.mullinaxford.com → tenants.opencard.id`
   (an A/AAAA record `tenants.opencard.id` must point at the production VM).
3. On first HTTPS request, Caddy obtains a Let's Encrypt cert on demand, but only
   after the app's `/tls/authorize?domain=` ask endpoint approves the host.
4. The app reads the `Host` header, matches the `TenantDomain`, and renders the
   branded `/admin/login` and `/me/login` (rooftop overrides brand).

**Production requirements (not the current Cloudflare-fronted test box)**

- Ports **80 and 443 must be reachable from the public internet** for the ACME
  HTTP/TLS-ALPN challenge. The test box's firewall allows Cloudflare IPs only, so
  on-demand TLS stays inert there; open 80/443 on the production VM.
- Client domains must resolve **directly to the VM** (not proxied through the
  client's own CDN), or ACME can't validate. If a client insists on fronting with
  their own CDN, they terminate TLS and forward the `Host` header to us instead.
