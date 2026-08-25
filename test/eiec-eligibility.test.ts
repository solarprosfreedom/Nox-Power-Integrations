import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { formatEiecResultEmail } from "../src/lib/eiec/email";
import { parseGptAddressJson } from "../src/lib/eiec/gpt-address";
import { isIllinoisSellingMarket } from "../src/lib/eiec/illinois-market";

describe("isIllinoisSellingMarket", () => {
  test("matches state_code IL", () => {
    assert.equal(isIllinoisSellingMarket({ state_code: "IL" }), true);
  });

  test("skips other states", () => {
    assert.equal(isIllinoisSellingMarket({ state_code: "TX" }), false);
  });
});

describe("formatEiecResultEmail", () => {
  test("uses yes/no without address matching", () => {
    assert.equal(
      formatEiecResultEmail({ name: "Casey Muci", eligible: false }),
      "Name of rep: Casey Muci\nIllinois Eligible: no",
    );
    assert.match(formatEiecResultEmail({ name: "Jane Doe", eligible: true }), /Illinois Eligible: yes/);
  });
});

describe("parseGptAddressJson", () => {
  test("reads fenced JSON", () => {
    const parsed = parseGptAddressJson(
      "```json\n{\"readable\":true,\"street\":\"314 Cottonwood Dr\",\"city\":\"Mountain View\",\"state\":\"WY\",\"zip\":\"82939\",\"formatted\":\"314 Cottonwood Dr, Mountain View, WY 82939\"}\n```",
    );
    assert.equal(parsed.readable, true);
    assert.equal(parsed.state, "WY");
    assert.match(parsed.formatted, /Mountain View/);
  });
});
