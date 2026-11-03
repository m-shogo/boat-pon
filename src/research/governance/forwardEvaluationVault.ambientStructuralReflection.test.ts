import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  classifyForwardVaultAppend,
  forwardVaultDigest,
  validateForwardVaultRecord,
  type Membership,
} from "./forwardEvaluationVault.js";

// Synthetic research metadata only. No private T-5 evidence or production access.
const sha = "a".repeat(64);
const membership = (reason = "synthetic:enrolled"): Membership => ({
  schemaVersion: V, kind: "MEMBERSHIP", recordId: "synthetic:member",
  evidenceStage: "SHADOW_FORWARD", createdAt: "2026-11-02T00:00:00Z",
  cohortId: "synthetic:cohort", enrollmentProtocolId: "synthetic:enrollment",
  enrollmentProtocolDigest: sha, canonicalRaceId: "synthetic:race",
  decisionRecordId: "synthetic:decision", decisionRecordDigest: sha,
  enrolledAt: "2026-11-02T00:00:00Z", included: true, reason,
});

test("v0.1 rejects hidden own metadata despite ambient Reflect.ownKeys omission", () => {
  const baseline = membership();
  const hidden = { ...baseline };
  Object.defineProperty(hidden, "syntheticHidden", { value: "not-in-digest", enumerable: false });
  const originalDigest = forwardVaultDigest(baseline);
  assert.equal(validateForwardVaultRecord(hidden).valid, false);
  const descriptor = Object.getOwnPropertyDescriptor(Reflect, "ownKeys");
  assert.ok(descriptor);
  const native = Reflect.ownKeys;
  let observed: { valid: boolean; append: string; denied: boolean; digest: string } | undefined;
  try {
    Object.defineProperty(Reflect, "ownKeys", {
      ...descriptor,
      value(target: object): (string | symbol)[] {
        const keys = native(target);
        return target === hidden ? keys.filter((key) => key !== "syntheticHidden") : keys;
      },
    });
    let denied = false;
    try { forwardVaultDigest(hidden); } catch (error) { denied = error instanceof TypeError; }
    observed = {
      valid: validateForwardVaultRecord(hidden).valid,
      append: classifyForwardVaultAppend(baseline, hidden),
      denied,
      digest: forwardVaultDigest(baseline),
    };
  } finally {
    Object.defineProperty(Reflect, "ownKeys", descriptor);
  }
  assert.deepEqual(observed, {
    valid: false, append: "REJECTED_INVALID", denied: true, digest: originalDigest,
  });
});

test("v0.1 rejects inherited exotic metadata despite ambient Object.getPrototypeOf spoofing", () => {
  const exotic = Object.assign(Object.create({ syntheticInherited: "not-bound" }), membership()) as Membership;
  assert.equal(validateForwardVaultRecord(exotic).valid, false);
  const descriptor = Object.getOwnPropertyDescriptor(Object, "getPrototypeOf");
  assert.ok(descriptor);
  const native = Object.getPrototypeOf;
  let observed: { valid: boolean; append: string; denied: boolean } | undefined;
  try {
    Object.defineProperty(Object, "getPrototypeOf", {
      ...descriptor,
      value(target: object): object | null {
        return target === exotic ? Object.prototype : native(target);
      },
    });
    let denied = false;
    try { forwardVaultDigest(exotic); } catch (error) { denied = error instanceof TypeError; }
    observed = {
      valid: validateForwardVaultRecord(exotic).valid,
      append: classifyForwardVaultAppend(undefined, exotic),
      denied,
    };
  } finally {
    Object.defineProperty(Object, "getPrototypeOf", descriptor);
  }
  assert.deepEqual(observed, { valid: false, append: "REJECTED_INVALID", denied: true });
});

test("v0.1 rejects accessor metadata without getter execution despite forged own descriptors", () => {
  const accessor = { ...membership() };
  let getterReads = 0;
  Object.defineProperty(accessor, "reason", {
    enumerable: true, configurable: true,
    get() { getterReads++; return "synthetic:forged"; },
  });
  assert.equal(validateForwardVaultRecord(accessor).valid, false);
  assert.equal(getterReads, 0);
  const descriptor = Object.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptor");
  assert.ok(descriptor);
  const native = Object.getOwnPropertyDescriptor;
  let observed: { valid: boolean; append: string; denied: boolean; getterReads: number } | undefined;
  try {
    Object.defineProperty(Object, "getOwnPropertyDescriptor", {
      ...descriptor,
      value(target: object, key: PropertyKey): PropertyDescriptor | undefined {
        if (target === accessor && key === "reason") {
          return { value: "synthetic:forged", enumerable: true, writable: true, configurable: true };
        }
        return native(target, key);
      },
    });
    let denied = false;
    try { forwardVaultDigest(accessor); } catch (error) { denied = error instanceof TypeError; }
    observed = {
      valid: validateForwardVaultRecord(accessor).valid,
      append: classifyForwardVaultAppend(undefined, accessor),
      denied, getterReads,
    };
  } finally {
    Object.defineProperty(Object, "getOwnPropertyDescriptor", descriptor);
  }
  assert.deepEqual(observed, {
    valid: false, append: "REJECTED_INVALID", denied: true, getterReads: 0,
  });
});
