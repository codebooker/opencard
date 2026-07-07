// Shared context for the split admin route modules (CQ-05).
// Re-exports the imports + cross-cutting helpers each admin route group needs,
// so a group file imports from here instead of repeating 60+ imports.

import crypto from "crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma, Address } from "../../db";
import { config } from "../../config";
import { clearCookieOptions, cookieOptions } from "../../cookies";
import {
  requireAdmin,
  reqAdmin,
  forbidden,
  loginPage,
  mfaPage,
  forgotPage,
  resetPage,
  invitePage,
  authNoticePage,
} from "../../middleware/auth";
import {
  issueToken,
  peekToken,
  consumeToken,
  createSession,
  findSession,
  revokeSession,
  revokeAllSessions,
  listSessions,
  generateRecoveryCodes,
  hashRecoveryCodes,
  consumeRecoveryCode,
  recoveryCodeCount,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  sha256hex,
} from "../../account";
import { sendMail, postChatWebhook } from "../../notify";
import fs from "fs";
import path from "path";
import { mdToHtml } from "../../md";
import { page, esc } from "../../views/html";
import { uniqueSlug, uniqueAssetSlug } from "../../slug";
import { upload, uploadedUrl } from "../../upload";
import { emitEvent, cardPayload, WEBHOOK_EVENTS, replayDelivery, sendTestEvent } from "../../webhooks";
import { parseOemBrands, parseCtaLines, rooftopCtas, ctasFromJson, mergeCtas } from "../../dealership";
import { buildSignatureModel, renderSignatureHtml, renderSignatureText, normalizeTheme, asLockList } from "../../signature";
import { signatureBlock } from "../../views/signature-view";
import { parseCampaignRoutingLines } from "../../routing";
import { LEAD_STATUSES, canTransition } from "../../leadstatus";
import { isConsole, isPlatformRole, PLATFORM_ROLES, assignableStaffRoles, canManageStaffTarget } from "../../roles";
import { loginBrandingForHost, requestHost } from "../../tenant-resolver";
import { normalizeHost } from "../../branding";
import { parseFieldMapLines } from "../../crmsync";
import { sendTestSync, retrySync } from "../../crmsync-dispatch";
import { isGaId, isGtmId, normalizeCampaignCode } from "../../marketing";
import { resolveRange, conversionPct, sortLeaderboard, buildFunnel, topGroups, ANALYTICS_RANGES } from "../../analytics";
import { computeOrgAnalytics, analyticsCsv, sendDigest } from "../../reports";
import { toCsv } from "../../csv";
import { recordAudit, reqIp } from "../../audit-log";
import { buildOrgExport, purgeOrgData } from "../../data-bundle";
import { exportFilename } from "../../dataexport";
import { parseRetentionDays } from "../../retention";
import { getPlatformConfig, updatePlatformConfig } from "../../platform-config";
import { listBackups, runManualBackup, restoreClientToBackup, withRestoreLock, humanSize } from "../../backups";
import {
  credsForOrg,
  directoryConfigSummary,
  saveDirectoryConfig,
  deleteDirectoryConfig,
  testGraphCreds,
  listDirectoryUsers,
  searchGroups,
  filterByDepartment,
  planImport,
  applyImport,
  onlySelected,
  mapGraphUser,
  planCandidates,
} from "../../dirimport";
import { parseCsv, guessMapping, mapCsvRow, CsvTarget } from "../../csvimport";
import { bucketDays } from "../../charts";
import { buildIdCardPdf } from "../../idcard";
import { presetByKey } from "../../layouts";
import multer from "multer";
import { runWithOrg } from "../../db";
import { uploadDir } from "../../upload";
import { isVertical } from "../../terminology";
import { clean, parseLabeled, parseSocials, parseAddress } from "../../parse";
import { pruneOrgLeads } from "../../retention-prune";

// Compact audit helper bound to the current principal + request.
function audit(
  req: any,
  p: { orgId: string; email: string | null; role: string },
  action: string,
  extra?: { targetType?: string; targetId?: string | null; summary?: string }
) {
  recordAudit({ orgId: p.orgId, actor: { email: p.email, role: p.role }, action, ip: reqIp(req), ...extra });
}
import { promises as dns } from "dns";
import { evaluateDomain, CNAME_TARGET } from "../../domainstatus";

const SERVER_IPS = (process.env.SERVER_IPS || "").split(",").map((s) => s.trim()).filter(Boolean);

// Best-effort DNS lookup for the domains hub (CNAME + A records).
async function resolveDomainDns(host: string): Promise<{ cnames: string[]; addrs: string[] }> {
  const cnames: string[] = [];
  const addrs: string[] = [];
  try {
    (await dns.resolveCname(host)).forEach((c) => cnames.push(c));
  } catch {
    /* no CNAME */
  }
  try {
    (await dns.resolve4(host)).forEach((a) => addrs.push(a));
  } catch {
    /* no A record */
  }
  return { cnames, addrs };
}
const PLATFORM_ROLES_ALL = [...PLATFORM_ROLES, "super_admin"];
import { redirectTargetUrl, offboardCardUpdate, replacementCardData } from "../../turnover";
import { assetTypeLabel } from "../../assets";
import { generateApiKey } from "../../apiauth";
import { sanitizeScopes } from "../../api-scopes";
import { generateScimToken } from "../../scim-auth";
import { getSamlConfigForOrg, samlAcsUrl, samlSpIssuer, orgCanonicalHost } from "../../saml";
import { signEmail, verifyEmail } from "../../selfauth";
import { hashPassword, verifyPassword, generateTotpSecret, totpUri, verifyTotp } from "../../security";
import { qrDataUrl } from "../../qr";
import { qrSvg, parseQrDesign, qrDesignFromForm } from "../../qr-style";
import { currentTerminology } from "../../terminology";
import { defaultOrgId, orgIdForBrand, orgIdForLocation } from "../../tenant";
import { canAdd, orgHasFeature, orgPlanKey, orgUsage, orgAccessState } from "../../entitlements";
import { requiredPlanFor, planFor, PLANS, PLAN_ORDER, isPlanKey, parseSeatLimit, DEFAULT_PLAN, Feature, LimitKey } from "../../plans";
import { validateOutboundUrl } from "../../ssrf";
import { seal } from "../../secretbox";
import { accessSummary } from "../../access";
import { stripe, stripeEnabled } from "../../stripe";
import * as RBAC from "../../rbac";
import * as V from "../../views/admin";

// Plan-gate helpers: reject with a friendly upgrade message.
function limitReached(res: any, what: string) {
  return forbidden(res, `You've reached your plan's ${what} limit. Upgrade your plan to add more.`);
}
async function ensureFeature(res: any, orgId: string, feature: Feature, label: string): Promise<boolean> {
  if (await orgHasFeature(orgId, feature)) return true;
  const need = requiredPlanFor(feature);
  forbidden(res, `${label} isn't included in your plan.${need ? ` It's available on the ${need.label} plan and above.` : ""}`);
  return false;
}

// ---------- helpers ----------
// parseLabeled / parseSocials / parseAddress / clean are shared with the
// self-service routes and live in ../parse.

// Normalize an HTML checkbox group (absent | single string | string[]) to string[].
function asArray(v: any): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (v === undefined || v === null || v === "") return [];
  return [String(v)];
}

// Per-rooftop signature design + governance from the location edit form.
function signatureConfig(b: any) {
  return {
    signatureTheme: normalizeTheme(b.signatureTheme),
    signatureDisclaimer: clean(b.signatureDisclaimer) || null,
    signatureLocks: asLockList(asArray(b.signatureLocks)),
  };
}

// Register/update/clear a branded-login domain for a brand or rooftop, of a given
// kind ("admin" or "user"). `scope` is exactly one of { brandId } or { locationId }.
// Host is normalized; blank clears the domain for that scope+kind. Approved so
// Caddy on-demand TLS may issue a cert.
async function setTenantDomain(
  orgId: string,
  scope: { brandId?: string; locationId?: string },
  kind: "admin" | "user",
  rawHost: string
) {
  const host = normalizeHost(rawHost);
  const base = scope.locationId ? { locationId: scope.locationId } : { brandId: scope.brandId, locationId: null };
  await prisma.tenantDomain.deleteMany({ where: { ...base, kind } });
  if (!host) return;
  await prisma.tenantDomain.upsert({
    where: { host },
    update: { orgId, kind, brandId: scope.brandId ?? null, locationId: scope.locationId ?? null, approved: true },
    create: { host, orgId, kind, brandId: scope.brandId ?? null, locationId: scope.locationId ?? null, approved: true },
  });
}

// Brand-wide signature campaign banner (text + optional link + optional window).
function campaignBanner(b: any) {
  const dt = (v: any) => {
    const s = clean(v);
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };
  return {
    signatureBannerText: clean(b.signatureBannerText) || null,
    signatureBannerHref: clean(b.signatureBannerHref) || null,
    signatureBannerStart: dt(b.signatureBannerStart),
    signatureBannerEnd: dt(b.signatureBannerEnd),
  };
}

export { RBAC };
export { V };

// Shared scoping helpers used by cards, analytics, and leads groups.
export async function accessibleCardIds(p: RBAC.AdminPrincipal): Promise<string[] | null> {
  // null == "no card filter" (every org). Only the platform console sees all;
  // an org-global admin (incl. a platform admin drilled into a client) is scoped
  // to their org via accessibleLocationIds, which already filters by orgId.
  if (RBAC.seesAllOrgs(p)) return null;
  const locIds = await RBAC.accessibleLocationIds(p);
  const cards = await prisma.card.findMany({ where: { locationId: { in: locIds } }, select: { id: true } });
  return cards.map((c) => c.id);
}
export async function leadScopeWhere(p: RBAC.AdminPrincipal) {
  const cardIds = await accessibleCardIds(p);
  if (cardIds === null) return {};
  const locIds = await RBAC.accessibleLocationIds(p);
  const assets = await prisma.asset.findMany({ where: { locationId: { in: locIds } }, select: { id: true } });
  return { OR: [{ cardId: { in: cardIds } }, { assetId: { in: assets.map((a) => a.id) } }] };
}

export {
  ANALYTICS_RANGES, Address, CNAME_TARGET, CsvTarget, DEFAULT_PLAN, Feature, LEAD_STATUSES, LimitKey,
  PLANS, PLAN_ORDER, PLATFORM_ROLES, PLATFORM_ROLES_ALL, Prisma, Router, SERVER_IPS, SESSION_COOKIE,
  SESSION_TTL_MS, WEBHOOK_EVENTS, accessSummary, analyticsCsv, applyImport, asArray, asLockList, assetTypeLabel,
  assignableStaffRoles, audit, authNoticePage, bucketDays, buildFunnel, buildIdCardPdf, buildOrgExport, buildSignatureModel,
  campaignBanner, canAdd, canManageStaffTarget, canTransition, cardPayload, clean, clearCookieOptions, computeOrgAnalytics,
  config, consumeRecoveryCode, consumeToken, conversionPct, cookieOptions, createSession, credsForOrg, crypto,
  ctasFromJson, currentTerminology, defaultOrgId, deleteDirectoryConfig, directoryConfigSummary, dns, emitEvent, ensureFeature,
  esc, evaluateDomain, exportFilename, filterByDepartment, findSession, forbidden, forgotPage, fs,
  generateApiKey, generateRecoveryCodes, generateScimToken, generateTotpSecret, getPlatformConfig, getSamlConfigForOrg, guessMapping, hashPassword,
  hashRecoveryCodes, humanSize, invitePage, isConsole, isGaId, isGtmId, isPlanKey, isPlatformRole,
  isVertical, issueToken, limitReached, listBackups, listDirectoryUsers, listSessions, loginBrandingForHost, loginPage,
  mapCsvRow, mapGraphUser, mdToHtml, mergeCtas, mfaPage, multer, normalizeCampaignCode, normalizeHost,
  normalizeTheme, offboardCardUpdate, onlySelected, orgAccessState, orgCanonicalHost, orgHasFeature, orgIdForBrand, orgIdForLocation,
  orgPlanKey, orgUsage, page, parseAddress, parseCampaignRoutingLines, parseCsv, parseCtaLines, parseFieldMapLines,
  parseLabeled, parseOemBrands, parseQrDesign, parseRetentionDays, parseSeatLimit, parseSocials, path, peekToken,
  planCandidates, planFor, planImport, postChatWebhook, presetByKey, prisma, pruneOrgLeads, purgeOrgData,
  qrDataUrl, qrDesignFromForm, qrSvg, recordAudit, recoveryCodeCount, redirectTargetUrl, renderSignatureHtml, renderSignatureText,
  replacementCardData, replayDelivery, reqAdmin, reqIp, requestHost, requireAdmin, requiredPlanFor, resetPage,
  resolveDomainDns, resolveRange, restoreClientToBackup, retrySync, revokeAllSessions, revokeSession, rooftopCtas, runManualBackup,
  runWithOrg, samlAcsUrl, samlSpIssuer, sanitizeScopes, saveDirectoryConfig, seal, searchGroups, sendDigest,
  sendMail, sendTestEvent, sendTestSync, setTenantDomain, sha256hex, signEmail, signatureBlock, signatureConfig,
  sortLeaderboard, stripe, stripeEnabled, testGraphCreds, toCsv, topGroups, totpUri, uniqueAssetSlug,
  uniqueSlug, updatePlatformConfig, upload, uploadDir, uploadedUrl, validateOutboundUrl, verifyEmail, verifyPassword,
  verifyTotp, withRestoreLock,
};
