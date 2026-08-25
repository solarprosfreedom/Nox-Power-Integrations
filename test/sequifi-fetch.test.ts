import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isSequifiHost } from "../src/lib/sequifi/fetch";

describe("isSequifiHost", () => {
  test("matches Sequifi API hosts", () => {
    assert.equal(isSequifiHost("marketplace-api.sequifi.com"), true);
    assert.equal(isSequifiHost("api.sequifi.com"), true);
  });

  test("skips other hosts", () => {
    assert.equal(isSequifiHost("graph.microsoft.com"), false);
    assert.equal(isSequifiHost("sequifi.com.evil.example"), false);
  });
});
