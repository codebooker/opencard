import { Router } from "express";
import crypto from "crypto";
import { prisma, runWithOrg } from "../db";
import { config } from "../config";
import { clearCookieOptions, cookieOptions } from "../cookies";
import { upload, uploadedUrl } from "../upload";
import { clean, parseLabeled, parseSocials } from "../parse";
import { emitEvent, cardPayload } from "../webhooks";
import { DEFAULT_SELF_FIELDS } from "../views/widgets";
import { emailFromSamlProfile, getEnabledSamlForOrg } from "../saml";
import { jitProvision } from "../jit";
import { resolveOrgId, orgIdForHost, requestHost, loginBrandingForHost } from "../tenant-resolver";
import { roleFlags, Role } from "../roles";
import { orgHasFeature } from "../entitlements";
import { effectiveSelfFields, asStringArray } from "../roletemplate";
import { rooftopCtas, ctasFromJson, mergeCtas } from "../dealership";
import { buildSignatureModel, renderSignatureHtml, renderSignatureText } from "../signature";
import { signatureBlock } from "../views/signature-view";
import {
  signEmployeeIdentity,
  signOidcContext,
  verifyEmployeeIdentity,
  verifyOidcContext,
  oidcEnabled,
  authorizeUrl,
  exchangeCode,
} from "../selfauth";
import * as V from "../views/selfedit";

export const selfRouter = Router();
const COOKIE = "oc_emp";
const OIDC_ORG_COOKIE = "oc_oidc_org";

function currentIdentity(req: any) {
  return verifyEmployeeIdentity(req.cookies?.[COOKIE]);
}

// Load the org (with SSO settings) that owns the current request's host.
async function orgForRequest(req: any) {
  const orgId = await resolveOrgId(req);
  return prisma.org.findUnique({
    where: { id: orgId },
    select: { id: true, subdomain: true, customDomain: true, samlConfig: true },
  });
}

async function enabledSaml(org: Awaited<ReturnType<typeof orgForRequest>>) {
  if (!org || !(await orgHasFeature(org.id, "sso"))) return null;
  return getEnabledSamlForOrg(org);
}

async function oidcAllowed(orgId: string): Promise<boolean> {
  return (await orgHasFeature(orgId, "selfService")) || (await orgHasFeature(orgId, "sso"));
}

// A card owner's card, scoped to the given org so an IdP on one tenant can't
// assert an email that matches a card in a different tenant.
async function loadOwnCard(email: string, orgId: string) {
  return prisma.card.findFirst({
    where: { ownerEmail: { equals: email, mode: "insensitive" }, active: true, orgId },
    include: { location: { include: { brand: true } }, template: true, dept: true },
  });
}

// Effective self-edit fields: card override -> brand policy -> defaults, minus
// any fields the card's role template locks (governance always wins).
function allowedFields(card: any): string[] {
  const cardSelf = Array.isArray(card.selfEditFields) ? (card.selfEditFields as string[]) : null;
  const brandSelf = Array.isArray(card.location?.brand?.selfEditFields)
    ? (card.location.brand.selfEditFields as string[])
    : null;
  const locked = asStringArray(card.template?.lockedFields);
  return effectiveSelfFields(cardSelf, brandSelf, locked, DEFAULT_SELF_FIELDS);
}

// Branded email-signature block (preview + copy) for the cardholder.
function cardSignatureBlock(card: any): string {
  const dealer = mergeCtas(
    mergeCtas(ctasFromJson(card.dept?.ctas), ctasFromJson(card.template?.roleCtas)),
    rooftopCtas(card.location)
  );
  const ctas = dealer.slice(0, 2).map((c) => ({ label: c.label, href: c.href }));
  const model = buildSignatureModel(card, { cardBaseUrl: config.cardUrl, ctas });
  return signatureBlock(renderSignatureHtml(model), renderSignatureText(model));
}

// ---- sign in ----
selfRouter.get("/login", async (req, res) => {
  const branding = await loginBrandingForHost(requestHost(req));
  if (config.devLogin) return res.send(V.devLoginPage(branding));
  const org = await orgForRequest(req);
  // A workspace's explicit SAML configuration takes precedence over the
  // deployment-wide Entra OIDC fallback.
  if (org && (await enabledSaml(org))) return res.send(V.samlLoginPage(branding));
  if (org && oidcEnabled() && (await oidcAllowed(org.id))) {
    // OIDC callbacks are registered against APP_URL. Start there as well so the
    // state/nonce cookies are sent back even when this login began on a custom
    // domain, while preserving the initiating tenant in signed context.
    return res.redirect(`${config.baseUrl}/me/oidc/start?org=${encodeURIComponent(org.id)}`);
  }
  return res.send(
    V.notConfiguredPage(
      "Self-service sign-in isn't configured yet. Ask your admin to enable SAML SSO or Azure AD SSO.",
      branding
    )
  );
});

selfRouter.get("/oidc/start", async (req, res) => {
  if (!oidcEnabled()) return res.status(404).send("OIDC sign-in is not enabled.");
  const orgId = String(req.query.org || "");
  const org = orgId
    ? await prisma.org.findFirst({
        where: { id: orgId },
        select: { id: true },
      })
    : null;
  if (!org) return res.status(404).send("Workspace not found or unavailable.");

  // Force the authorization cookies onto APP_URL. Without this redirect, a
  // direct request to this route on a branded host would recreate the original
  // cross-domain callback failure.
  const appHost = new URL(config.baseUrl).hostname.toLowerCase();
  if (requestHost(req) !== appHost) {
    return res.redirect(`${config.baseUrl}/me/oidc/start?org=${encodeURIComponent(org.id)}`);
  }

  const state = crypto.randomBytes(24).toString("base64url");
  const nonce = crypto.randomBytes(24).toString("base64url");
  res.cookie("oc_state", state, cookieOptions(10 * 60 * 1000));
  res.cookie("oc_nonce", nonce, cookieOptions(10 * 60 * 1000));
  res.cookie(OIDC_ORG_COOKIE, signOidcContext(org.id), cookieOptions(10 * 60 * 1000));
  return res.redirect(authorizeUrl(state, nonce));
});

selfRouter.get("/auth/callback", async (req, res) => {
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  const storedState = String(req.cookies?.oc_state || "");
  const nonce = String(req.cookies?.oc_nonce || "");
  const orgId = verifyOidcContext(req.cookies?.[OIDC_ORG_COOKIE]);
  res.clearCookie("oc_state", clearCookieOptions());
  res.clearCookie("oc_nonce", clearCookieOptions());
  res.clearCookie(OIDC_ORG_COOKIE, clearCookieOptions());
  if (!code || !state || !storedState || state !== storedState || !nonce || !orgId) {
    return res.status(400).send("Invalid sign-in state.");
  }
  const org = await prisma.org.findFirst({
    where: { id: orgId },
    select: { id: true },
  });
  if (!org || !(await oidcAllowed(org.id))) return res.status(403).send("Workspace not available for sign-in.");
  const email = await exchangeCode(code, nonce);
  if (!email) return res.status(401).send("Sign-in failed.");
  res.cookie(COOKIE, signEmployeeIdentity(email, orgId), cookieOptions(12 * 60 * 60 * 1000));
  res.redirect(await postLoginDest(email, orgId));
});

selfRouter.get("/saml/login", async (req, res) => {
  const org = await orgForRequest(req);
  const enabled = await enabledSaml(org);
  if (!org || !enabled) return res.status(404).send("SAML sign-in is not enabled for this workspace.");
  // RelayState carries the org id so the ACS can resolve the tenant even if the
  // IdP posts back to a shared host.
  const url = await enabled.saml.getAuthorizeUrlAsync(org.id, undefined, {});
  res.redirect(url);
});

selfRouter.post("/saml/acs", async (req, res) => {
  const relay = String(req.body?.RelayState || "");
  // Prefer the org from the host the assertion arrived on; fall back to RelayState.
  const hostOrgId = await orgIdForHost(requestHost(req));
  if (hostOrgId && relay && hostOrgId !== relay) {
    return res.status(400).send("SAML tenant mismatch.");
  }
  const orgId = hostOrgId || relay || null;
  const org = orgId
    ? await prisma.org.findUnique({
        where: { id: orgId },
        select: { id: true, subdomain: true, customDomain: true, samlConfig: true },
      })
    : null;
  const enabled = org && (await orgHasFeature(org.id, "sso")) && (await getEnabledSamlForOrg(org));
  if (!org || !enabled) return res.status(404).send("SAML sign-in is not enabled.");
  try {
    const result = await enabled.saml.validatePostResponseAsync({
      SAMLResponse: String(req.body?.SAMLResponse || ""),
      RelayState: relay,
    });
    if (!result.profile) return res.status(401).send("SAML sign-in failed.");
    const email = emailFromSamlProfile(result.profile);
    if (!email) return res.status(401).send("SAML response did not include an email address.");
    // JIT provisioning (opt-in): first sign-in creates the card instead of
    // "no card assigned". Never blocks the sign-in itself.
    if (org.samlConfig?.jitEnabled) {
      await jitProvision(org.id, result.profile as unknown as Record<string, unknown>, email);
    }
    res.cookie(COOKIE, signEmployeeIdentity(email, org.id), cookieOptions(12 * 60 * 60 * 1000));
    res.redirect(await postLoginDest(email, org.id));
  } catch {
    res.status(401).send("SAML sign-in failed.");
  }
});

selfRouter.post("/devlogin", async (req, res) => {
  if (!config.devLogin) return res.status(404).send("Not found");
  const email = String(req.body?.email || "").toLowerCase().trim();
  if (!email) return res.redirect("/me/login");
  const orgId = await resolveOrgId(req);
  res.cookie(COOKIE, signEmployeeIdentity(email, orgId), cookieOptions(12 * 60 * 60 * 1000));
  res.redirect(await postLoginDest(email, orgId));
});

// Admins land in /admin; everyone else in their own card. The admin match is
// scoped to the signing-in org (or platform-level admins) so an IdP can't grant
// another tenant's admin access; platform owners are allowed from any host.
async function postLoginDest(email: string, orgId: string): Promise<string> {
  const au = await prisma.adminUser.findUnique({ where: { email } });
  if (au && au.active && (au.orgId === orgId || roleFlags(au.role as Role).platform)) {
    return "/admin";
  }
  return "/me";
}

selfRouter.get("/logout", (_req, res) => {
  res.clearCookie(COOKIE, clearCookieOptions());
  res.redirect("/me/login");
});

// ---- view / edit own card ----
selfRouter.get("/", async (req, res) => {
  const identity = currentIdentity(req);
  if (!identity) return res.redirect("/me/login");
  const card = await loadOwnCard(identity.email, identity.orgId);
  if (!card) return res.send(V.noCardPage(identity.email));
  res.send(V.selfEditPage(card, new Set(allowedFields(card)), identity.email, req.query.saved === "1", cardSignatureBlock(card)));
});

const selfUploads = upload.fields([{ name: "photoFile", maxCount: 1 }]);

selfRouter.post("/", selfUploads, async (req, res) => {
  const identity = currentIdentity(req);
  if (!identity) return res.redirect("/me/login");
  const card = await loadOwnCard(identity.email, identity.orgId);
  if (!card) return res.status(404).send("No card");

  const allowed = new Set(allowedFields(card));
  const b = req.body || {};
  const data: any = {};

  if (allowed.has("name")) {
    if (b.firstName) data.firstName = String(b.firstName);
    if (b.lastName) data.lastName = String(b.lastName);
    data.prefix = clean(b.prefix);
  }
  if (allowed.has("name") || allowed.has("pronouns")) data.pronouns = clean(b.pronouns);
  if (allowed.has("title")) data.title = clean(b.title);
  if (allowed.has("department")) data.department = clean(b.department);
  if (allowed.has("bio")) data.bio = clean(b.bio);
  if (allowed.has("photo")) {
    const up = uploadedUrl(req, "photoFile");
    data.photoUrl = up || clean(b.photoUrl);
  }
  if (allowed.has("phones")) data.phones = parseLabeled(b.phones);
  if (allowed.has("emails")) data.emails = parseLabeled(b.emails);
  if (allowed.has("websites")) data.websites = parseLabeled(b.websites);
  if (allowed.has("socials")) data.socials = parseSocials(b.socials);

  // Employees only ever touch their own card; the update runs under RLS so the
  // database also guarantees it can't write outside the card's org.
  const updated = await runWithOrg(card.orgId, (db) => db.card.update({ where: { id: card.id }, data }));
  emitEvent(updated.orgId, "card.updated", cardPayload(updated));
  res.redirect("/me?saved=1");
});
