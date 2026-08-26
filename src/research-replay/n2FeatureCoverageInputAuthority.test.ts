import assert from "node:assert/strict";
import test from "node:test";

import { assertN2FeatureCoverageInputAuthority } from "./n2FeatureCoverageInputAuthority";

test("feature coverage file input cannot claim real-data authority", () => {
  assert.throws(
    () => assertN2FeatureCoverageInputAuthority({ hasFileInput: true, fixture: false }),
    /N2_COVERAGE_FILE_INPUT_REQUIRES_FIXTURE/,
  );
});

test("feature coverage file input is allowed when explicitly marked fixture", () => {
  assert.doesNotThrow(() => assertN2FeatureCoverageInputAuthority({ hasFileInput: true, fixture: true }));
});

test("database-backed input does not require fixture mode", () => {
  assert.doesNotThrow(() => assertN2FeatureCoverageInputAuthority({ hasFileInput: false, fixture: false }));
});
