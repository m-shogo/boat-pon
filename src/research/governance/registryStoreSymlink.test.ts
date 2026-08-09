import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendRecordIdempotent, listRecords, validateAllRegistries } from "./registryStore";

function tmp(): string { return mkdtempSync(join(tmpdir(), "reg-symlink-")); }

const experiment = {
  experimentId: "EXP-0001", researchQuestion: "q", rationale: "r", hypothesis: "h", dataSnapshot: "ds-v1",
  trialFamilyId: "TF-1", totalTrialCount: 3, testedConditions: 3, discoveryPeriod: "..2022",
  validationPeriod: "2022..2024", holdoutPolicy: "untouched", primaryMetric: "logloss", secondaryMetrics: [],
  minimumSample: 100, stoppingRule: "n>=100", successCondition: "s", rejectionCondition: "rj",
  multiplicityFamily: "TF-1", evidenceStage: "discovery", status: "completed", createdAt: "2026-08-05T00:00:00Z",
};

test("idempotent append refuses an existing record symlink before reading outside content", () => {
  const root = tmp();
  const experiments = join(root, "experiments");
  mkdirSync(experiments, { recursive: true });
  const outside = join(tmp(), "outside.json");
  writeFileSync(outside, JSON.stringify({ ...experiment, _digest: "forged" }));
  symlinkSync(outside, join(experiments, "EXP-0001.json"));

  const result = appendRecordIdempotent(root, "experiments", experiment);
  assert.equal(result.ok, false);
  assert.equal(result.code, "CONFLICT");
  assert.match(result.errors.join("\n"), /registry symlink forbidden \(record\)/);
});

test("listRecords refuses a symlinked registry kind directory", () => {
  const root = tmp();
  const outside = tmp();
  symlinkSync(outside, join(root, "experiments"), "dir");
  assert.throws(() => listRecords(root, "experiments"), /registry symlink forbidden \(kind\)/);
});

test("validateAllRegistries reports record symlinks as integrity problems", () => {
  const root = tmp();
  const experiments = join(root, "experiments");
  mkdirSync(experiments, { recursive: true });
  const outside = join(tmp(), "outside.json");
  writeFileSync(outside, "{}\n");
  symlinkSync(outside, join(experiments, "EXP-0001.json"));

  const result = validateAllRegistries(root);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.file === "EXP-0001.json" && p.errors.some((e) => e.includes("registry symlink forbidden (record)"))));
});

test("listRecords refuses a non-directory registry kind container", () => {
  const root = tmp();
  writeFileSync(join(root, "experiments"), "not-a-directory\n");
  assert.throws(() => listRecords(root, "experiments"), /registry container must be directory \(kind\)/);
});

test("idempotent append refuses a non-regular existing record before reading it", () => {
  const root = tmp();
  const experiments = join(root, "experiments");
  mkdirSync(join(experiments, "EXP-0001.json"), { recursive: true });

  const result = appendRecordIdempotent(root, "experiments", experiment);
  assert.equal(result.ok, false);
  assert.equal(result.code, "CONFLICT");
  assert.match(result.errors.join("\n"), /registry record must be regular file/);
});

test("validateAllRegistries reports non-regular record entries as integrity problems", () => {
  const root = tmp();
  const experiments = join(root, "experiments");
  mkdirSync(join(experiments, "EXP-0001.json"), { recursive: true });

  const result = validateAllRegistries(root);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.file === "EXP-0001.json" && p.errors.some((e) => e.includes("registry record must be regular file"))));
});
