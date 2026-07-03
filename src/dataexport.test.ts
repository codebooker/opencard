import { test } from "node:test";
import assert from "node:assert/strict";
import { exportFilename, stripKeys, stripRows } from "./dataexport";

test("exportFilename slugs the org + dates it", () => {
  assert.equal(exportFilename("Mullinax Ford!", new Date("2026-07-02T10:00:00Z")), "opencard-export-mullinax-ford-2026-07-02.json");
  assert.equal(exportFilename("", new Date("2026-01-05T00:00:00Z")), "opencard-export-org-2026-01-05.json");
});

test("stripKeys removes secret keys, keeps the rest", () => {
  const out = stripKeys({ id: "1", name: "Acme", scimTokenHash: "sekret", stripeCustomerId: "cus_x" }, ["scimTokenHash", "stripeCustomerId"]);
  assert.deepEqual(out, { id: "1", name: "Acme" });
  assert.deepEqual(stripKeys(null, ["x"]), {});
});

test("stripRows applies to each row", () => {
  const rows = stripRows([{ id: "a", token: "t1" }, { id: "b", token: "t2" }], ["token"]);
  assert.deepEqual(rows, [{ id: "a" }, { id: "b" }]);
  assert.deepEqual(stripRows(null, ["x"]), []);
});
