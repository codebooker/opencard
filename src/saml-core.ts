// Pure SAML helpers — no runtime dependencies (no db, no config, no @node-saml),
// so they are unit-testable in isolation. src/saml.ts wraps these with the
// DB-backed lookups and the actual SAML instance construction.

export type SamlSettings = {
  enabled: boolean;
  entryPoint: string | null;
  idpIssuer: string | null;
  idpCert: string | null;
};

// The canonical host for an org's SSO endpoints. Enterprise SSO needs a stable
// host: a custom domain, else a subdomain under the platform domain, else the
// single-tenant fallback host (the app's own base host) for local/dev.
export function canonicalHost(
  org: { subdomain: string | null; customDomain: string | null },
  platformDomain: string,
  fallbackHost: string
): string | null {
  if (org.customDomain) return org.customDomain.toLowerCase();
  const platform = (platformDomain || "").toLowerCase().replace(/^\.+/, "");
  if (org.subdomain && platform) return `${org.subdomain.toLowerCase()}.${platform}`;
  return fallbackHost ? fallbackHost.toLowerCase() : null;
}

export function samlSpIssuer(host: string): string {
  return `https://${host}/saml/metadata`;
}

export function samlAcsUrl(host: string): string {
  return `https://${host}/me/saml/acs`;
}

// Accept a PEM cert or bare base64 and always return well-formed PEM.
export function normalizeCert(cert: string): string {
  const trimmed = cert.trim();
  if (trimmed.includes("BEGIN CERTIFICATE")) return trimmed;
  const compact = trimmed.replace(/\s+/g, "");
  return `-----BEGIN CERTIFICATE-----\n${compact.match(/.{1,64}/g)?.join("\n") || compact}\n-----END CERTIFICATE-----`;
}

// SSO is usable only when enabled AND the IdP SSO URL + signing cert are present.
export function samlReady(s: {
  enabled: boolean;
  entryPoint: string | null;
  idpCert: string | null;
}): boolean {
  return !!(s.enabled && s.entryPoint && s.idpCert);
}

// Extract a login email from a SAML assertion profile (common attribute names).
export function emailFromSamlProfile(profile: Record<string, unknown>): string | null {
  const email =
    (profile.email as string) ||
    (profile.mail as string) ||
    (profile["urn:oid:0.9.2342.19200300.100.1.3"] as string) ||
    (profile.nameID as string);
  return typeof email === "string" && email.includes("@") ? email.toLowerCase() : null;
}
