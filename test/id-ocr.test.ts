import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { extractAddressFromOcrText } from "../src/lib/id-ocr/extract-address";

describe("extractAddressFromOcrText", () => {
  test("parses an Illinois DL block with comma city/state/zip", () => {
    const text = `
      ILLINOIS
      DRIVER'S LICENSE
      DOE, JANE
      8 ADDRESS
      15001 E 950TH AVE
      PALESTINE, IL 62451
      DOB 01/01/1990
      SEX F HGT 5-06
    `;
    const result = extractAddressFromOcrText(text);
    assert.ok(result);
    assert.equal(result.street.toUpperCase(), "15001 E 950TH AVE");
    assert.equal(result.city.toUpperCase(), "PALESTINE");
    assert.equal(result.state, "IL");
    assert.equal(result.zip, "62451");
    assert.match(result.formatted, /Palestine, IL 62451/i);
  });

  test("parses city and state zip on separate lines", () => {
    const text = `
      12487 KIMREY DR
      SPRINGFIELD
      IL 62704
    `;
    const result = extractAddressFromOcrText(text);
    assert.ok(result);
    assert.match(result.street, /12487 Kimrey Dr/i);
    assert.match(result.city, /Springfield/i);
    assert.equal(result.state, "IL");
    assert.equal(result.zip, "62704");
  });

  test("fixes common OCR IL state mistakes", () => {
    const result = extractAddressFromOcrText("400 N MAIN ST\nDECATUR, 1L 62521");
    assert.ok(result);
    assert.equal(result.state, "IL");
    assert.equal(result.zip, "62521");
  });

  test("returns null when no address is present", () => {
    assert.equal(extractAddressFromOcrText("SEX F\nDOB 01/01/1990\nEXP 01/01/2030"), null);
  });
});
