import assert from "node:assert/strict";
import test from "node:test";

import { canonicalHash } from "./canonical";
import {
  assertOfficialProgramCanaryManifest,
  buildOfficialProgramCanaryManifest,
  type OfficialProgramCanaryManifest,
} from "./n2OfficialProgramCanary";

const CODE_SHA = "1234567890abcdef1234567890abcdef12345678";

function manifest(): OfficialProgramCanaryManifest {
  return buildOfficialProgramCanaryManifest({
    rows: [{
      raceId: "20040101-01-01",
      date: "2004-01-01",
      venue: "桐生",
      raceNo: 1,
      closeAt: "23:00",
      sourceFile: "/private/cache/20040101-01-01.json",
      rawJson: JSON.stringify({
        boats: Array.from({ length: 6 }, (_, index) => ({
          course: index + 1,
          registrationNo: String(4000 + index),
          className: index === 0 ? "A1" : "B1",
          nationalWinRate: 6 + index / 10,
          nationalTop2Rate: 40 + index,
          localWinRate: 5 + index / 10,
          localTop2Rate: 35 + index,
          motorTop2Rate: 30 + index,
          boatTop2Rate: 28 + index,
        })),
      }),
      importedAt: "2004-01-01 01:00:00",
    }],
    cohort: { dateFrom: "2004-01-01", dateTo: "2004-01-07" },
    codeGitSha: CODE_SHA,
    generatedAt: "2004-01-08T00:00:00.000Z",
  });
}

function rehash(value: OfficialProgramCanaryManifest): OfficialProgramCanaryManifest {
  value.manifestDigest = canonicalHash(value.binding);
  return value;
}

test("persisted canary manifest rejects normalized or non-canonical item timestamps", () => {
  const invalidCutoff = structuredClone(manifest());
  invalidCutoff.binding.items[0].decisionCutoff = "2004-01-01T24:00:00.000Z";
  assert.throws(
    () => assertOfficialProgramCanaryManifest(rehash(invalidCutoff)),
    /CANARY_MANIFEST_ITEM_INVALID/,
  );

  const offsetObservedAt = structuredClone(manifest());
  offsetObservedAt.binding.items[0].sourceObservedAt = "2004-01-01T10:00:00+09:00";
  assert.throws(
    () => assertOfficialProgramCanaryManifest(rehash(offsetObservedAt)),
    /CANARY_MANIFEST_ITEM_INVALID/,
  );
});

test("persisted canary manifest keeps producer-canonical timestamps valid", () => {
  const value = manifest();
  assert.match(value.binding.items[0].sourceObservedAt, /\.000Z$/);
  assert.match(value.binding.items[0].decisionCutoff, /\.000Z$/);
  assert.doesNotThrow(() => assertOfficialProgramCanaryManifest(value));
});
