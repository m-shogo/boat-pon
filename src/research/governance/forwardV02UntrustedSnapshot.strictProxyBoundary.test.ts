import assert from "node:assert/strict";
import test from "node:test";
import {
  snapshotForwardV02UntrustedGraphRejectingProxies,
} from "./forwardV02UntrustedSnapshot";

const strictSnapshot = snapshotForwardV02UntrustedGraphRejectingProxies;

test("strict Node ingress detaches ordinary nested metadata without granting authority", () => {
  const source = { freeze: { cohortId: "synthetic-cohort" }, revisions: [{ state: "REVOKED" }] };
  const snapshot = strictSnapshot(source) as typeof source;
  source.freeze.cohortId = "changed";
  source.revisions[0]!.state = "ACTIVE";
  assert.deepEqual(snapshot, { freeze: { cohortId: "synthetic-cohort" }, revisions: [{ state: "REVOKED" }] });
  assert.notEqual(snapshot.freeze, source.freeze);
});

test("strict ingress rejects a root Proxy before prototype, key or descriptor traps", () => {
  let traps = 0;
  const proxy = new Proxy({ state: "REVOKED" }, {
    getPrototypeOf(target) { traps++; return Reflect.getPrototypeOf(target); },
    ownKeys(target) { traps++; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) {
      traps++;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.throws(() => strictSnapshot(proxy), /INVALID_SNAPSHOT/);
  assert.equal(traps, 0);
});

test("strict ingress rejects a nested child Proxy before it repairs a later sibling", () => {
  const source: Array<{ state: string }> = [{ state: "REVOKED" }, { state: "REVOKED" }];
  let traps = 0;
  source[0] = new Proxy(source[0]!, {
    getPrototypeOf(target) {
      traps++;
      source[1]!.state = "ACTIVE";
      return Reflect.getPrototypeOf(target);
    },
  });
  assert.throws(() => strictSnapshot(source), /INVALID_SNAPSHOT/);
  assert.equal(traps, 0);
  assert.equal(source[1]!.state, "REVOKED");
});

test("strict ingress rejects a later sibling Proxy without executing descriptor repair", () => {
  const source: Array<{ state: string }> = [{ state: "REVOKED" }, { state: "ACTIVE" }];
  let traps = 0;
  source[1] = new Proxy(source[1]!, {
    getOwnPropertyDescriptor(target, key) {
      traps++;
      source[0]!.state = "ACTIVE";
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.throws(() => strictSnapshot(source), /INVALID_SNAPSHOT/);
  assert.equal(traps, 0);
  assert.equal(source[0]!.state, "REVOKED");
});

test("strict ingress fails closed on revoked Proxies and accessor values", () => {
  const revoked = Proxy.revocable({ state: "REVOKED" }, {});
  revoked.revoke();
  assert.throws(() => strictSnapshot(revoked.proxy), /INVALID_SNAPSHOT/);
  let reads = 0;
  const input = { state: "REVOKED" };
  Object.defineProperty(input, "state", {
    enumerable: true, configurable: true,
    get() { reads++; return "ACTIVE"; },
  });
  assert.throws(() => strictSnapshot(input), /INVALID_SNAPSHOT/);
  assert.equal(reads, 0);
});
