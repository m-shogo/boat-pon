import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("catalog-state reconcile blocks definition drift before any write path", () => {
  const source = readFileSync("scripts/reconcile-catalog-state.ts", "utf8");
  const driftGuard = source.indexOf("if (plan.staleDefinition.length > 0)");
  const noChange = source.indexOf("if (!changed)");
  const applyGuard = source.indexOf("if (!apply)");
  const stateWrite = source.indexOf("atomicWriteJson(statePath, nextState, true)");

  assert.ok(driftGuard >= 0, "reconcile must explicitly fail closed on definition drift");
  assert.ok(noChange >= 0 && driftGuard < noChange, "definition drift must not be reported as NO_CHANGE");
  assert.ok(applyGuard >= 0 && driftGuard < applyGuard, "definition drift must block before apply handling");
  assert.ok(stateWrite >= 0 && driftGuard < stateWrite, "definition drift must block before queue-state persistence");
  assert.match(source, /task definition mismatch requires explicit revalidation/);
});
