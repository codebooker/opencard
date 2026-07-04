import crypto from "crypto";
import { config } from "./config";

// Application-level encryption for small secrets that must be RECOVERABLE
// (unlike passwords/API keys, which are hashed): e.g. a tenant's Azure client
// secret, which we must replay to Microsoft's token endpoint. AES-256-GCM with
// a key derived from SESSION_SECRET — so a database dump alone doesn't leak
// tenant credentials; an attacker needs the app environment too.

function key(): Buffer {
  return crypto.createHash("sha256").update(`opencard-secretbox:${config.sessionSecret}`).digest();
}

export function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${Buffer.concat([iv, tag, ct]).toString("base64")}`;
}

// Returns null on tamper/corruption/wrong key rather than throwing — callers
// treat that as "not configured" and re-prompt for the secret.
export function open(sealed: string): string | null {
  try {
    if (!sealed.startsWith("v1:")) return null;
    const raw = Buffer.from(sealed.slice(3), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
