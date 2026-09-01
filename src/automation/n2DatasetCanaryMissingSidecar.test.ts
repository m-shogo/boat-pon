import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  preflightN2AllActiveSettlementLineage,
  preflightN2DatasetCanarySettlementLineage,
} from "./n2DatasetCanarySettlementGuard";

const missingSidecar = join(tmpdir(), "boat-pon-definitely-missing-settlement-sidecar.sqlite");

test("dataset settlement preflight fails closed when the sidecar is missing", () => {
  const canary = preflightN2DatasetCanarySettlementLineage(missingSidecar);
  assert.equal(canary.ok, false);
  assert.deepEqual(canary.blocks, ["DATASET_CANARY_SIDECAR_NOT_FOUND"]);
  assert.equal(canary.checkedCandidateCount, 0);

  const active = preflightN2AllActiveSettlementLineage(missingSidecar);
  assert.equal(active.ok, false);
  assert.deepEqual(active.blocks, ["DATASET_ACTIVE_SIDECAR_NOT_FOUND"]);
  assert.equal(active.checkedCandidateCount, 0);
});
