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
import { resolveOrgId, orgIdForHost, requestHost, loginBrandingForHost } from "../tenant-resolver";
import { roleFlags, Role } from "../roles";
import { effectiveSelfFields, asStringArray } from "../roletemplate";
import { rooftopCtas, ctasFromJson, mergeCtas } from "../dealership";
import { buildSignatureModel, renderSignatureHtml, renderSignatureText } from "../signature";
import { signatureBlock } from "../views/signature-view";
import {
  signEmail,
  verifyEmail,
  oidcEnabled,
  authorizeUrl,
  exchangeCode,
} from "../selfauth";
import * as V from "../views/selfedit";

export const selfRouter = Router();
const COOKIE = "oc_emp";

function currentEmail(req: any): string | null {
  return verifyEmail(req.cookies?.[COOKIE]);
}

// Load the org (with SSO settings) that owns the current request's host.
async function orgForRequest(req: any) {
  const orgId = await resolveOrgId(req);
  return prisma.org.findUnique({
    where: { id: orgId },
    select: { id: true, subdomain: true, customDomain: true, samlConfig: true },
  });
}

// A card owner's card, scoped to the given org so an IdP on one tenant can't
// assert an email that matches a card in a different tenant.
async function loadOwnCard(email: string, orgId: string) {
  return prisma.card.findFirst({
    where: { ownerEmail: { equals: email, mode: "insensitive" }, active: true, orgId, org: { suspended: false } },
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
  if (oidcEnabled()) {
    const state = crypto.randomBytes(12).toString("hex");
    const nonce = crypto.randomBytes(16).toString("hex");
    res.cookie("oc_state", state, cookieOptions(10 * 60 * 1000));
    res.cookie("oc_nonce", nonce, cookieOptions(10 * 60 * 1000));
    return res.redirect(authorizeUrl(state, nonce));
  }
  const branding = await loginBrandingForHost(requestHost(req));
  if (config.devLogin) return res.send(V.devLoginPage(branding));
  const org = await orgForRequest(req);
  if (org && (await getEnabledSamlForOrg(org))) return res.send(V.samlLoginPage(branding));
  return res.send(
    V.notConfiguredPage(
      "Self-service sign-in isn't configured yet. Ask your admin to enable SAML SSO or Azure AD SSO.",
      branding
    )
  );
});

selfRouter.get("/auth/callback", async (req, res) => {
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  if (!code || !state || state !== req.cookies?.oc_state) return res.status(400).send("Invalid sign-in state.");
  const nonce = String(req.cookies?.oc_nonce || "");
  res.clearCookie("oc_state", clearCookieOptions());
  res.clearCookie("oc_nonce", clearCookieOptions());
  if (!nonce) return res.status(400).send("Invalid sign-in state.");
  const email = await exchangeCode(code, nonce);
  if (!email) return res.status(401).send("Sign-in failed.");
  res.cookie(COOKIE, signEmail(email), cookieOptions(12 * 60 * 60 * 1000));
  res.redirect(await postLoginDest(email, await resolveOrgId(req)));
});

selfRouter.get("/saml/login", async (req, res) => {
  const org = await orgForRequest(req);
  const enabled = org && (await getEnabledSamlForOrg(org));
  if (!org || !enabled) return res.status(404).send("SAML sign-in is not enabled for this workspace.");
  // RelayState carries the org id so the ACS can resolve the tenant even if the
  // IdP posts back to a shared host.
  const url = await enabled.saml.getAuthorizeUrlAsync(org.id, undefined, {});
  res.redirect(url);
});

selfRouter.post("/saml/acs", async (req, res) => {
  const relay = String(req.body?.RelayState || "");
  // Prefer the org from the host the assertion arrived on; fall back to RelayState.
  const orgId = (await orgIdForHost(requestHost(req))) || relay || null;
  const org = orgId
    ? await prisma.org.findUnique({
        where: { id: orgId },
        select: { id: true, subdomain: true, customDomain: true, samlConfig: true },
      })
    : null;
  const enabled = org && (await getEnabledSamlForOrg(org));
  if (!org || !enabled) return res.status(404).send("SAML sign-in is not enabled.");
  try {
    const result = await enabled.saml.validatePostResponseAsync({
      SAMLResponse: String(req.body?.SAMLResponse || ""),
      RelayState: relay,
    });
    if (!result.profile) return res.status(401).send("SAML sign-in failed.");
    const email = emailFromSamlProfile(result.profile);
    if (!email) return res.status(401).send("SAML response did not include an email address.");
    res.cookie(COOKIE, signEmail(email), cookieOptions(12 * 60 * 60 * 1000));
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
  res.cookie(COOKIE, signEmail(email), cookieOptions(12 * 60 * 60 * 1000));
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
  const email = currentEmail(req);
  if (!email) return res.redirect("/me/login");
  const card = await loadOwnCard(email, await resolveOrgId(req));
  if (!card) return res.send(V.noCardPage(email));
  res.send(V.selfEditPage(card, new Set(allowedFields(card)), email, req.query.saved === "1", cardSignatureBlock(card)));
});

const selfUploads = upload.fields([{ name: "photoFile", maxCount: 1 }]);

selfRouter.post("/", selfUploads, async (req, res) => {
  const email = currentEmail(req);
  if (!email) return res.redirect("/me/login");
  const card = await loadOwnCard(email, await resolveOrgId(req));
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
  emitEvent("card.updated", cardPayload(updated));
  res.redirect("/me?saved=1");
});
