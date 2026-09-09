import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isIntegrationDirectionAllowed } from "../src/lib/integration-direction";

describe("Enerflo isolation policy", () => {
  test("blocks every cross-system direction involving Enerflo", () => {
    assert.equal(isIntegrationDirectionAllowed("enerflo", "terros"), false);
    assert.equal(isIntegrationDirectionAllowed("terros", "enerflo"), false);
    assert.equal(isIntegrationDirectionAllowed("sequifi", "enerflo"), false);
    assert.equal(isIntegrationDirectionAllowed("enerflo", "sequifi"), false);
    assert.equal(isIntegrationDirectionAllowed("sequifi", "terros"), true);
  });
});
