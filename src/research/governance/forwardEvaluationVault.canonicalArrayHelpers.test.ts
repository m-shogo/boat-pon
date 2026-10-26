import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  classifyForwardVaultAppend,
  forwardVaultDigest,
  validateForwardVaultRecord,
  type EvaluationProtocol,
  type Membership,
} from "./forwardEvaluationVault.js";

// Synthetic research records only: no real odds, outcomes, or scoring authority.
const digest = (letter: string) => letter.repeat(64);

function membership(): Membership {
  return {
    schemaVersion: V, kind: "MEMBERSHIP", recordId: "member:synthetic-order",
    evidenceStage: "SHADOW_FORWARD", createdAt: "2026-10-24T00:00:00Z",
    cohortId: "cohort:synthetic", enrollmentProtocolId: "enrollment:synthetic",
    enrollmentProtocolDigest: digest("a"), canonicalRaceId: "race:synthetic",
    decisionRecordId: "decision:synthetic", decisionRecordDigest: digest("b"),
    enrolledAt: "2026-10-24T00:00:00Z", included: true,
    reason: "prospective synthetic rule",
  };
}

function protocol(metric: string): EvaluationProtocol {
  return {
    schemaVersion: V, kind: "EVALUATION_PROTOCOL",
    recordId: "protocol:synthetic-array-from",
    evidenceStage: "SHADOW_FORWARD", createdAt: "2026-10-24T00:00:00Z",
    evaluationProtocolId: "eval:synthetic", comparisonMode: "COMMON_COHORT",
    oddsBasis: "BUY_TIME", metricFamilies: [metric],
    unresolvedPolicy: "EXCLUDE_AND_COUNT",
    benchmarkDecisionSystems: ["synthetic-shadow"], protocolVersion: "synthetic-v1",
  };
}

test("canonical digest ignores insertion order even if Array.prototype.sort is replaced", () => {
  const original = membership();
  const reordered = Object.fromEntries(Object.entries(original).reverse()) as Membership;
  assert.equal(validateForwardVaultRecord(original).valid, true);
  assert.equal(validateForwardVaultRecord(reordered).valid, true);
  const expected = forwardVaultDigest(original);
  assert.equal(forwardVaultDigest(reordered), expected);

  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, "sort");
  assert.ok(descriptor);
  let observed: { first: string; second: string; append: string } | undefined;
  try {
    Object.defineProperty(Array.prototype, "sort", {
      ...descriptor, value() { return this; },
    });
    observed = {
      first: forwardVaultDigest(original),
      second: forwardVaultDigest(reordered),
      append: classifyForwardVaultAppend(original, reordered),
    };
  } finally {
    Object.defineProperty(Array.prototype, "sort", descriptor);
  }
  assert.deepEqual(observed, {
    first: expected, second: expected, append: "IDEMPOTENT_NOOP",
  });
});

test("canonical digest retains array contents even if Array.from is replaced", () => {
  const existing = protocol("ROI");
  const changed = protocol("Brier");
  assert.equal(validateForwardVaultRecord(existing).valid, true);
  assert.equal(validateForwardVaultRecord(changed).valid, true);
  const expectedExisting = forwardVaultDigest(existing);
  const expectedChanged = forwardVaultDigest(changed);
  assert.notEqual(expectedExisting, expectedChanged);
  assert.equal(classifyForwardVaultAppend(existing, changed), "CONFLICT");

  const descriptor = Object.getOwnPropertyDescriptor(Array, "from");
  assert.ok(descriptor);
  let observed: { first: string; second: string; append: string } | undefined;
  try {
    Object.defineProperty(Array, "from", {
      ...descriptor, value() { return []; },
    });
    observed = {
      first: forwardVaultDigest(existing),
      second: forwardVaultDigest(changed),
      append: classifyForwardVaultAppend(existing, changed),
    };
  } finally {
    Object.defineProperty(Array, "from", descriptor);
  }
  assert.deepEqual(observed, {
    first: expectedExisting, second: expectedChanged, append: "CONFLICT",
  });
});

test("canonical array digest ignores inherited numeric-index setters", () => {
  // Fully synthetic protocols: only the final element differs. An inherited
  // setter on a fresh canonical array used to drop index 17, aliasing digests.
  const existing = protocol("ROI");
  existing.metricFamilies = Array.from({ length: 18 }, (_, i) => `synthetic-metric-${i}`);
  const changed = protocol("ROI");
  changed.metricFamilies = existing.metricFamilies.slice();
  changed.metricFamilies[17] = "synthetic-metric-changed";
  assert.equal(validateForwardVaultRecord(existing).valid, true);
  assert.equal(validateForwardVaultRecord(changed).valid, true);
  const expectedExisting = forwardVaultDigest(existing);
  const expectedChanged = forwardVaultDigest(changed);
  assert.notEqual(expectedExisting, expectedChanged);
  assert.equal(classifyForwardVaultAppend(existing, changed), "CONFLICT");

  const previous = Object.getOwnPropertyDescriptor(Array.prototype, "17");
  let interceptedCanonicalEntries = 0;
  let observed: { first: string; second: string; append: string } | undefined;
  try {
    Object.defineProperty(Array.prototype, "17", {
      configurable: true,
      set(this: unknown[], value: unknown) {
        if (typeof value === "string" && value.startsWith("synthetic-metric-")) {
          interceptedCanonicalEntries++;
          return;
        }
        // Preserve unrelated array writes while the synthetic hook is active.
        Object.defineProperty(this, "17", {
          value, enumerable: true, writable: true, configurable: true,
        });
      },
    });
    observed = {
      first: forwardVaultDigest(existing),
      second: forwardVaultDigest(changed),
      append: classifyForwardVaultAppend(existing, changed),
    };
  } finally {
    if (previous) Object.defineProperty(Array.prototype, "17", previous);
    else Reflect.deleteProperty(Array.prototype, "17");
  }
  assert.deepEqual(observed, {
    first: expectedExisting, second: expectedChanged, append: "CONFLICT",
  });
  assert.equal(interceptedCanonicalEntries, 0);
});

test("ordinary valid arrays and property order remain digest-stable", () => {
  const a = protocol("ROI");
  const b = { ...a, metricFamilies: ["ROI"], benchmarkDecisionSystems: ["synthetic-shadow"] };
  assert.equal(forwardVaultDigest(a), forwardVaultDigest(b));
  assert.equal(classifyForwardVaultAppend(a, b), "IDEMPOTENT_NOOP");
});

test("frozen pre-hardening digest vectors remain byte-for-byte stable", () => {
  // Values generated from the v276 canonical implementation before hardening.
  // A digest migration would violate append-only identity even if comparisons pass.
  assert.equal(
    forwardVaultDigest(membership()),
    "7792fa7591b7de2be2fd9edb45945dbcf17d16e59645c9cf8d7a1d7f84fca8ad",
  );
  assert.equal(
    forwardVaultDigest(protocol("ROI")),
    "c2137a8e1badb50bbfa07ea9c36241f5aeeb259f65171d28f9f1781df9d31b0d",
  );
});
