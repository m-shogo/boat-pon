import assert from "node:assert/strict";
import test from "node:test";
import {
  compareForwardV02ClaimedInstants,
  validForwardV02ClaimedInstant,
} from "./forwardV02ClaimedInstant";

/**
 * Reuse the existing shadow-evidence RegExp/Date/Reflect learning guardrails.
 * All values are synthetic and claimed, never independently authenticated.
 * Mutations are synchronous and restored before any test assertion.
 */
test("claimed-instant admission and submillisecond order ignore post-import ambient hooks", () => {
  const first = "2026-10-24T00:00:00.000000001Z";
  const second = "2026-10-24T00:00:00.000000002Z";
  const equivalent = "2026-10-24T09:00:00.000000001+09:00";
  const hooks: ReadonlyArray<readonly [object, string]> = [
    [RegExp.prototype, "exec"],
    [Date, "parse"],
    [Reflect, "apply"],
    [String.prototype, "replace"],
    [String.prototype, "slice"],
    [String.prototype, "endsWith"],
    [String.prototype, "padEnd"],
    [Number, "isFinite"],
  ];
  const original = hooks.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key)!);
  let observed: {
    admitted: boolean; malformed: boolean; unknownOffset: boolean;
    earlier: number; equal: number; invalidThrows: boolean;
  } | undefined;
  let thrown: unknown;
  try {
    for (const [target, key] of hooks) {
      Object.defineProperty(target, key, {
        configurable: true, writable: true,
        value: () => { throw new Error("AMBIENT_HOOK_CALLED"); },
      });
    }
    observed = {
      admitted: validForwardV02ClaimedInstant(first),
      malformed: validForwardV02ClaimedInstant("not-an-instant"),
      unknownOffset: validForwardV02ClaimedInstant("2026-10-24T00:00:00-00:00"),
      earlier: compareForwardV02ClaimedInstants(first, second),
      equal: compareForwardV02ClaimedInstants(first, equivalent),
      invalidThrows: (() => {
        try { compareForwardV02ClaimedInstants("invalid", first); return false; }
        catch (error) { return error instanceof TypeError && error.message === "INVALID_CLAIMED_INSTANT"; }
      })(),
    };
  } catch (error) {
    thrown = error;
  } finally {
    for (let i = hooks.length - 1; i >= 0; i--) {
      const [target, key] = hooks[i]!;
      Object.defineProperty(target, key, original[i]!);
    }
  }
  assert.equal(thrown, undefined);
  assert.deepEqual(observed, {
    admitted: true, malformed: false, unknownOffset: false,
    earlier: -1, equal: 0, invalidThrows: true,
  });
});
