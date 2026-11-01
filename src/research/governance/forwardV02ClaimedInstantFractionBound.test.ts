import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compareForwardV02ClaimedInstants, validForwardV02ClaimedInstant } from "./forwardV02ClaimedInstant";
import { forwardV02SourceManifestReferenceDigest } from "./forwardV02ReferenceReconciliation";

/**
 * Synthetic, untrusted metadata resource-bound regression. Neither a valid
 * timestamp shape nor a manifest digest authenticates a clock or authorizes scoring.
 */
const prefix = "2026-10-24T00:00:00.";
const fraction64 = "1".repeat(64);
const fraction65 = "1".repeat(65);
const manifest = (createdAt: string) => ({
  schemaVersion: "forward-source-manifest.0.2-candidate",
  manifestId: "synthetic-fraction-bound",
  evidenceStage: "SHADOW_FORWARD",
  analysisSnapshotDigest: "a".repeat(64),
  decisionDigests: ["b".repeat(64)],
  outcomeDigests: ["c".repeat(64)],
  createdAt,
  productionConnection: false,
});

test("shared claimed clock accepts 64 digits and rejects 65 or unbounded input", () => {
  for (const suffix of ["Z", "+23:59"]) {
    assert.equal(validForwardV02ClaimedInstant(prefix + fraction64 + suffix), true, suffix);
    assert.equal(validForwardV02ClaimedInstant(prefix + fraction65 + suffix), false, suffix);
  }
  assert.equal(validForwardV02ClaimedInstant(prefix + "1".repeat(100_000) + "Z"), false);
  assert.equal(validForwardV02ClaimedInstant(prefix + "1".repeat(18) + "Z"), true);
});

test("schema lexical fraction bound matches runtime without granting time authority", () => {
  const schema = JSON.parse(readFileSync(
    new URL("../../../config/research-governance/forward-v02-authority-metadata.schema.json", import.meta.url),
    "utf8",
  )) as { $defs: { exactInstant: { pattern: string; maxLength: number } } };
  const instant = schema.$defs.exactInstant;
  assert.equal(instant.maxLength, 90);
  const pattern = new RegExp(instant.pattern, "u");
  for (const suffix of ["Z", "+23:59"]) {
    const admitted = prefix + fraction64 + suffix;
    const denied = prefix + fraction65 + suffix;
    assert.equal(pattern.test(admitted) && admitted.length <= instant.maxLength, true);
    assert.equal(pattern.test(denied) && denied.length <= instant.maxLength, false);
    assert.equal(validForwardV02ClaimedInstant(admitted), true);
    assert.equal(validForwardV02ClaimedInstant(denied), false);
  }
});

test("manifest admission and submillisecond ordering retain bounded precision", () => {
  const accepted = prefix + fraction64 + "Z";
  const rejected = prefix + fraction65 + "Z";
  assert.equal(typeof forwardV02SourceManifestReferenceDigest(manifest(accepted)), "string");
  assert.equal(forwardV02SourceManifestReferenceDigest(manifest(rejected)), null);
  assert.equal(compareForwardV02ClaimedInstants(prefix + "1Z", prefix + "1" + "0".repeat(63) + "Z"), 0);
  assert.equal(compareForwardV02ClaimedInstants(
    prefix + "1" + "0".repeat(63) + "Z",
    prefix + "1" + "0".repeat(62) + "1Z",
  ), -1);
});

test("direct comparator rejects invalid or oversized claims before ordering", () => {
  assert.throws(() => compareForwardV02ClaimedInstants("not-an-instant", "also-invalid"), /INVALID_CLAIMED_INSTANT/);
  assert.throws(() => compareForwardV02ClaimedInstants(prefix + fraction65 + "Z", prefix + "1Z"), /INVALID_CLAIMED_INSTANT/);
  assert.throws(() => compareForwardV02ClaimedInstants(prefix + "1Z", prefix + "1".repeat(100_000) + "Z"), /INVALID_CLAIMED_INSTANT/);
});
