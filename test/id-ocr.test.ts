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

  test("parses a California ID address on one line", () => {
    const text = `
      CALIFORNIA IDENTIFICATION CARD
      LN JUMIO, FN MARIE
      1234 ABC STREET, ANYTOWN, CA 91234
      A123456789
      EXP 01/01/2025
      DOB 01/01/1975
      SEX F HGT 5'-05" HAIR BRN WGT 125 lb EYES BRN ISS 01/01/1990
      200 Hgt 5'-05" Wgt 1251b Iss
    `;
    const result = extractAddressFromOcrText(text);
    assert.ok(result);
    assert.match(result.street, /1234 Abc Street/i);
    assert.match(result.city, /Anytown/i);
    assert.equal(result.state, "CA");
    assert.equal(result.zip, "91234");
  });

  test("parses noisy Tesseract output from a California ID photo", () => {
    const text = `
C ALIFORNIA: IDENTIFICATION
ip A123456789 | A
xp 01/01/2025
| tn JUMIO
~< FN MARIE
> & 1234 ABC STREET
y ANYTOWN, CA 91234 ==
< pos 01/01/1975 -
: as A123456789
SEX F HAIR BRN EYES BRN
- 200 HGT 5'-05" WGT 1251b ISS
farce Fz 01/01/1990
    `;
    const result = extractAddressFromOcrText(text);
    assert.ok(result);
    assert.match(result.street, /1234 Abc Street/i);
    assert.match(result.city, /Anytown/i);
    assert.equal(result.state, "CA");
    assert.equal(result.zip, "91234");
  });

  test("does not treat height and weight OCR as a street", () => {
    const result = extractAddressFromOcrText(`200 Hgt 5'-05" Wgt 1251b Iss\nSEX F\nISS 01/01/1990`);
    assert.equal(result, null);
  });

  test("parses a sample ID street and city without state or zip", () => {
    const text = `
      ID : 123456789
      Lars Peeters
      Assistant Manager
      123 Anywhere St., Any City
      +123-456-7890
      www.reallygreatsite.com
    `;
    const result = extractAddressFromOcrText(text);
    assert.ok(result);
    assert.match(result.street, /123 Anywhere St/i);
    assert.match(result.city, /Any City/i);
    assert.equal(result.state, "");
    assert.equal(result.zip, "");
    assert.match(result.formatted, /123 Anywhere St/i);
  });

  test("returns null when no address is present", () => {
    assert.equal(extractAddressFromOcrText("SEX F\nDOB 01/01/1990\nEXP 01/01/2030"), null);
  });
});
