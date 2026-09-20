export function integerSetting(
  raw: string | undefined,
  fallback: number,
  name: string,
  min: number,
  max: number
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

// These settings are origins, not arbitrary URLs: route/cookie/SSO construction
// assumes the application is mounted at `/` and that no credentials/query/hash
// are present.
export function originSetting(raw: string, name: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid http:// or https:// origin.`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must be a valid http:// or https:// origin with no path, credentials, query, or hash.`);
  }
  return url.origin;
}

// Email-only sign-in impersonates card owners. Permit it only when this is
// explicitly a disposable demo installation, never by one stray setting.
export function devLoginEnabled(env: { SELF_SERVICE_DEV_LOGIN?: string; SEED_DEMO?: string }): boolean {
  return env.SELF_SERVICE_DEV_LOGIN === "1" && env.SEED_DEMO === "1";
}
