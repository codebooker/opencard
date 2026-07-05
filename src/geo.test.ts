import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeIp, geoFor, geoLabel, geoFields } from "./geo";

test("normalizeIp unwraps mapped IPv4 and trims", () => {
  assert.equal(normalizeIp("::ffff:8.8.8.8"), "8.8.8.8");
  assert.equal(normalizeIp(" 1.2.3.4 "), "1.2.3.4");
  assert.equal(normalizeIp(""), null);
  assert.equal(normalizeIp(null), null);
});

test("geoFor: private and loopback ranges resolve to null", () => {
  assert.equal(geoFor("127.0.0.1"), null);
  assert.equal(geoFor("10.1.2.3"), null);
  assert.equal(geoFor("192.168.0.10"), null);
  assert.equal(geoFor("172.20.5.5"), null);
  assert.equal(geoFor("::1"), null);
});

test("geoFor: public IP yields at least a country", () => {
  const g = geoFor("8.8.8.8");
  assert.ok(g);
  assert.equal(g!.country, "US");
});

test("geoLabel joins present parts", () => {
  assert.equal(geoLabel({ city: "Austin", region: "TX", country: "US" }), "Austin, TX, US");
  assert.equal(geoLabel({ city: null, region: null, country: "FR" }), "FR");
  assert.equal(geoLabel(null), "");
});

test("geoFields returns nullable columns ready for insert", () => {
  const f = geoFields("127.0.0.1");
  assert.deepEqual(f, { geoCity: null, geoRegion: null, geoCountry: null });
  const g = geoFields("8.8.8.8");
  assert.equal(g.geoCountry, "US");
});
