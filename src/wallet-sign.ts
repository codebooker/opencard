import crypto from "crypto";

// Sign a "Save to Google Wallet" JWT (RS256) with the service-account private key
// (PEM). Deterministic given inputs; unit-tested against a generated key.
export function signGoogleJwt(claims: Record<string, any>, privateKeyPem: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const sig = crypto.sign("RSA-SHA256", Buffer.from(signingInput), privateKeyPem).toString("base64url");
  return `${signingInput}.${sig}`;
}

// NOTE on Apple Wallet: a real installable .pkpass requires an Apple Pass Type ID
// certificate + private key + the Apple WWDR intermediate. Packaging (pass.json +
// SHA1 manifest + a PKCS#7 detached signature via openssl + a zip) is only wired
// once those certs are provided (see wallet config). The pass.json model is built
// + tested in wallet.ts; the endpoint reports "not configured" until certs exist.
