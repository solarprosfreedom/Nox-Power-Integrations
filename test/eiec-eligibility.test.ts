import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { eiecEmailRecipients, formatEiecResultEmail } from "../src/lib/eiec/email";
import { addressMatchesId, parseGptAddressJson } from "../src/lib/eiec/gpt-address";
import { isIllinoisSellingMarket } from "../src/lib/eiec/illinois-market";

describe("isIllinoisSellingMarket", () => {
  test("matches state_code IL", () => {
    assert.equal(isIllinoisSellingMarket({ state_code: "IL" }), true);
  });

  test("skips other states", () => {
    assert.equal(isIllinoisSellingMarket({ state_code: "TX" }), false);
  });
});

describe("eiecEmailRecipients", () => {
  test("always includes admin@noxpwr.com", () => {
    assert.deepEqual(eiecEmailRecipients(), ["noxpwr@gmail.com", "admin@noxpwr.com"]);
    assert.deepEqual(eiecEmailRecipients("noxpwr@gmail.com"), [
      "noxpwr@gmail.com",
      "admin@noxpwr.com",
    ]);
    assert.ok(eiecEmailRecipients("admin@noxpwr.com").includes("admin@noxpwr.com"));
  });
});

describe("formatEiecResultEmail", () => {
  test("includes eligibility and ID address match", () => {
    assert.equal(
      formatEiecResultEmail({ name: "Casey Muci", eligible: false, addressMatchesId: false }),
      "Name of rep: Casey Muci\nIllinois Eligible: no\nAddress matches ID: no",
    );
    assert.match(
      formatEiecResultEmail({ name: "Jane Doe", eligible: true, addressMatchesId: true }),
      /Address matches ID: yes/,
    );
    assert.match(formatEiecResultEmail({ name: "Jane Doe", eligible: true }), /Address matches ID: n\/a/);
  });
});

describe("addressMatchesId", () => {
  test("matches issuing state to printed address state", () => {
    assert.equal(addressMatchesId("IL", "Illinois"), true);
    assert.equal(addressMatchesId("CA", "IL"), false);
    assert.equal(addressMatchesId("", "IL"), null);
  });
});

describe("parseGptAddressJson", () => {
  test("reads fenced JSON", () => {
    const parsed = parseGptAddressJson(
      "```json\n{\"readable\":true,\"issued_state\":\"WY\",\"street\":\"314 Cottonwood Dr\",\"city\":\"Mountain View\",\"state\":\"WY\",\"zip\":\"82939\",\"formatted\":\"314 Cottonwood Dr, Mountain View, WY 82939\"}\n```",
    );
    assert.equal(parsed.readable, true);
    assert.equal(parsed.state, "WY");
    assert.equal(parsed.issuedState, "WY");
    assert.match(parsed.formatted, /Mountain View/);
  });
});
