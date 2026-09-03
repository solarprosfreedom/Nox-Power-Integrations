import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { POST as postEnerfloV1Webhook } from "../src/app/api/webhooks/enerflo-v1/route";
import { POST as postEnerfloV2Webhook } from "../src/app/api/webhooks/enerflo-v2/route";
import { POST as postTerrosWebhook } from "../src/app/api/webhooks/terros/route";
import { isIntegrationDirectionAllowed } from "../src/lib/integration-direction";

describe("Enerflo and Terros isolation policy", () => {
  test("blocks both cross-system directions", () => {
    assert.equal(isIntegrationDirectionAllowed("enerflo", "terros"), false);
    assert.equal(isIntegrationDirectionAllowed("terros", "enerflo"), false);
    assert.equal(isIntegrationDirectionAllowed("sequifi", "enerflo"), true);
    assert.equal(isIntegrationDirectionAllowed("sequifi", "terros"), true);
  });

  test("acknowledges Enerflo v1 webhooks without processing them", async () => {
    const response = await postEnerfloV1Webhook();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      received: true,
      skipped: true,
      reason: "Enerflo → Terros synchronization is disabled",
    });
  });

  test("acknowledges Enerflo v2 webhooks without processing them", async () => {
    const response = await postEnerfloV2Webhook();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      received: true,
      skipped: true,
      reason: "Enerflo → Terros synchronization is disabled",
    });
  });

  test("acknowledges Terros webhooks without processing them", async () => {
    const response = await postTerrosWebhook();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      received: true,
      skipped: true,
      reason: "Terros → Enerflo synchronization is disabled",
    });
  });
});
