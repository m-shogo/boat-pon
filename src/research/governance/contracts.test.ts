import assert from "node:assert/strict";
import test from "node:test";
import {
  CLEAN_ROOM_SHAREABLE, contractDigest, detectCleanRoomViolations, detectUnauthorizedAdoptions, legacyContractDigest,
  validateDiscovery, validateExperiment, validatePromotion, validateRejection, validateStrategyFamily,
  validateStrategyVersion, validateTransferExperiment,
  type Discovery, type StrategyFamily, type StrategyVersion, type TransferExperiment,
} from "./contracts";

const exp = (o: Record<string, unknown> = {}) => ({
  experimentId: "EXP-0001", researchQuestion: "q", rationale: "r", hypothesis: "h", dataSnapshot: "ds-v1",
  trialFamilyId: "TF-1", totalTrialCount: 3, testedConditions: 3, discoveryPeriod: "..2022", validationPeriod: "2022..2024",
  holdoutPolicy: "untouched", primaryMetric: "logloss", secondaryMetrics: ["roi"], minimumSample: 1000, stoppingRule: "n>=1000",
  successCondition: "logloss<baseline", rejectionCondition: "no improvement", multiplicityFamily: "TF-1", evidenceStage: "discovery",
  status: "proposed", createdAt: "2026-08-05T00:00:00Z", ...o,
});

test("valid experiment passes; missing/invalid rejected", () => {
  assert.equal(validateExperiment(exp()).valid, true);
  assert.equal(validateExperiment(exp({ experimentId: "X-1" })).valid, false);
  assert.equal(validateExperiment(exp({ evidenceStage: "wat" })).valid, false);
  const missing = exp(); delete (missing as any).hypothesis;
  assert.ok(validateExperiment(missing).errors.some((e) => e.includes("hypothesis")));
});

const disc = (o: Record<string, unknown> = {}): Discovery => ({
  discoveryId: "DISC-0001", sourceExperimentIds: ["EXP-0001"], sourceStrategyId: null, sourceStrategyVersion: null,
  finding: "f", mechanismHypothesis: "m", evidenceLevel: "moderate", shareClass: "REUSABLE_CANDIDATE", scope: "venue",
  knownConfounders: [], trialFamilyId: "TF-1", trialCountAtDiscovery: 3, adoptedBy: [], rejectedBy: [], createdAt: "2026-08-05T00:00:00Z", ...o,
});
test("discovery validation + shareClass", () => {
  assert.equal(validateDiscovery(disc()).valid, true);
  assert.equal(validateDiscovery(disc({ shareClass: "SECRET" as any })).valid, false);
  assert.equal(validateDiscovery(disc({ sourceExperimentIds: [] })).valid, false);
});

const fam = (o: Record<string, unknown> = {}): StrategyFamily => ({
  strategyId: "STRAT-market-resid", strategyName: "market residual", coreThesis: "market misprice", mechanismHypothesis: "residual",
  parentExperimentIds: ["EXP-0001"], knowledgePolicy: "OPEN_COMMONS", cleanRoomPolicy: { isolated: false, allowedShareClasses: ["GLOBAL_FACT", "RESEARCH_METHOD", "REUSABLE_CANDIDATE"] },
  decisionSystem: "market_intelligence", createdAt: "2026-08-05T00:00:00Z", ...o,
});
test("strategy family + clean-room policy constraint", () => {
  assert.equal(validateStrategyFamily(fam()).valid, true);
  assert.equal(validateStrategyFamily(fam({ knowledgePolicy: "CLEAN_ROOM", cleanRoomPolicy: { isolated: true, allowedShareClasses: ["GLOBAL_FACT", "REUSABLE_CANDIDATE"] } })).valid, false);
  assert.equal(validateStrategyFamily(fam({ knowledgePolicy: "CLEAN_ROOM", cleanRoomPolicy: { isolated: true, allowedShareClasses: ["GLOBAL_FACT", "RESEARCH_METHOD"] } })).valid, true);
});

const ver = (o: Record<string, unknown> = {}): StrategyVersion => ({
  strategyId: "STRAT-market-resid", version: "v1.0", datasetVersion: "ds-v1", featureVersion: "fv1", modelVersion: "mv1",
  decisionRuleVersion: "dr1", ticketSelectorVersion: "ts1", changeType: "parameter", changeReason: "init", adoptedDiscoveryIds: [], createdAt: "2026-08-05T00:00:00Z", ...o,
});
test("strategy version validation", () => {
  assert.equal(validateStrategyVersion(ver()).valid, true);
  assert.equal(validateStrategyVersion(ver({ changeType: "wat" })).valid, false);
});

const xfer = (o: Record<string, unknown> = {}): TransferExperiment => ({
  transferId: "XFER-0001", sourceDiscoveryId: "DISC-0001", targetStrategyId: "STRAT-market-resid", baseVersion: "v1.0", candidateVersion: "v1.1",
  historicalComparison: "hc", validation: "val", untouchedHoldout: "ho", shadowForward: "sf", calibration: "cal", roiLowerBound: 0.98,
  maxHitRemoval: "top2", drawdown: "dd", coverage: "cov", diversityImpact: "low", result: "pending", createdAt: "2026-08-05T00:00:00Z", ...o,
});
test("transfer experiment validation", () => {
  assert.equal(validateTransferExperiment(xfer()).valid, true);
  assert.equal(validateTransferExperiment(xfer({ sourceDiscoveryId: "EXP-1" })).valid, false);
});

test("promotion requires human approval + transfer for active_research; production always false", () => {
  const base = { promotionId: "PROMO-1", strategyId: "STRAT-market-resid", fromVersion: "v1.0", evidenceDigests: [], productionConnection: false, createdAt: "2026-08-05T00:00:00Z" };
  assert.equal(validatePromotion({ ...base, toState: "candidate", transferExperimentIds: [], humanApproval: { approved: false, approver: null, approvedAt: null, note: "" } }).valid, true);
  assert.equal(validatePromotion({ ...base, toState: "active_research", transferExperimentIds: ["XFER-0001"], humanApproval: { approved: false, approver: null, approvedAt: null, note: "" } }).valid, false);
  assert.equal(validatePromotion({ ...base, toState: "active_research", transferExperimentIds: ["XFER-0001"], humanApproval: { approved: true, approver: "m-shogo", approvedAt: "t", note: "ok" } }).valid, true);
  assert.equal(validatePromotion({ ...base, toState: "candidate", transferExperimentIds: [], productionConnection: true as any, humanApproval: { approved: false, approver: null, approvedAt: null, note: "" } }).valid, false);
});

test("rejection validation enforces subject identity namespace", () => {
  const base = { rejectionId: "REJ-1", reason: "no effect", evidenceStage: "validation", trialFamilyId: "TF-1", createdAt: "t" };
  assert.equal(validateRejection({ ...base, subjectType: "experiment", subjectId: "EXP-1" }).valid, true);
  assert.equal(validateRejection({ ...base, subjectType: "discovery", subjectId: "DISC-1" }).valid, true);
  assert.equal(validateRejection({ ...base, subjectType: "strategy", subjectId: "STRAT-1" }).valid, true);
  assert.equal(validateRejection({ ...base, subjectType: "transfer", subjectId: "XFER-1" }).valid, true);
  assert.equal(validateRejection({ ...base, subjectType: "discovery", subjectId: "H-1" }).valid, false);
  assert.equal(validateRejection({ ...base, subjectType: "experiment", subjectId: "DISC-1" }).valid, false);
  assert.equal(validateRejection({ ...base, rejectionId: "X", subjectType: "experiment", subjectId: "EXP-1" }).valid, false);
});

test("clean-room violation: isolated family adopting non-shareable discovery", () => {
  const families = [fam({ strategyId: "STRAT-clean", knowledgePolicy: "CLEAN_ROOM", cleanRoomPolicy: { isolated: true, allowedShareClasses: ["GLOBAL_FACT", "RESEARCH_METHOD"] } })];
  const discoveries = [disc({ discoveryId: "DISC-secret", shareClass: "STRATEGY_LOCAL" }), disc({ discoveryId: "DISC-fact", shareClass: "GLOBAL_FACT" })];
  const versions = [ver({ strategyId: "STRAT-clean", adoptedDiscoveryIds: ["DISC-secret", "DISC-fact"] })];
  const v = detectCleanRoomViolations(families, discoveries, versions);
  assert.equal(v.length, 1);
  assert.equal(v[0].discoveryId, "DISC-secret");
});

test("unauthorized adoption: adoptedBy without accepted transfer", () => {
  const discoveries = [disc({ discoveryId: "DISC-a", adoptedBy: ["STRAT-x"] })];
  const transfersNone: TransferExperiment[] = [];
  assert.equal(detectUnauthorizedAdoptions(discoveries, transfersNone).length, 1);
  const transfersOk = [xfer({ transferId: "XFER-9", sourceDiscoveryId: "DISC-a", targetStrategyId: "STRAT-x", result: "accepted" })];
  assert.equal(detectUnauthorizedAdoptions(discoveries, transfersOk).length, 0);
});

test("CLEAN_ROOM_SHAREABLE excludes strategy-local classes; digest stable", () => {
  assert.equal(CLEAN_ROOM_SHAREABLE.has("STRATEGY_LOCAL"), false);
  assert.equal(CLEAN_ROOM_SHAREABLE.has("REUSABLE_CANDIDATE"), false);
  assert.equal(CLEAN_ROOM_SHAREABLE.has("GLOBAL_FACT"), true);
  assert.equal(contractDigest({ a: 1, b: 2 }), contractDigest({ b: 2, a: 1 }));
});

test("contractDigest canonicalizes nested objects and arrays while detecting nested mutations", () => {
  const left = {
    promotionId: "PROMO-1",
    humanApproval: { approved: true, approver: "m-shogo", note: "ok" },
    evidence: [{ digest: "a", meta: { stage: "holdout", version: 1 } }],
  };
  const reordered = {
    evidence: [{ meta: { version: 1, stage: "holdout" }, digest: "a" }],
    humanApproval: { note: "ok", approver: "m-shogo", approved: true },
    promotionId: "PROMO-1",
  };
  const mutated = {
    ...left,
    humanApproval: { ...left.humanApproval, approved: false },
  };

  assert.equal(contractDigest(left), contractDigest(reordered));
  assert.notEqual(contractDigest(left), contractDigest(mutated));
  assert.equal(contractDigest({ ...left, _digest: "old", _digestVersion: "canonical-v2", _recordedAt: "t" }), contractDigest(left));
});

test("legacyContractDigest stays byte-compatible with pre-v2 nested omission", () => {
  const left = { strategyId: "STRAT-a", cleanRoomPolicy: { isolated: false, allowedShareClasses: ["GLOBAL_FACT"] } };
  const mutatedNested = { strategyId: "STRAT-a", cleanRoomPolicy: { isolated: true, allowedShareClasses: ["RESEARCH_METHOD"] } };
  assert.equal(legacyContractDigest(left), legacyContractDigest(mutatedNested));
  assert.notEqual(contractDigest(left), contractDigest(mutatedNested));
});
