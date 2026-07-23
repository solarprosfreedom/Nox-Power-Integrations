import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  getEnerfloCustomerUuid,
  getEnerfloIntegrationExternalId,
  getEnerfloIntegrationRecordId,
  getTerrosAccountIdFromIntegrationMaps,
  resolveTerrosAccountForInstalls,
} from "../src/lib/sync/account-matcher";
import {
  buildTerrosLookupMaps,
  parseTerrosAccountRow,
  terrosSuccess,
} from "../src/lib/sync/terros-accounts";
import {
  emailsMatch,
  expandEmailCandidates,
  findUserByEmailInList,
  localPartVariants,
  resolveEmailFromUserList,
} from "../src/lib/sync/user-email-match";
import {
  pickEnerfloLeadOwnerEmailFromTerros,
  pickEnerfloSetterEmailFromTerros,
  pickTerrosCloserEmailFromEnerflo,
  pickTerrosOwnerEmailFromEnerflo,
} from "../src/lib/sync/terros-enerflo-assignments";
import {
  extractFieldSummary,
  formatProjectFieldsForPreview,
} from "../src/lib/sync/field-labels";

describe("cross-system assignment mapping", () => {
  test("maps Enerflo setter and lead owner into Terros owner and closer", () => {
    assert.equal(
      pickTerrosOwnerEmailFromEnerflo(" setter@noxpwr.com ", "closer@noxpwr.com"),
      "setter@noxpwr.com",
    );
    assert.equal(
      pickTerrosOwnerEmailFromEnerflo("", " closer@noxpwr.com "),
      "closer@noxpwr.com",
    );
    assert.equal(
      pickTerrosCloserEmailFromEnerflo("setter@noxpwr.com", "closer@noxpwr.com"),
      "closer@noxpwr.com",
    );
    assert.equal(
      pickTerrosCloserEmailFromEnerflo("same@noxpwr.com", "same@noxpwr.com"),
      null,
    );
  });

  test("maps Terros owner and closer back into Enerflo setter and lead owner", () => {
    assert.equal(pickEnerfloSetterEmailFromTerros(" owner@noxpwr.com "), "owner@noxpwr.com");
    assert.equal(pickEnerfloSetterEmailFromTerros(" "), undefined);
    assert.equal(pickEnerfloLeadOwnerEmailFromTerros(" closer@noxpwr.com "), "closer@noxpwr.com");
    assert.equal(pickEnerfloLeadOwnerEmailFromTerros(null), undefined);
  });
});

describe("email matching", () => {
  test("builds +alias, domain alias, and middle-initial variants", () => {
    const candidates = expandEmailCandidates("CharlieMLeSpier+axia@solarpros.io");
    assert.ok(candidates.includes("charliemlespier@solarpros.io"));
    assert.ok(candidates.includes("charliemlespier@noxpwr.com"));
    assert.ok(candidates.includes("charlielespier@noxpwr.com"));
    assert.deepEqual(expandEmailCandidates("not-an-email"), []);
  });

  test("matches equivalent cross-domain and middle-initial emails", () => {
    assert.equal(emailsMatch("charliemlespier@solarpros.io", "charlielespier@noxpwr.com"), true);
    assert.equal(emailsMatch("setter+tron@noxpwr.com", "setter@solarpros.io"), true);
    assert.equal(emailsMatch("alice@noxpwr.com", "bob@noxpwr.com"), false);
    assert.ok(localPartVariants("abcdef").includes("acdef"));
  });

  test("finds and resolves users from mixed email lists", () => {
    const users = [
      { id: 1, email: "someone@noxpwr.com" },
      { id: 2, email: "charlielespier@noxpwr.com" },
    ];
    assert.deepEqual(
      findUserByEmailInList("charliemlespier@solarpros.io", users, (u) => String(u.email)),
      users[1],
    );
    assert.equal(resolveEmailFromUserList("charliemlespier@solarpros.io", users), "charlielespier@noxpwr.com");
  });
});

describe("Terros account parsing and lookup maps", () => {
  test("parses Terros account rows from common API shapes", () => {
    const parsed = parseTerrosAccountRow({
      accountId: "Account.1",
      resident: {
        firstName: "Jane",
        lastName: "Doe",
        email: "JANE@EXAMPLE.COM",
        phone: "(949) 735-2136",
      },
      location: {
        line1: "123 Main",
        locality: "Austin",
        countrySubd: "TX",
        postal1: 78701,
      },
      owner: { email: "setter@noxpwr.com" },
      closer: { email: "closer@noxpwr.com" },
      externalLeadId: "12345",
    });

    assert.deepEqual(parsed, {
      accountId: "Account.1",
      name: "Jane Doe",
      email: "jane@example.com",
      phone: "(949) 735-2136",
      addressLine1: "123 Main",
      city: "Austin",
      stateCode: "TX",
      zip: "78701",
      addressFull: "123 Main, Austin, TX, 78701",
      ownerEmail: "setter@noxpwr.com",
      closerEmail: "closer@noxpwr.com",
      externalLeadId: "12345",
    });
  });

  test("indexes lookup maps by email, normalized phone, and external lead id", () => {
    const account = parseTerrosAccountRow({
      accountId: "Account.1",
      resident: { email: "jane@example.com", phone: "(949) 735-2136" },
      externalLeadId: "12345",
    })!;
    const maps = buildTerrosLookupMaps([account]);
    assert.equal(maps.terrosEmailToAccount.get("jane@example.com")?.accountId, "Account.1");
    assert.equal(maps.terrosPhoneToAccount.get("9497352136")?.accountId, "Account.1");
    assert.equal(maps.terrosExternalLeadIdToAccount.get("12345")?.accountId, "Account.1");
    assert.equal(terrosSuccess('{"type":"error"}'), false);
    assert.equal(terrosSuccess("OK"), true);
  });
});

describe("Enerflo/Terros account matching", () => {
  test("reads integration identifiers from Enerflo rows", () => {
    assert.equal(
      getEnerfloIntegrationRecordId({
        integrations: { Partner: { Lead: { integration_record_id: "Account.1" } } },
      }),
      "Account.1",
    );
    assert.equal(
      getTerrosAccountIdFromIntegrationMaps({
        integration_maps: [{ external_id: "Account.2" }],
      }),
      "Account.2",
    );
    assert.equal(
      getEnerfloCustomerUuid({ uuid: "27fffb66-4e30-41c5-a258-4993e3eae92e" }),
      "27fffb66-4e30-41c5-a258-4993e3eae92e",
    );
    assert.equal(
      getEnerfloIntegrationExternalId({
        integration_maps: [{ external_id: "27fffb66-4e30-41c5-a258-4993e3eae92e" }],
      }),
      "27fffb66-4e30-41c5-a258-4993e3eae92e",
    );
  });

  test("resolves install matches from strongest local maps before network search", async () => {
    const account = parseTerrosAccountRow({
      accountId: "Account.numeric",
      resident: { email: "jane@example.com", phone: "9497352136" },
      externalLeadId: "12345",
    })!;
    const maps = buildTerrosLookupMaps([account]);
    const accountId = await resolveTerrosAccountForInstalls({
      customer: {},
      uuid: "27fffb66-4e30-41c5-a258-4993e3eae92e",
      numericId: "12345",
      email: "jane@example.com",
      phone: "9497352136",
      maps,
    });
    assert.equal(accountId, "Account.numeric");
  });

  test("prefers explicit integration maps over weaker email/phone matches", async () => {
    const linked = parseTerrosAccountRow({ accountId: "Account.linked", externalLeadId: "Account.linked" })!;
    const email = parseTerrosAccountRow({
      accountId: "Account.email",
      resident: { email: "jane@example.com" },
    })!;
    const maps = buildTerrosLookupMaps([linked, email]);
    const accountId = await resolveTerrosAccountForInstalls({
      customer: { integration_maps: [{ external_id: "Account.linked" }] },
      uuid: "",
      numericId: "",
      email: "jane@example.com",
      phone: "",
      maps,
    });
    assert.equal(accountId, "Account.linked");
  });
});

describe("project field preview helpers", () => {
  test("formats and extracts field summaries", () => {
    const fields = formatProjectFieldsForPreview({});
    assert.ok(fields.some((f) => f.key === "systemSizeKw"));
    assert.ok(fields.every((f) => typeof f.envVar === "string" && f.envVar.startsWith("TERROS_CF_")));

    const summary = extractFieldSummary([
      { key: "systemSizeKw", label: "System Size", terrosFieldId: null, envVar: "X", configured: false, value: 8.1, hasValue: true },
      { key: "netPpw", label: "Net PPW", terrosFieldId: null, envVar: "Y", configured: false, value: "2.8", hasValue: true },
      { key: "financeProduct", label: "Finance Product", terrosFieldId: null, envVar: "Z", configured: false, value: "Cash", hasValue: true },
    ]);
    assert.deepEqual(summary, { systemSizeKw: 8.1, netPpw: 2.8, financeProduct: "Cash" });
  });
});
