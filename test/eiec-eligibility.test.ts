import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { eiecEmailRecipients, formatEiecResultEmail } from "../src/lib/eiec/email";
import { addressMatchesId, parseGptAddressJson } from "../src/lib/eiec/gpt-address";
import {
  hasIllinoisHomeAddress,
  isIllinoisHomeAddress,
  parseSequifiHomeAddress,
  sequifiAddressMatchesId,
} from "../src/lib/eiec/home-address";
import { isIllinoisSellingMarket } from "../src/lib/eiec/illinois-market";
import { eiecEligibleFolderName } from "../src/lib/eiec/sharepoint-test";
import { sequifiUserFromApi } from "../src/lib/onboarding/normalize";

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

describe("parseSequifiHomeAddress", () => {
  test("treats missing profile address as optional/null", () => {
    const user = sequifiUserFromApi({
      id: 384,
      employee_id: "384",
      email: "rep@example.com",
      first_name: "Troy",
      last_name: "Sheridan",
      home_address: null,
      home_address_line_1: null,
      home_address_line_2: null,
      home_address_city: null,
      home_address_state: null,
      home_address_zip: null,
    });
    assert.ok(user);
    assert.equal(user.home_address, null);
    assert.equal(parseSequifiHomeAddress(user), null);
    assert.equal(hasIllinoisHomeAddress(user), false);
  });

  test("reads structured Illinois home address", () => {
    const fields = {
      home_address: "1124 Jefferson St, Hillsboro, IL, 62049",
      home_address_line_1: "1124 Jefferson St",
      home_address_line_2: null,
      home_address_city: "Hillsboro",
      home_address_state: "IL",
      home_address_zip: "62049",
    };
    const home = parseSequifiHomeAddress(fields);
    assert.ok(home);
    assert.equal(home.state, "IL");
    assert.equal(isIllinoisHomeAddress(home), true);
    assert.equal(hasIllinoisHomeAddress(fields), true);
  });

  test("does not treat a non-Illinois home address as a check", () => {
    assert.equal(
      hasIllinoisHomeAddress({
        home_address_line_1: "1 Main St",
        home_address_city: "Austin",
        home_address_state: "TX",
        home_address_zip: "78701",
      }),
      false,
    );
  });
});

describe("sequifiAddressMatchesId", () => {
  const kyle = parseSequifiHomeAddress({
    home_address: "1124 Jefferson St, Hillsboro, IL, 62049",
    home_address_line_1: "1124 Jefferson St",
    home_address_city: "Hillsboro",
    home_address_state: "IL",
    home_address_zip: "62049",
  });

  test("matches when Sequifi and ID are both Illinois, even if the street differs", () => {
    assert.equal(
      sequifiAddressMatchesId(kyle, {
        readable: true,
        street: "812 E Converse Ave",
        city: "Springfield",
        state: "Illinois",
        zip: "62702",
      }),
      true,
    );
  });

  test("does not match when the ID address is not Illinois", () => {
    assert.equal(
      sequifiAddressMatchesId(kyle, {
        readable: true,
        street: "1 Main St",
        city: "Austin",
        state: "TX",
        zip: "78701",
      }),
      false,
    );
  });

  test("is n/a when Sequifi address is still null", () => {
    assert.equal(
      sequifiAddressMatchesId(null, {
        readable: true,
        street: "1124 Jefferson St",
        city: "Hillsboro",
        state: "IL",
        zip: "62049",
      }),
      null,
    );
  });
});

describe("eiecEligibleFolderName", () => {
  test("uses only the rep name when the address matches", () => {
    assert.equal(eiecEligibleFolderName("Kyle Earl", true), "Kyle Earl");
  });

  test("adds address not match when the ID is not Illinois", () => {
    assert.equal(
      eiecEligibleFolderName("Christopher Hall", false),
      "Christopher Hall (address not match)",
    );
  });
});
