import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const core = readFileSync("scripts/report-paper-forward-candidates-core.ts", "utf-8");
const raw = readFileSync("scripts/report-paper-forward-candidates-raw.ts", "utf-8");
const internal = readFileSync("scripts/report-paper-forward-candidates-internal.ts", "utf-8");
const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { scripts?: Record<string, string> };

test("paper-forward core cannot bypass official settlement completeness when invoked directly", () => {
  const preflight = core.indexOf('run("scripts/audit-odds-payout-gap-completeness.ts")');
  const handoffIdentity = core.indexOf("PAPER_FORWARD_CORE_DB_HANDOFF_IDENTITY_INVALID");
  const internalRun = core.indexOf('run("scripts/report-paper-forward-candidates-internal.ts", {');

  assert.ok(preflight >= 0, "core must invoke the canonical settlement-integrity preflight");
  assert.ok(handoffIdentity > preflight, "core must reverify DB identity after the settlement preflight");
  assert.ok(internalRun > handoffIdentity, "internal aggregation must run only after DB handoff identity verification");
  assert.match(core, /if \(preflight !== 0\)[\s\S]*process\.exit\(preflight\)/);
  assert.match(core, /BOAT_PON_DB_PATH: handoffDbPath/);
});

test("paper-forward public raw compatibility entrypoint is guarded and DB-free", () => {
  const scripts = Object.values(pkg.scripts ?? {});
  assert.equal(scripts.some((command) => command.includes("report-paper-forward-candidates-raw.ts")), false);

  const preflight = raw.indexOf('run("scripts/audit-odds-payout-gap-completeness.ts")');
  const internalRun = raw.indexOf('run("scripts/report-paper-forward-candidates-internal.ts"');
  assert.ok(preflight >= 0, "raw compatibility entrypoint must invoke settlement preflight");
  assert.ok(internalRun > preflight, "raw compatibility entrypoint must not aggregate before preflight");
  assert.doesNotMatch(raw, /new DatabaseSync/u);
});

test("paper-forward aggregation implementation remains read-only behind guarded entrypoints", () => {
  assert.match(internal, /new DatabaseSync\(DB_PATH, \{ readOnly: true \}\)/);
  assert.doesNotMatch(internal, /db\.(?:exec|prepare)\(\s*[`\"']\s*(?:INSERT|UPDATE|DELETE|DROP)\b/i);
});