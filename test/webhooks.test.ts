import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { preview as previewEnerfloV1 } from "../src/app/api/webhooks/enerflo-v1/route";
import {
  buildHeaders,
  getNestedValue,
  resolveBase,
} from "../src/app/api/webhooks/[system]/route";
import {
  buildEnerfloPayloadFromTerros,
  buildEnerfloUpdatePayload,
  logPreview as terrosLogPreview,
  mapAddress,
  parseEnerfloCreateCustomerId,
  pickExternalLeadId,
  splitName,
  stripEmailAlias,
  terrosJsonBodyIndicatesSuccess as terrosWebhookSuccess,
  terrosUserFromAccount,
} from "../src/app/api/webhooks/terros/route";
import {
  buildLocationFromAppointmentCustomer,
  buildTerrosAccountFieldsFromAppointment,
  extractCustomerCreatedLeadOwnerRefs,
  extractUsers,
  parseUserEmailFromJsonBody,
  pickBestTerrosDedupMatch,
  readTotalSystemSizeWatts,
  repUserRecordMatchesLookup,
  sanitizePhone,
  terrosEventHasEnerfloMarker,
  terrosEventNoteText,
  terrosJsonBodyIndicatesSuccess as enerfloV2TerrosSuccess,
} from "../src/app/api/webhooks/enerflo-v2/route";

describe("generic webhook helpers", () => {
  test("resolves nested payload values by dot path", () => {
    const source = { lead: { assign_to_email: "rep@example.com" } };
    assert.equal(getNestedValue(source, "lead.assign_to_email"), "rep@example.com");
    assert.equal(getNestedValue(source, "lead.missing.value"), undefined);
  });

  test("builds vendor-specific request headers", () => {
    assert.deepEqual(buildHeaders("enerflo", "ef-key"), {
      "Content-Type": "application/json",
      "api-key": "ef-key",
    });
    assert.deepEqual(buildHeaders("terros", "tr-key"), {
      "Content-Type": "application/json",
      Authorization: "ApiKey tr-key",
    });
    assert.deepEqual(buildHeaders("sequifi", "sq-key"), {
      "Content-Type": "application/json",
      Authorization: "Bearer sq-key",
    });
    assert.deepEqual(buildHeaders("terros", ""), { "Content-Type": "application/json" });
  });

  test("uses documented default bases when env is not configured", () => {
    assert.equal(resolveBase("enerflo"), "https://enerflo.io");
    assert.equal(resolveBase("terros"), "https://api.terros.com");
  });
});

describe("Enerflo v1 webhook helpers", () => {
  test("previews JSON and truncates very large bodies", () => {
    assert.equal(previewEnerfloV1({ event: "new_customer" }), '{"event":"new_customer"}');
    assert.match(previewEnerfloV1({ text: "x".repeat(5000) }), /…$/);
  });
});

describe("Terros webhook helpers", () => {
  test("recognizes Terros JSON error envelopes", () => {
    assert.equal(terrosWebhookSuccess('{"type":"error","message":"nope"}'), false);
    assert.equal(terrosWebhookSuccess('{"account":{"accountId":"Account.1"}}'), true);
    assert.equal(terrosWebhookSuccess("not json"), true);
  });

  test("truncates log previews and parses names safely", () => {
    assert.equal(terrosLogPreview("abc", 10), "abc");
    assert.equal(terrosLogPreview("abcdef", 3), "abc…");
    assert.deepEqual(splitName("Jane Mary Doe"), { first_name: "Jane", last_name: "Mary Doe" });
    assert.deepEqual(splitName("Prince"), { first_name: "Prince", last_name: "." });
    assert.deepEqual(splitName(" "), { first_name: "Terros", last_name: "Account" });
  });

  test("maps Terros user, address, and external lead identifiers", () => {
    assert.equal(stripEmailAlias("rep+axia@noxpwr.com"), "rep@noxpwr.com");
    assert.deepEqual(terrosUserFromAccount({ ownerId: " U.123 " }, "owner"), {
      id: "U.123",
      userId: "U.123",
    });
    assert.deepEqual(
      mapAddress({ line1: "123 Main", locality: "Austin", countrySubd: "TX", postal1: "78701" }),
      { address: "123 Main", city: "Austin", state: "TX", zip: "78701" },
    );
    assert.equal(
      pickExternalLeadId({ externalLeadId: "27fffb66-4e30-41c5-a258-4993e3eae92e" }),
      "27fffb66-4e30-41c5-a258-4993e3eae92e",
    );
    assert.equal(pickExternalLeadId({ externalLeadId: "12345" }), null);
  });

  test("parses Enerflo customer ids from supported create responses", () => {
    assert.equal(parseEnerfloCreateCustomerId('{"customer_id":12345}'), "12345");
    assert.equal(parseEnerfloCreateCustomerId('{"data":{"lead":{"id":67890}}}'), "67890");
    assert.equal(
      parseEnerfloCreateCustomerId('{"customer":{"uuid":"27fffb66-4e30-41c5-a258-4993e3eae92e"}}'),
      "27fffb66-4e30-41c5-a258-4993e3eae92e",
    );
    assert.equal(parseEnerfloCreateCustomerId("{bad json"), null);
  });

  test("maps Terros account add into Enerflo lead/add payload", () => {
    const payload = buildEnerfloPayloadFromTerros(
      {
        resident: {
          firstName: "Jane",
          lastName: "Doe",
          email: "jane@example.com",
          phone: "5551234567",
        },
        address: { line1: "123 Main", locality: "Austin", countrySubd: "TX", postal1: "78701" },
      },
      "Account.abc",
      { setterEmail: "setter@noxpwr.com", leadOwnerEmail: "closer@noxpwr.com" },
    ) as { lead: Record<string, unknown> };

    assert.equal(payload.lead.integration_record_id, "Account.abc");
    assert.equal(payload.lead.office_match, "manual");
    assert.equal(payload.lead.setter_email, "setter@noxpwr.com");
    assert.equal(payload.lead.assign_to_email, "closer@noxpwr.com");
    assert.equal(payload.lead.first_name, "Jane");
    assert.equal(payload.lead.last_name, "Doe");
  });

  test("maps Terros account update into Enerflo v3 update payload", () => {
    const payload = buildEnerfloUpdatePayload(
      {
        resident: { name: "Jane Doe", email: "jane@example.com", phone: "5551234567" },
        address: { line1: "123 Main", locality: "Austin", countrySubd: "TX", postal1: "78701" },
      },
      {
        setterEmail: "setter@noxpwr.com",
        leadOwnerEmail: "closer@noxpwr.com",
        setterUserId: 11,
        agentUserId: 22,
      },
    );

    assert.equal(payload.first_name, "Jane");
    assert.equal(payload.last_name, "Doe");
    assert.equal(payload.setter_user_id, 11);
    assert.equal(payload.agent_user_id, 22);
    assert.equal(payload.setter_email, "setter@noxpwr.com");
    assert.equal(payload.assign_to_email, "closer@noxpwr.com");
  });
});

describe("Enerflo v2 webhook helpers", () => {
  test("normalizes phones for Terros account payloads", () => {
    assert.equal(sanitizePhone("+1 (949) 735-2136"), "9497352136");
    assert.equal(sanitizePhone("(949) 735-2136"), "9497352136");
    assert.equal(sanitizePhone("0000000000"), undefined);
    assert.equal(sanitizePhone("2222222222"), undefined);
    assert.equal(sanitizePhone("123"), undefined);
  });

  test("handles Terros response envelopes and event markers", () => {
    assert.equal(enerfloV2TerrosSuccess('{"type":"error"}'), false);
    assert.equal(enerfloV2TerrosSuccess("OK"), true);
    assert.equal(terrosEventNoteText({ notes: "See [Enerflo:99]" }), "See [Enerflo:99]");
    assert.equal(terrosEventHasEnerfloMarker({ note: "See [Enerflo:99]" }, 99), true);
    assert.equal(terrosEventHasEnerfloMarker({ note: "See [Enerflo:98]" }, 99), false);
  });

  test("extracts owner refs and user records from webhook/API shapes", () => {
    assert.deepEqual(
      extractCustomerCreatedLeadOwnerRefs(
        { id: "cust-1", leadOwner: { id: "nested-id" } },
        { lead_owner: { email: "owner@noxpwr.com" } },
      ),
      { email: "owner@noxpwr.com", source: "lead_owner" },
    );
    assert.deepEqual(extractUsers({ results: [{ id: 1 }, { id: 2 }] }), [{ id: 1 }, { id: 2 }]);
    assert.deepEqual(extractUsers([{ id: 3 }]), [{ id: 3 }]);
  });

  test("parses and matches Enerflo user lookups", () => {
    assert.equal(parseUserEmailFromJsonBody('{"data":{"Email":"Rep@NoxPwr.com"}}'), "Rep@NoxPwr.com");
    assert.equal(parseUserEmailFromJsonBody("{bad json"), null);
    assert.equal(repUserRecordMatchesLookup({ id: 12 }, "12"), true);
    assert.equal(repUserRecordMatchesLookup({ uuid: "ABC" }, "abc"), true);
    assert.equal(repUserRecordMatchesLookup({ email: "x@example.com" }, "abc"), false);
  });

  test("prefers Terros dedup matches by phone, then linked rows", () => {
    const linked = { accountId: "Account.linked", externalLeadId: "cust-1", resident: { phone: "1112223333" } };
    const phone = { accountId: "Account.phone", resident: { phone: "(949) 735-2136" } };
    assert.equal(pickBestTerrosDedupMatch([linked, phone], "+19497352136")?.accountId, "Account.phone");
    assert.equal(pickBestTerrosDedupMatch([linked, phone], "")?.accountId, "Account.linked");
  });

  test("builds Terros account fields for appointments without creating empty shells", () => {
    const appointment = {
      customer: {
        id: 123,
        first_name: "Jane",
        last_name: "Doe",
        email: "jane@example.com",
        phone: "+19497352136",
        address: {
          street: "123 Main",
          city: "Austin",
          state: "TX",
          zip: "78701",
          latitude: "30.1",
          longitude: "-97.1",
        },
      },
    };
    const v3Customer = { uuid: "27fffb66-4e30-41c5-a258-4993e3eae92e" };
    const location = buildLocationFromAppointmentCustomer(appointment as never, v3Customer);
    assert.deepEqual(location, {
      line1: "123 Main",
      locality: "Austin",
      countrySubd: "TX",
      postal1: "78701",
      latitude: 30.1,
      longitude: -97.1,
    });

    const fields = buildTerrosAccountFieldsFromAppointment(
      appointment as never,
      v3Customer,
      "27fffb66-4e30-41c5-a258-4993e3eae92e",
      "123",
      "Workflow.1",
      { ownerId: "U.owner", closerId: "U.closer", appointmentStageId: "Stage.appt" },
    );

    assert.equal(fields?.externalLeadId, "27fffb66-4e30-41c5-a258-4993e3eae92e");
    assert.equal(fields?.workflowStageId, "Stage.appt");
    assert.equal(fields?.ownerId, "U.owner");
    assert.equal(fields?.closerId, "U.closer");
    assert.deepEqual(fields?.resident, {
      name: "Jane Doe",
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
      phone: "9497352136",
    });

    assert.equal(
      buildTerrosAccountFieldsFromAppointment({ customer: { id: 123 } } as never, {}, null, "123", ""),
      null,
    );
  });

  test("reads total system size from every known Enerflo project shape", () => {
    assert.equal(readTotalSystemSizeWatts({ proposal: { pricingOutputs: { totalSystemSizeWatts: 8100 } } } as never), 8100);
    assert.equal(readTotalSystemSizeWatts({ proposal: { pricingOutputs: { design: { totalSystemSizeWatts: 9200 } } } } as never), 9200);
    assert.equal(readTotalSystemSizeWatts({ proposal: { design: { totalSystemSizeWatts: 10300 } } } as never), 10300);
    assert.equal(readTotalSystemSizeWatts({ proposal: {} } as never), 0);
  });
});
