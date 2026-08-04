import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendRecord, checkLineage, listRecords, validateAllRegistries } from "./registryStore";

function tmp(): string { return mkdtempSync(join(tmpdir(), "reg-")); }

const experiment = { experimentId: "EXP-0001", researchQuestion: "q", rationale: "r", hypothesis: "h", dataSnapshot: "ds-v1", trialFamilyId: "TF-1", totalTrialCount: 3, testedConditions: 3, discoveryPeriod: "..2022", validationPeriod: "2022..2024", holdoutPolicy: "untouched", primaryMetric: "logloss", secondaryMetrics: [], minimumSample: 100, stoppingRule: "n>=100", successCondition: "s", rejectionCondition: "rj", multiplicityFamily: "TF-1", evidenceStage: "discovery", status: "completed", createdAt: "2026-08-05T00:00:00Z" };

test("append-only: valid record writes; duplicate refused; invalid refused", () => {
  const root = tmp();
  const a = appendRecord(root, "experiments", { ...experiment });
  assert.equal(a.ok, true);
  const dup = appendRecord(root, "experiments", { ...experiment });
  assert.equal(dup.ok, false); assert.equal(dup.code, "DUPLICATE");
  const bad = appendRecord(root, "experiments", { ...experiment, experimentId: "X" });
  assert.equal(bad.ok, false); assert.equal(bad.code, "INVALID");
  assert.equal(listRecords(root, "experiments").length, 1);
});

test("strategy-version uses composite filename (strategyId + version)", () => {
  const root = tmp();
  const v = { strategyId: "STRAT-a", version: "v1.0", datasetVersion: "d", featureVersion: "f", modelVersion: "m", decisionRuleVersion: "dr", ticketSelectorVersion: "ts", changeType: "parameter", changeReason: "x", adoptedDiscoveryIds: [], createdAt: "t" };
  assert.equal(appendRecord(root, "strategy-versions", v).ok, true);
  // same strategy different version → allowed
  assert.equal(appendRecord(root, "strategy-versions", { ...v, version: "v1.1" }).ok, true);
  // same composite → duplicate
  assert.equal(appendRecord(root, "strategy-versions", v).code, "DUPLICATE");
  assert.equal(listRecords(root, "strategy-versions").length, 2);
});

test("validateAllRegistries detects post-append mutation (digest mismatch)", () => {
  const root = tmp();
  const r = appendRecord(root, "experiments", { ...experiment });
  assert.equal(validateAllRegistries(root).ok, true);
  // tamper: mutate body but keep old digest
  const rec = JSON.parse(readFileSync(r.path!, "utf8"));
  rec.hypothesis = "tampered";
  writeFileSync(r.path!, JSON.stringify(rec, null, 2));
  const v = validateAllRegistries(root);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => p.errors.some((e) => e.includes("digest mismatch"))));
});

test("checkLineage flags dangling references", () => {
  const root = tmp();
  appendRecord(root, "experiments", { ...experiment });
  appendRecord(root, "discoveries", { discoveryId: "DISC-1", sourceExperimentIds: ["EXP-0001"], sourceStrategyId: null, sourceStrategyVersion: null, finding: "f", mechanismHypothesis: "m", evidenceLevel: "moderate", shareClass: "GLOBAL_FACT", scope: "s", knownConfounders: [], trialFamilyId: "TF-1", trialCountAtDiscovery: 3, adoptedBy: [], rejectedBy: [], createdAt: "t" });
  assert.equal(checkLineage(root).ok, true);
  // discovery referencing a missing experiment
  appendRecord(root, "discoveries", { discoveryId: "DISC-2", sourceExperimentIds: ["EXP-GHOST"], sourceStrategyId: null, sourceStrategyVersion: null, finding: "f", mechanismHypothesis: "m", evidenceLevel: "weak", shareClass: "GLOBAL_FACT", scope: "s", knownConfounders: [], trialFamilyId: "TF-1", trialCountAtDiscovery: 1, adoptedBy: [], rejectedBy: [], createdAt: "t" });
  const l = checkLineage(root);
  assert.equal(l.ok, false);
  assert.ok(l.problems.some((p) => p.includes("EXP-GHOST")));
});
