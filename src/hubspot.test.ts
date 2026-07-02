import { test } from "node:test";
import assert from "node:assert/strict";
import { splitName, hubspotProperties, hubspotEmail, hubspotContactByEmailUrl } from "./hubspot";

test("splitName splits full name, single token = firstname only", () => {
  assert.deepEqual(splitName("Jane Buyer"), { firstname: "Jane", lastname: "Buyer" });
  assert.deepEqual(splitName("Jane Q Buyer"), { firstname: "Jane Q", lastname: "Buyer" });
  assert.deepEqual(splitName("Cher"), { firstname: "Cher" });
  assert.deepEqual(splitName("  "), {});
  assert.deepEqual(splitName(null), {});
});

test("hubspotProperties default maps name/email/phone/company, drops nulls", () => {
  const props = hubspotProperties(
    { name: "Jane Buyer", email: "jane@example.com", phone: "555-1212", company: null },
    {}
  );
  assert.deepEqual(props, {
    firstname: "Jane",
    lastname: "Buyer",
    email: "jane@example.com",
    phone: "555-1212",
  });
});

test("hubspotProperties honors a custom map (target = HubSpot property) + coerces types", () => {
  const props = hubspotProperties(
    { name: "Jane", email: "j@x.com", tradeIn: true, vehicleInterest: "F-150" },
    { email: "email", has_trade: "tradeIn", vehicle_of_interest: "vehicleInterest", missing: "serviceNeed" }
  );
  assert.deepEqual(props, { email: "j@x.com", has_trade: "true", vehicle_of_interest: "F-150" });
  assert.ok(!("missing" in props)); // null source dropped
});

test("hubspotEmail resolves from props then lead", () => {
  assert.equal(hubspotEmail({ email: "lead@x.com" }, { email: "prop@x.com" }), "prop@x.com");
  assert.equal(hubspotEmail({ email: "lead@x.com" }, {}), "lead@x.com");
  assert.equal(hubspotEmail({}, {}), null);
});

test("hubspotContactByEmailUrl encodes the email + idProperty", () => {
  assert.equal(
    hubspotContactByEmailUrl("a+b@x.com"),
    "https://api.hubapi.com/crm/v3/objects/contacts/a%2Bb%40x.com?idProperty=email"
  );
});
