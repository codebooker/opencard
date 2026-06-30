import { SAML, ValidateInResponseTo, Profile } from "@node-saml/node-saml";
import { prisma } from "./db";
import { config } from "./config";

const CONFIG_ID = "default";

export function samlIssuer(): string {
  return `${config.baseUrl}/saml/opencard`;
}

export function samlAcsUrl(): string {
  return `${config.baseUrl}/me/saml/acs`;
}

export async function getSamlConfig() {
  return prisma.samlConfig.upsert({
    where: { id: CONFIG_ID },
    create: { id: CONFIG_ID, enabled: false, issuer: samlIssuer() },
    update: {},
  });
}

function normalizeCert(cert: string): string {
  const trimmed = cert.trim();
  if (trimmed.includes("BEGIN CERTIFICATE")) return trimmed;
  const compact = trimmed.replace(/\s+/g, "");
  return `-----BEGIN CERTIFICATE-----\n${compact.match(/.{1,64}/g)?.join("\n") || compact}\n-----END CERTIFICATE-----`;
}

export function samlReady(settings: {
  enabled: boolean;
  entryPoint: string | null;
  idpCert: string | null;
}): boolean {
  return !!(settings.enabled && settings.entryPoint && settings.idpCert);
}

export async function getEnabledSaml() {
  const settings = await getSamlConfig();
  if (!samlReady(settings)) return null;
  return {
    settings,
    saml: new SAML({
      entryPoint: settings.entryPoint!,
      idpCert: normalizeCert(settings.idpCert!),
      issuer: settings.issuer || samlIssuer(),
      callbackUrl: samlAcsUrl(),
      audience: settings.issuer || samlIssuer(),
      idpIssuer: settings.idpIssuer || undefined,
      identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
      acceptedClockSkewMs: 120000,
      maxAssertionAgeMs: 5 * 60 * 1000,
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: false,
      validateInResponseTo: ValidateInResponseTo.always,
    }),
  };
}

export function emailFromSamlProfile(profile: Profile): string | null {
  const email =
    profile.email ||
    profile.mail ||
    profile["urn:oid:0.9.2342.19200300.100.1.3"] ||
    profile.nameID;
  return typeof email === "string" && email.includes("@") ? email.toLowerCase() : null;
}
