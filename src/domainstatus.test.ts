import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateDomain, cnameInstruction } from "./domainstatus";

const expected = { cnameTarget: "tenants.opencard.id", ips: ["1.2.3.4"] };

test("verified when CNAME points to our target (case/dot-insensitive)", () => {
  assert.deepEqual(evaluateDomain({ cnames: ["Tenants.OpenCard.id."], addrs: [] }, expected), {
    ok: true,
    reason: "Points to tenants.opencard.id",
  });
});

test("verified when it resolves to our server IP", () => {
  const v = evaluateDomain({ cnames: [], addrs: ["1.2.3.4"] }, expected);
  assert.equal(v.ok, true);
});

test("pending when nothing resolves yet", () => {
  const v = evaluateDomain({ cnames: [], addrs: [] }, expected);
  assert.equal(v.ok, false);
  assert.match(v.reason, /No DNS record/);
});

test("misconfigured when it points somewhere else", () => {
  const v = evaluateDomain({ cnames: ["ghs.googlehosted.com"], addrs: [] }, expected);
  assert.equal(v.ok, false);
  assert.match(v.reason, /googlehosted/);
});

test("cnameInstruction returns the exact record, host normalized", () => {
  assert.deepEqual(cnameInstruction("Cards.MullinaxFord.com"), {
    type: "CNAME",
    name: "cards.mullinaxford.com",
    value: "tenants.opencard.id",
  });
});
