import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransition, nextStatuses, normalizeContact, findDuplicate } from "./leadstatus";

test("canTransition enforces the state machine", () => {
  assert.equal(canTransition("new", "sent"), true);
  assert.equal(canTransition("new", "synced"), false); // must go via sent
  assert.equal(canTransition("sent", "synced"), true);
  assert.equal(canTransition("sent", "failed"), true);
  assert.equal(canTransition("failed", "sent"), true); // retry
  assert.equal(canTransition("synced", "sent"), false);
  assert.equal(canTransition("new", "archived"), true);
  assert.equal(canTransition("archived", "new"), true); // un-archive
  assert.equal(canTransition("new", "new"), false); // no self
  assert.equal(canTransition("new", "bogus"), false);
});

test("nextStatuses lists allowed targets", () => {
  assert.deepEqual(nextStatuses("sent"), ["synced", "failed", "archived"]);
  assert.deepEqual(nextStatuses("bogus"), []);
});

test("normalizeContact lowercases email + strips phone to last 10 digits", () => {
  assert.deepEqual(normalizeContact("Jane@X.com", "+1 (555) 123-4567"), {
    email: "jane@x.com",
    phone: "5551234567",
  });
  assert.deepEqual(normalizeContact("not-email", "123"), { email: null, phone: null });
  assert.deepEqual(normalizeContact(null, null), { email: null, phone: null });
});

test("findDuplicate matches on email or phone across formats", () => {
  const existing = [
    { id: "a", email: "old@x.com", phone: "555-000-1111" },
    { id: "b", email: "jane@x.com", phone: "(555) 123-4567" },
  ];
  // email match (different case)
  assert.equal(findDuplicate({ email: "JANE@x.com" }, existing), "b");
  // phone match (different format, +1 prefix)
  assert.equal(findDuplicate({ phone: "+1 555 123 4567" }, existing), "b");
  // no match
  assert.equal(findDuplicate({ email: "new@x.com", phone: "999-999-9999" }, existing), null);
  // empty candidate
  assert.equal(findDuplicate({}, existing), null);
});
