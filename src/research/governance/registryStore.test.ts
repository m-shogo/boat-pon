import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendRecord, appendRecordIdempotent, checkLineage, listRecords, validateAllRegistries } from "./registryStore";

function tmp(): string { return mkdtempSync(join(tmpdir(), "reg-")); }

const experiment = {
  experimentId: "EXP-0001", researchQuestion: "q", rationale: "r", hypothesis: "h", dataSnapshot: "ds-v1",
  trialFamilyId: "TF-1", totalTrialCount: 3, testedConditions: 3, discoveryPeriod: "..2022",
  validationPeriod: "2022..2024", holdoutPolicy: "untouched", primaryMetric: "logloss", secondaryMetrics: [],
  minimumSample: 100, stoppingRule: "n>=100", successCondition: "s", rejectionCondition: "rj",
  multiplicityFamily: "TF-1", evidenceStage: "discovery", status: "completed", createdAt: "2026-08-05T00:00:00Z",
};

test("strict append-only writes once and refuses duplicate/invalid", () => {
  const root = tmp();
  const a = appendRecord(root, "experiments", { ...experiment });
  assert.equal(a.ok, true);
  assert.equal(appendRecord(root, "experiments", { ...experiment }).code, "DUPLICATE");
  assert.equal(appendRecord(root, "experiments", { ...experiment, experimentId: "X" }).code, "INVALID");
  assert.equal(listRecords(root, "experiments").length, 1);
});

test("idempotent append accepts same canonical body and rejects same-id conflict", () => {
  const root = tmp();
  const first = appendRecordIdempotent(root, "experiments", { ...experiment });
  assert.equal(first.code, "OK");
  const retry = appendRecordIdempotent(root, "experiments", { ...experiment });
  assert.equal(retry.ok, true);
  assert.equal(retry.code, "ALREADY_RECORDED");
  const conflict = appendRecordIdempotent(root, "experiments", { ...experiment, hypothesis: "different" });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, "CONFLICT");
  assert.equal(listRecords(root, "experiments").length, 1);
});

test("strategy-version uses composite filename", () => {
  const root = tmp();
  const v = { strategyId: "STRAT-a", version: "v1.0", datasetVersion: "d", featureVersion: "f", modelVersion: "m", decisionRuleVersion: "dr", ticketSelectorVersion: "ts", changeType: "parameter", changeReason: "x", adoptedDiscoveryIds: [], createdAt: "t" };
  assert.equal(appendRecord(root, "strategy-versions", v).ok, true);
  assert.equal(appendRecord(root, "strategy-versions", { ...v, version: "v1.1" }).ok, true);
  assert.equal(appendRecord(root, "strategy-versions", v).code, "DUPLICATE");
});

test("validateAllRegistries detects mutation and missing digest", () => {
  const root = tmp();
  const r = appendRecord(root, "experiments", { ...experiment });
  assert.equal(validateAllRegistries(root).ok, true);
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
  appendRecord(root, "discoveries", { discoveryId: "DISC-2", sourceExperimentIds: ["EXP-GHOST"], sourceStrategyId: null, sourceStrategyVersion: null, finding: "f", mechanismHypothesis: "m", evidenceLevel: "weak", shareClass: "GLOBAL_FACT", scope: "s", knownConfounders: [], trialFamilyId: "TF-1", trialCountAtDiscovery: 1, adoptedBy: [], rejectedBy: [], createdAt: "t" });
  const l = checkLineage(root);
  assert.equal(l.ok, false);
  assert.ok(l.problems.some((p) => p.includes("EXP-GHOST")));
});
