import { SAML, ValidateInResponseTo, Profile } from "@node-saml/node-saml";
import { prisma } from "./db";
import { config } from "./config";
import {
  SamlSettings,
  canonicalHost,
  samlSpIssuer,
  samlAcsUrl,
  normalizeCert,
  samlReady,
  emailFromSamlProfile as emailFromProfileCore,
} from "./saml-core";

export type { SamlSettings } from "./saml-core";
export { samlSpIssuer, samlAcsUrl, samlReady, normalizeCert } from "./saml-core";

export type OrgAddressing = {
  id: string;
  subdomain: string | null;
  customDomain: string | null;
  samlConfig?: SamlSettings | null;
};

function baseHost(): string {
  try {
    return new URL(config.baseUrl).host.toLowerCase();
  } catch {
    return "";
  }
}

// Canonical host for an org, using the platform domain + base-URL fallback.
export function orgCanonicalHost(org: {
  subdomain: string | null;
  customDomain: string | null;
}): string | null {
  return canonicalHost(org, process.env.PLATFORM_DOMAIN || "", baseHost());
}

export async function getSamlConfigForOrg(orgId: string) {
  return prisma.samlConfig.findUnique({ where: { orgId } });
}

// Construct a SAML instance for an org, with SP endpoints bound to `host`.
export function buildSamlForOrg(settings: SamlSettings, host: string): SAML {
  const issuer = samlSpIssuer(host);
  return new SAML({
    entryPoint: settings.entryPoint!,
    idpCert: normalizeCert(settings.idpCert!),
    issuer,
    callbackUrl: samlAcsUrl(host),
    audience: issuer,
    idpIssuer: settings.idpIssuer || undefined,
    identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    acceptedClockSkewMs: 120000,
    maxAssertionAgeMs: 5 * 60 * 1000,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    // Stateless per-request SAML instances can't share an InResponseTo cache, so
    // we don't require it. Replay/injection protection still comes from assertion
    // signing, audience restriction, and assertion-age limits above.
    validateInResponseTo: ValidateInResponseTo.never,
  });
}

// Resolve + build the enabled SAML for an org. Returns null when SSO isn't ready
// or the org has no canonical host to bind endpoints to.
export async function getEnabledSamlForOrg(
  org: OrgAddressing
): Promise<{ settings: SamlSettings; saml: SAML; host: string } | null> {
  const settings = org.samlConfig ?? (await getSamlConfigForOrg(org.id));
  if (!settings || !samlReady(settings)) return null;
  const host = orgCanonicalHost(org);
  if (!host) return null;
  return { settings, saml: buildSamlForOrg(settings, host), host };
}

export function emailFromSamlProfile(profile: Profile): string | null {
  return emailFromProfileCore(profile as unknown as Record<string, unknown>);
}
