import { test } from "node:test";
import assert from "node:assert/strict";
import { devLoginEnabled, integerSetting, originSetting } from "./config-core";

test("integerSetting validates whole numbers and bounds", () => {
  assert.equal(integerSetting(undefined, 7, "PORT", 1, 10), 7);
  assert.equal(integerSetting(" 3 ", 7, "PORT", 1, 10), 3);
  assert.throws(() => integerSetting("3.5", 7, "PORT", 1, 10), /PORT/);
  assert.throws(() => integerSetting("11", 7, "PORT", 1, 10), /PORT/);
  assert.throws(() => integerSetting("nope", 7, "PORT", 1, 10), /PORT/);
});

test("originSetting normalizes origins and rejects unsafe/misleading shapes", () => {
  assert.equal(originSetting("https://Example.com/", "APP_URL"), "https://example.com");
  assert.equal(originSetting("http://localhost:3000", "APP_URL"), "http://localhost:3000");
  assert.throws(() => originSetting("javascript:alert(1)", "APP_URL"), /APP_URL/);
  assert.throws(() => originSetting("https://user:pass@example.com", "APP_URL"), /APP_URL/);
  assert.throws(() => originSetting("https://example.com/app", "APP_URL"), /APP_URL/);
  assert.throws(() => originSetting("https://example.com/?x=1", "APP_URL"), /APP_URL/);
});

test("email-only developer login requires both explicit demo switches", () => {
  assert.equal(devLoginEnabled({}), false);
  assert.equal(devLoginEnabled({ SELF_SERVICE_DEV_LOGIN: "1" }), false);
  assert.equal(devLoginEnabled({ SEED_DEMO: "1" }), false);
  assert.equal(devLoginEnabled({ SELF_SERVICE_DEV_LOGIN: "1", SEED_DEMO: "1" }), true);
});
