import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { buildApplePass, buildGoogleGenericObject, googleSaveClaims, googleSaveUrl, hexToRgb } from "./wallet";
import { signGoogleJwt } from "./wallet-sign";

const card = {
  slug: "jane-sales",
  firstName: "Jane",
  lastName: "Rivera",
  title: "Sales Consultant",
  company: null,
  ownerEmail: "jane@acme.com",
  primaryColor: "#D8232A",
  phones: [{ label: "Work", value: "555-123-4567" }],
  emails: [{ label: "Work", value: "jane.rivera@acme.com" }],
  location: { phone: "555-000-0000", brand: { name: "Acme Ford", primaryColor: "#111111" } },
};

test("buildApplePass has identifiers, name, contact fields, QR barcode", () => {
  const p = buildApplePass(card, { passTypeId: "pass.com.acme.card", teamId: "TEAM123" }, "https://x/c/jane-sales");
  assert.equal(p.passTypeIdentifier, "pass.com.acme.card");
  assert.equal(p.teamIdentifier, "TEAM123");
  assert.equal(p.serialNumber, "jane-sales");
  assert.equal(p.organizationName, "Acme Ford"); // falls back to brand
  assert.equal(p.storeCard.primaryFields[0].value, "Jane Rivera");
  assert.equal(p.barcodes[0].message, "https://x/c/jane-sales");
  assert.ok(p.storeCard.auxiliaryFields.some((f: any) => f.value === "555-123-4567"));
  assert.equal(p.backgroundColor, "rgb(216,35,42)");
});

test("buildGoogleGenericObject maps title/company/contact + barcode", () => {
  const o = buildGoogleGenericObject(card, "3388000000022", "https://x/c/jane-sales");
  assert.equal(o.id, "3388000000022.jane-sales");
  assert.equal(o.classId, "3388000000022.opencard_contact");
  assert.equal(o.header.defaultValue.value, "Jane Rivera");
  assert.equal(o.cardTitle.defaultValue.value, "Acme Ford");
  assert.equal(o.barcode.value, "https://x/c/jane-sales");
  assert.ok(o.textModulesData.some((t: any) => t.body === "jane.rivera@acme.com"));
});

test("googleSaveClaims + URL shape", () => {
  const claims = googleSaveClaims({ id: "x" }, { serviceEmail: "sa@proj.iam.gserviceaccount.com", origins: ["https://opencard.id"], now: new Date("2026-07-03T00:00:00Z") });
  assert.equal(claims.aud, "google");
  assert.equal(claims.typ, "savetowallet");
  assert.equal(claims.iss, "sa@proj.iam.gserviceaccount.com");
  assert.deepEqual(claims.payload.genericObjects, [{ id: "x" }]);
  assert.match(googleSaveUrl("abc.def.ghi"), /^https:\/\/pay\.google\.com\/gp\/v\/save\/abc\.def\.ghi$/);
});

test("hexToRgb converts or falls back", () => {
  assert.equal(hexToRgb("#D8232A"), "rgb(216,35,42)");
  assert.equal(hexToRgb("nope"), "rgb(31,111,67)");
});

test("signGoogleJwt produces a verifiable RS256 JWT", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const jwt = signGoogleJwt({ iss: "sa", aud: "google", typ: "savetowallet", iat: 1, payload: {} }, pem);
  const [h, pl, sig] = jwt.split(".");
  assert.ok(h && pl && sig);
  // header is RS256
  assert.equal(JSON.parse(Buffer.from(h, "base64url").toString()).alg, "RS256");
  // signature verifies against the public key
  const ok = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${pl}`), publicKey, Buffer.from(sig, "base64url"));
  assert.equal(ok, true);
});
