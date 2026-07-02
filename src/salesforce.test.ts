import { test } from "node:test";
import assert from "node:assert/strict";
import { salesforceFields, salesforceBody, salesforceUrl, SALESFORCE_WEBTOLEAD_URL } from "./salesforce";

test("salesforceFields default: name split, required last_name + company fallback", () => {
  const f = salesforceFields({ name: "Jane Buyer", email: "jane@x.com", phone: "555-1212" }, {});
  assert.equal(f.first_name, "Jane");
  assert.equal(f.last_name, "Buyer");
  assert.equal(f.email, "jane@x.com");
  assert.equal(f.phone, "555-1212");
  assert.equal(f.company, "Unknown"); // required by Salesforce -> placeholder
});

test("salesforceFields single-name falls back last_name to the name; keeps company", () => {
  const f = salesforceFields({ name: "Cher", company: "Acme" }, {});
  assert.equal(f.first_name, "Cher");
  assert.equal(f.last_name, "Cher");
  assert.equal(f.company, "Acme");
});

test("salesforceFields honors a custom map (target = SF field), coerces + drops null", () => {
  const f = salesforceFields(
    { name: "Jane", email: "j@x.com", tradeIn: true, serviceNeed: null },
    { email: "email", "00Ncustom": "tradeIn", svc: "serviceNeed" }
  );
  assert.deepEqual(f, { email: "j@x.com", "00Ncustom": "1" });
});

test("salesforceBody url-encodes oid + fields", () => {
  const body = salesforceBody({ name: "Jane Buyer", email: "a b@x.com" }, "00Dxx0000001", { email: "email", last_name: "name" });
  const p = new URLSearchParams(body);
  assert.equal(p.get("oid"), "00Dxx0000001");
  assert.equal(p.get("email"), "a b@x.com");
  assert.equal(p.get("last_name"), "Jane Buyer");
});

test("salesforceUrl uses override or the standard endpoint", () => {
  assert.equal(salesforceUrl("https://test.salesforce.com/x"), "https://test.salesforce.com/x");
  assert.equal(salesforceUrl(""), SALESFORCE_WEBTOLEAD_URL);
  assert.equal(salesforceUrl(null), SALESFORCE_WEBTOLEAD_URL);
});
