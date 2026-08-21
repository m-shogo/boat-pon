import assert from "node:assert/strict";
import test from "node:test";

import {
  assertN2SettlementReparseCheckpointIdentity,
  buildN2SettlementReparseCheckpointIdentity,
} from "./n2SettlementReparseCheckpoint";

function build(overrides: Partial<Parameters<typeof buildN2SettlementReparseCheckpointIdentity>[0]> = {}) {
  return buildN2SettlementReparseCheckpointIdentity({
    reparseSchemaVersion: "n2-settlement-reparse-v2",
    sourceParserVersion: "settlement-v1",
    targetParserVersion: "settlement-v2",
    canonicalizationVersion: "rr-c14n-v1",
    raceIdentityVersion: "race-key-v1",
    asOf: "2026-08-01T00:00:00.000Z",
    mode: "simulated",
    canary: false,
    filesLimit: 20,
    sourcePath: "/repo/data/research-replay.sqlite",
    targetPath: "/repo/data/tmp/reparse-target.sqlite",
    archiveRoot: "/repo/data/raw/official/results",
    selectedFiles: ["k260801.lzh", "k260802.lzh"],
    ...overrides,
  });
}

test("reparse checkpoint identity canonicalizes equivalent as-of instants", () => {
  assert.deepEqual(
    build({ asOf: "2026-08-01T09:00:00+09:00" }),
    build({ asOf: "2026-08-01T00:00:00.000Z" }),
  );
});

test("reparse checkpoint identity rejects stale selection and parser lineage", () => {
  const expected = build();
  assert.doesNotThrow(() => assertN2SettlementReparseCheckpointIdentity(expected, expected));

  for (const actual of [
    build({ selectedFiles: ["k260801.lzh"] }),
    build({ filesLimit: 1 }),
    build({ canary: true }),
    build({ sourceParserVersion: "settlement-v0" }),
    build({ targetParserVersion: "settlement-v3" }),
    build({ asOf: "2026-08-02T00:00:00.000Z" }),
    build({ sourcePath: "/other/source.sqlite" }),
    build({ archiveRoot: "/other/archive" }),
  ]) {
    assert.throws(
      () => assertN2SettlementReparseCheckpointIdentity(actual, expected),
      /REPARSE_CHECKPOINT_IDENTITY_MISMATCH/,
    );
  }
});

test("reparse checkpoint identity rejects impossible timestamps", () => {
  assert.throws(
    () => build({ asOf: "2026-08-01T24:00:00Z" }),
    /timestamp/i,
  );
});
