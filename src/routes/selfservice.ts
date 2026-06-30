import { Router } from "express";
import crypto from "crypto";
import { prisma, runWithOrg } from "../db";
import { config } from "../config";
import { clearCookieOptions, cookieOptions } from "../cookies";
import { upload, uploadedUrl } from "../upload";
import { clean, parseLabeled, parseSocials } from "../parse";
import { emitEvent, cardPayload } from "../webhooks";
import { DEFAULT_SELF_FIELDS } from "../views/widgets";
import { emailFromSamlProfile, getEnabledSaml } from "../saml";
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

async function loadOwnCard(email: string) {
  return prisma.card.findFirst({
    where: { ownerEmail: { equals: email, mode: "insensitive" }, active: true },
    include: { location: { include: { brand: true } }, template: true },
  });
}

function allowedFields(card: any): string[] {
  if (Array.isArray(card.selfEditFields)) return card.selfEditFields as string[];
  if (Array.isArray(card.location?.brand?.selfEditFields)) return card.location.brand.selfEditFields as string[];
  return DEFAULT_SELF_FIELDS;
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
  if (config.devLogin) return res.send(V.devLoginPage());
  const saml = await getEnabledSaml();
  if (saml) return res.send(V.samlLoginPage());
  return res.send(
    V.notConfiguredPage(
      "Self-service sign-in isn't configured yet. Ask your admin to enable SAML SSO or Azure AD SSO."
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
  res.redirect(await postLoginDest(email));
});

selfRouter.get("/saml/login", async (_req, res) => {
  const enabled = await getEnabledSaml();
  if (!enabled) return res.status(404).send("SAML sign-in is not enabled.");
  const url = await enabled.saml.getAuthorizeUrlAsync("", undefined, {});
  res.redirect(url);
});

selfRouter.post("/saml/acs", async (req, res) => {
  const enabled = await getEnabledSaml();
  if (!enabled) return res.status(404).send("SAML sign-in is not enabled.");
  try {
    const result = await enabled.saml.validatePostResponseAsync({
      SAMLResponse: String(req.body?.SAMLResponse || ""),
      RelayState: String(req.body?.RelayState || ""),
    });
    if (!result.profile) return res.status(401).send("SAML sign-in failed.");
    const email = emailFromSamlProfile(result.profile);
    if (!email) return res.status(401).send("SAML response did not include an email address.");
    res.cookie(COOKIE, signEmail(email), cookieOptions(12 * 60 * 60 * 1000));
    res.redirect(await postLoginDest(email));
  } catch {
    res.status(401).send("SAML sign-in failed.");
  }
});

selfRouter.post("/devlogin", async (req, res) => {
  if (!config.devLogin) return res.status(404).send("Not found");
  const email = String(req.body?.email || "").toLowerCase().trim();
  if (!email) return res.redirect("/me/login");
  res.cookie(COOKIE, signEmail(email), cookieOptions(12 * 60 * 60 * 1000));
  res.redirect(await postLoginDest(email));
});

// Admins land in /admin; everyone else in their own card.
async function postLoginDest(email: string): Promise<string> {
  const au = await prisma.adminUser.findUnique({ where: { email } });
  return au && au.active ? "/admin" : "/me";
}

selfRouter.get("/logout", (_req, res) => {
  res.clearCookie(COOKIE, clearCookieOptions());
  res.redirect("/me/login");
});

// ---- view / edit own card ----
selfRouter.get("/", async (req, res) => {
  const email = currentEmail(req);
  if (!email) return res.redirect("/me/login");
  const card = await loadOwnCard(email);
  if (!card) return res.send(V.noCardPage(email));
  res.send(V.selfEditPage(card, new Set(allowedFields(card)), email, req.query.saved === "1"));
});

const selfUploads = upload.fields([{ name: "photoFile", maxCount: 1 }]);

selfRouter.post("/", selfUploads, async (req, res) => {
  const email = currentEmail(req);
  if (!email) return res.redirect("/me/login");
  const card = await loadOwnCard(email);
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
