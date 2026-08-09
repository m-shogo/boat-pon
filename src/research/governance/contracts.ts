// boat-pon 研究ガバナンス契約（純粋ロジック層・Git 正本）。
//
// 中核原則: 「発見は共有する。採用は競争させる。思想は保護する。」
// - 探索は自由、検証は厳格。ROI だけで昇格しない。Discovery を自動採用しない。
// - Current BUY（legacy_t5_formal）と Research（market_intelligence）を混ぜない。
// - historical / validation / holdout / shadow_forward / future_only を混ぜない。
//
// 本モジュールは production / DB / sidecar / credential に一切触れない（純関数）。
import { createHash } from "node:crypto";

export const GOVERNANCE_CONTRACT_VERSION = "research-governance-v1";
export const CONTRACT_DIGEST_VERSION = "canonical-v2";

// ---- 共有分類（発見の共有スコープ）----
export const SHARE_CLASSES = ["GLOBAL_FACT", "RESEARCH_METHOD", "REUSABLE_CANDIDATE", "STRATEGY_LOCAL"] as const;
export type ShareClass = (typeof SHARE_CLASSES)[number];
// clean-room で共有可能なのは方式非依存の事実・手法・安全知見のみ。
export const CLEAN_ROOM_SHAREABLE: ReadonlySet<ShareClass> = new Set(["GLOBAL_FACT", "RESEARCH_METHOD"]);

// ---- 証拠段階（評価系列を混ぜないための識別）----
export const EVIDENCE_STAGES = ["exploration", "discovery", "validation", "holdout", "shadow_forward", "future_only"] as const;
export type EvidenceStage = (typeof EVIDENCE_STAGES)[number];

// ---- 評価系列（識別契約）----
export const DECISION_SYSTEMS = ["legacy_t5_formal", "market_intelligence"] as const;
export type DecisionSystem = (typeof DECISION_SYSTEMS)[number];
export const EVALUATION_MODES = ["formal_forward", "shadow_forward"] as const;
export type EvaluationMode = (typeof EVALUATION_MODES)[number];

// ---- knowledge / clean-room policy ----
export const KNOWLEDGE_POLICIES = ["OPEN_COMMONS", "CLEAN_ROOM"] as const;
export type KnowledgePolicy = (typeof KNOWLEDGE_POLICIES)[number];

// ---- promotion / status ----
export const PROMOTION_STATES = ["candidate", "shadow", "challenger", "active_research", "rejected", "archived"] as const;
export type PromotionState = (typeof PROMOTION_STATES)[number];

export type Validation = { valid: boolean; errors: string[] };
const err = (errors: string[]): Validation => ({ valid: errors.length === 0, errors });
const isStr = (x: unknown): x is string => typeof x === "string" && x.length > 0;
const isArr = (x: unknown): x is unknown[] => Array.isArray(x);
const isId = (x: unknown, prefix: string): boolean => typeof x === "string" && new RegExp(`^${prefix}-[0-9A-Za-z._-]{1,80}$`).test(x);

function digestHex(serialized: string): string {
  return createHash("sha256").update(serialized).digest("hex");
}

function stripDigestMetadata(obj: Record<string, unknown>): Record<string, unknown> {
  const { _digest, _digestVersion, _recordedAt, ...rest } = obj as Record<string, unknown> & {
    _digest?: unknown;
    _digestVersion?: unknown;
    _recordedAt?: unknown;
  };
  return rest;
}

function canonicalizeDigestValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeDigestValue);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalizeDigestValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

// v1 compatibility only. JSON.stringify の replacer 配列が nested key を落とす旧挙動を
// 既存 append-only record の検証専用として固定する。新規 record 生成には使わない。
export function legacyContractDigest(obj: Record<string, unknown>): string {
  const rest = stripDigestMetadata(obj);
  return digestHex(JSON.stringify(rest, Object.keys(rest).sort()));
}

// canonical-v2 digest（lineage / evidence 用）。nested object も再帰的に key 順を正規化する。
export function contractDigest(obj: Record<string, unknown>): string {
  const rest = stripDigestMetadata(obj);
  return digestHex(JSON.stringify(canonicalizeDigestValue(rest)));
}

// ---- Experiment 契約 ----
export type Experiment = {
  experimentId: string;              // EXP-<id>（中立的に開始）
  researchQuestion: string;
  rationale: string;
  hypothesis: string;
  dataSnapshot: string;              // manifest / dataset version 識別
  trialFamilyId: string;             // 多重検定 family
  totalTrialCount: number;
  testedConditions: number;
  discoveryPeriod: string;
  validationPeriod: string;
  holdoutPolicy: string;
  primaryMetric: string;
  secondaryMetrics: string[];
  minimumSample: number;
  stoppingRule: string;
  successCondition: string;
  rejectionCondition: string;
  multiplicityFamily: string;
  evidenceStage: EvidenceStage;
  status: "proposed" | "running" | "completed" | "rejected" | "inconclusive";
  createdAt: string;
};
const EXP_FIELDS = ["experimentId", "researchQuestion", "rationale", "hypothesis", "dataSnapshot", "trialFamilyId", "totalTrialCount", "testedConditions", "discoveryPeriod", "validationPeriod", "holdoutPolicy", "primaryMetric", "secondaryMetrics", "minimumSample", "stoppingRule", "successCondition", "rejectionCondition", "multiplicityFamily", "evidenceStage", "status", "createdAt"] as const;

export function validateExperiment(x: unknown): Validation {
  if (typeof x !== "object" || x === null) return err(["experiment must be object"]);
  const e = x as Record<string, unknown>; const errors: string[] = [];
  for (const f of EXP_FIELDS) if (!(f in e)) errors.push(`missing ${f}`);
  if (!isId(e.experimentId, "EXP")) errors.push("experimentId must match EXP-*");
  for (const f of ["researchQuestion", "rationale", "hypothesis", "dataSnapshot", "trialFamilyId", "primaryMetric", "stoppingRule", "successCondition", "rejectionCondition", "multiplicityFamily"]) if (!isStr(e[f])) errors.push(`${f} required`);
  if (!EVIDENCE_STAGES.includes(e.evidenceStage as EvidenceStage)) errors.push("invalid evidenceStage");
  if (!["proposed", "running", "completed", "rejected", "inconclusive"].includes(e.status as string)) errors.push("invalid status");
  if (!Number.isInteger(e.totalTrialCount) || (e.totalTrialCount as number) < 0) errors.push("totalTrialCount must be >=0 int");
  if (!Number.isInteger(e.testedConditions) || (e.testedConditions as number) < 0) errors.push("testedConditions must be >=0 int");
  if (!isArr(e.secondaryMetrics)) errors.push("secondaryMetrics must be array");
  return err(errors);
}

// ---- Discovery 契約 ----
export type Discovery = {
  discoveryId: string;               // DISC-<id>
  sourceExperimentIds: string[];
  sourceStrategyId: string | null;
  sourceStrategyVersion: string | null;
  finding: string;
  mechanismHypothesis: string;
  evidenceLevel: "weak" | "moderate" | "strong";
  shareClass: ShareClass;
  scope: string;
  knownConfounders: string[];
  trialFamilyId: string;
  trialCountAtDiscovery: number;
  adoptedBy: string[];               // Transfer Experiment 経由でのみ増える
  rejectedBy: string[];
  createdAt: string;
};
const DISC_FIELDS = ["discoveryId", "sourceExperimentIds", "sourceStrategyId", "sourceStrategyVersion", "finding", "mechanismHypothesis", "evidenceLevel", "shareClass", "scope", "knownConfounders", "trialFamilyId", "trialCountAtDiscovery", "adoptedBy", "rejectedBy", "createdAt"] as const;

export function validateDiscovery(x: unknown): Validation {
  if (typeof x !== "object" || x === null) return err(["discovery must be object"]);
  const d = x as Record<string, unknown>; const errors: string[] = [];
  for (const f of DISC_FIELDS) if (!(f in d)) errors.push(`missing ${f}`);
  if (!isId(d.discoveryId, "DISC")) errors.push("discoveryId must match DISC-*");
  if (!isArr(d.sourceExperimentIds) || (d.sourceExperimentIds as unknown[]).length === 0) errors.push("sourceExperimentIds required");
  if (d.sourceStrategyId === null) {
    if (d.sourceStrategyVersion !== null) errors.push("sourceStrategyId/sourceStrategyVersion must both be null or both be set");
  } else {
    if (!isId(d.sourceStrategyId, "STRAT")) errors.push("sourceStrategyId must match STRAT-* when set");
    if (!isStr(d.sourceStrategyVersion)) errors.push("sourceStrategyId/sourceStrategyVersion must both be null or both be set");
  }
  if (!isStr(d.finding) || !isStr(d.mechanismHypothesis) || !isStr(d.scope)) errors.push("finding/mechanismHypothesis/scope required");
  if (!["weak", "moderate", "strong"].includes(d.evidenceLevel as string)) errors.push("invalid evidenceLevel");
  if (!SHARE_CLASSES.includes(d.shareClass as ShareClass)) errors.push("invalid shareClass");
  if (!isArr(d.adoptedBy) || !isArr(d.rejectedBy)) errors.push("adoptedBy/rejectedBy must be arrays");
  if (!Number.isInteger(d.trialCountAtDiscovery)) errors.push("trialCountAtDiscovery must be int");
  return err(errors);
}

// ---- Strategy Family 契約 ----
export type StrategyFamily = {
  strategyId: string;                // STRAT-<id>
  strategyName: string;              // 仮説ラベル（証明ではない）
  coreThesis: string;
  mechanismHypothesis: string;
  parentExperimentIds: string[];
  knowledgePolicy: KnowledgePolicy;
  cleanRoomPolicy: { isolated: boolean; allowedShareClasses: ShareClass[] };
  decisionSystem: DecisionSystem;    // legacy_t5_formal（Current BUY）or market_intelligence
  createdAt: string;
};
export function validateStrategyFamily(x: unknown): Validation {
  if (typeof x !== "object" || x === null) return err(["family must be object"]);
  const s = x as Record<string, unknown>; const errors: string[] = [];
  if (!isId(s.strategyId, "STRAT")) errors.push("strategyId must match STRAT-*");
  for (const f of ["strategyName", "coreThesis", "mechanismHypothesis"]) if (!isStr(s[f])) errors.push(`${f} required`);
  if (!KNOWLEDGE_POLICIES.includes(s.knowledgePolicy as KnowledgePolicy)) errors.push("invalid knowledgePolicy");
  if (!DECISION_SYSTEMS.includes(s.decisionSystem as DecisionSystem)) errors.push("invalid decisionSystem");
  const cr = s.cleanRoomPolicy as any;
  if (!cr || typeof cr.isolated !== "boolean" || !isArr(cr.allowedShareClasses)) errors.push("cleanRoomPolicy invalid");
  // clean-room family は STRATEGY_LOCAL / REUSABLE_CANDIDATE を共有許可に含めてはならない。
  if (cr && cr.isolated && isArr(cr.allowedShareClasses)) {
    const bad = (cr.allowedShareClasses as ShareClass[]).filter((c) => !CLEAN_ROOM_SHAREABLE.has(c));
    if (bad.length) errors.push(`clean-room family cannot share: ${bad.join(",")}`);
  }
  return err(errors);
}

// ---- Strategy Version 契約（version と promotion を混同しない）----
export type StrategyVersion = {
  strategyId: string;
  version: string;                   // v<major>.<minor>
  datasetVersion: string;
  featureVersion: string;
  modelVersion: string;
  decisionRuleVersion: string;
  ticketSelectorVersion: string;
  changeType: "new_family" | "same_thesis_improvement" | "parameter" | "observation_only";
  changeReason: string;
  adoptedDiscoveryIds: string[];
  createdAt: string;
};
export function validateStrategyVersion(x: unknown): Validation {
  if (typeof x !== "object" || x === null) return err(["version must be object"]);
  const v = x as Record<string, unknown>; const errors: string[] = [];
  if (!isId(v.strategyId, "STRAT")) errors.push("strategyId must match STRAT-*");
  for (const f of ["version", "datasetVersion", "featureVersion", "modelVersion", "decisionRuleVersion", "ticketSelectorVersion", "changeReason"]) if (!isStr(v[f])) errors.push(`${f} required`);
  if (!["new_family", "same_thesis_improvement", "parameter", "observation_only"].includes(v.changeType as string)) errors.push("invalid changeType");
  if (!isArr(v.adoptedDiscoveryIds)) errors.push("adoptedDiscoveryIds must be array");
  return err(errors);
}

// ---- Transfer Experiment 契約（Discovery を他方式へ入れる唯一の経路）----
export type TransferExperiment = {
  transferId: string;                // XFER-<id>
  sourceDiscoveryId: string;
  targetStrategyId: string;
  baseVersion: string;
  candidateVersion: string;
  historicalComparison: string;
  validation: string;
  untouchedHoldout: string;
  shadowForward: string;
  calibration: string;
  roiLowerBound: number | null;
  maxHitRemoval: string;
  drawdown: string;
  coverage: string;
  diversityImpact: string;
  result: "pending" | "accepted" | "rejected";
  createdAt: string;
};
export function validateTransferExperiment(x: unknown): Validation {
  if (typeof x !== "object" || x === null) return err(["transfer must be object"]);
  const t = x as Record<string, unknown>; const errors: string[] = [];
  if (!isId(t.transferId, "XFER")) errors.push("transferId must match XFER-*");
  if (!isId(t.sourceDiscoveryId, "DISC")) errors.push("sourceDiscoveryId must match DISC-*");
  if (!isId(t.targetStrategyId, "STRAT")) errors.push("targetStrategyId must match STRAT-*");
  for (const f of ["baseVersion", "candidateVersion", "historicalComparison", "validation", "untouchedHoldout", "shadowForward", "calibration", "maxHitRemoval", "drawdown", "coverage", "diversityImpact"]) if (!isStr(t[f])) errors.push(`${f} required`);
  if (!["pending", "accepted", "rejected"].includes(t.result as string)) errors.push("invalid result");
  return err(errors);
}

// ---- Promotion 契約（人間承認必須。research result を production approval にしない）----
export type Promotion = {
  promotionId: string;               // PROMO-<id>
  strategyId: string;
  fromVersion: string;
  toState: PromotionState;
  transferExperimentIds: string[];
  evidenceDigests: string[];
  humanApproval: { approved: boolean; approver: string | null; approvedAt: string | null; note: string };
  productionConnection: false;       // 常に false（型でも禁止）
  createdAt: string;
};
export function validatePromotion(x: unknown): Validation {
  if (typeof x !== "object" || x === null) return err(["promotion must be object"]);
  const p = x as Record<string, unknown>; const errors: string[] = [];
  if (!isId(p.promotionId, "PROMO")) errors.push("promotionId must match PROMO-*");
  if (!isId(p.strategyId, "STRAT")) errors.push("strategyId must match STRAT-*");
  if (!PROMOTION_STATES.includes(p.toState as PromotionState)) errors.push("invalid toState");
  if ((p as any).productionConnection !== false) errors.push("productionConnection must be false");
  const ha = p.humanApproval as any;
  if (!ha || typeof ha.approved !== "boolean") errors.push("humanApproval.approved required");
  if (ha?.approved) {
    if (!isStr(ha.approver)) errors.push("approved humanApproval requires approver");
    if (!isStr(ha.approvedAt)) errors.push("approved humanApproval requires approvedAt");
  }
  // active_research/challenger 昇格は人間承認 + transfer 証拠が必須。
  if (["active_research", "challenger"].includes(p.toState as string)) {
    if (!ha?.approved) errors.push("promotion to active_research/challenger requires human approval");
    if (!isArr(p.transferExperimentIds) || (p.transferExperimentIds as unknown[]).length === 0) errors.push("promotion requires transferExperimentIds");
  }
  return err(errors);
}

// ---- Rejection 契約（棄却・negative result を保存）----
export type Rejection = {
  rejectionId: string;               // REJ-<id>
  subjectType: "experiment" | "discovery" | "strategy" | "transfer";
  subjectId: string;
  reason: string;
  evidenceStage: EvidenceStage;
  trialFamilyId: string | null;
  createdAt: string;
};
export function validateRejection(x: unknown): Validation {
  if (typeof x !== "object" || x === null) return err(["rejection must be object"]);
  const r = x as Record<string, unknown>; const errors: string[] = [];
  if (!isId(r.rejectionId, "REJ")) errors.push("rejectionId must match REJ-*");
  if (!["experiment", "discovery", "strategy", "transfer"].includes(r.subjectType as string)) errors.push("invalid subjectType");
  if (!isStr(r.subjectId) || !isStr(r.reason)) errors.push("subjectId/reason required");
  if (!EVIDENCE_STAGES.includes(r.evidenceStage as EvidenceStage)) errors.push("invalid evidenceStage");
  return err(errors);
}

// ---- clean-room 違反検査（family 間の STRATEGY_LOCAL / REUSABLE 漏洩）----
// clean-room family が非共有 shareClass の discovery を adopt していたら違反。
export function detectCleanRoomViolations(
  families: StrategyFamily[], discoveries: Discovery[], versions: StrategyVersion[],
): Array<{ strategyId: string; discoveryId: string; shareClass: ShareClass; reason: string }> {
  const violations: Array<{ strategyId: string; discoveryId: string; shareClass: ShareClass; reason: string }> = [];
  const discById = new Map(discoveries.map((d) => [d.discoveryId, d]));
  const cleanRoom = new Set(families.filter((f) => f.cleanRoomPolicy?.isolated).map((f) => f.strategyId));
  for (const v of versions) {
    if (!cleanRoom.has(v.strategyId)) continue;
    for (const did of v.adoptedDiscoveryIds ?? []) {
      const disc = discById.get(did);
      if (disc && !CLEAN_ROOM_SHAREABLE.has(disc.shareClass)) {
        violations.push({ strategyId: v.strategyId, discoveryId: did, shareClass: disc.shareClass, reason: `clean-room family adopted non-shareable ${disc.shareClass}` });
      }
    }
  }
  return violations;
}

// ---- lineage: adopt は Transfer Experiment 経由でのみ許可（自動採用不可を構造化）----
export function detectUnauthorizedAdoptions(
  discoveries: Discovery[], transfers: TransferExperiment[],
): Array<{ discoveryId: string; strategyId: string; reason: string }> {
  const accepted = new Set(transfers.filter((t) => t.result === "accepted").map((t) => `${t.sourceDiscoveryId}|${t.targetStrategyId}`));
  const out: Array<{ discoveryId: string; strategyId: string; reason: string }> = [];
  for (const d of discoveries) {
    for (const sid of d.adoptedBy ?? []) {
      if (!accepted.has(`${d.discoveryId}|${sid}`)) {
        out.push({ discoveryId: d.discoveryId, strategyId: sid, reason: "adopted without an accepted Transfer Experiment" });
      }
    }
  }
  return out;
}
