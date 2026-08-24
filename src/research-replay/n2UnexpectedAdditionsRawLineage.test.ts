import assert from "node:assert/strict";
import test from "node:test";
import { resolveUnexpectedAdditionsRawDate } from "./n2UnexpectedAdditionsRawLineage";

test("unexpected additions raw lineage requires canonical same-day race identities", () => {
  assert.equal(resolveUnexpectedAdditionsRawDate([
    "2026-05-03:01:R1",
    "2026-05-03:24:R12",
  ]), "2026-05-03");
  assert.equal(resolveUnexpectedAdditionsRawDate([]), null);

  assert.throws(
    () => resolveUnexpectedAdditionsRawDate(["2026-05-32:01:R1"]),
    /N2_UNEXPECTED_ADDITIONS_RAW_RACE_IDENTITY_INVALID/,
  );
  assert.throws(
    () => resolveUnexpectedAdditionsRawDate(["2026-05-03:01:R1", "2026-05-04:01:R1"]),
    /N2_UNEXPECTED_ADDITIONS_RAW_DATE_AMBIGUOUS/,
  );
});
