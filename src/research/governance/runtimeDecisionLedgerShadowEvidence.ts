import { createHash } from "node:crypto";
import type {
  RuntimeDecisionLedgerMappingContext,
  RuntimeDecisionLedgerReconciliation,
} from "./runtimeDecisionLedgerMapper";

export const RUNTIME_DECISION_LEDGER_SHADOW_EVIDENCE_SCHEMA_VERSION =
  "runtime-decision-ledger-shadow-evidence.0.1";

export type RuntimeDecisionLedgerShadowEvidenceVerdict = "PASS" | "CONDITIONAL" | "FAILED";

export type RuntimeDecisionLedgerShadowSourceDescriptor = {
  fileSizeBytes: number;
  modifiedTimeMs: number;
  sqliteSchemaVersion: number;
  sqliteUserVersion: number;
  pageCount: number;
  pageSizeBytes: number;
  freelistCount: number;
  journalMode: string;
  walPresent: boolean;
  readOnly: true;
  queryOnly: true;
};

export type RuntimeDecisionLedgerShadowScope = {
  runKind: string;
  modelVersion: string;
  from: string | null;
  to: string | null;
  limit: number;
  returnedRows: number;
  limitReached: boolean;
  bounded: true;
};

export type RuntimeDecisionLedgerShadowEvidence = {
  schemaVersion: typeof RUNTIME_DECISION_LEDGER_SHADOW_EVIDENCE_SCHEMA_VERSION;
  generatedAt: string;
  verdict: RuntimeDecisionLedgerShadowEvidenceVerdict;
  sourceDescriptorDigest: string;
  contextDigest: string;
  scope: RuntimeDecisionLedgerShadowScope;
  source: RuntimeDecisionLedgerShadowSourceDescriptor;
  reconciliation: {
    status: RuntimeDecisionLedgerReconciliation["status"];
    sourceRows: number;
    mappedUnique: number;
    exactDuplicates: number;
    unresolvedCount: number;
    rejectedCount: number;
    conflictCount: number;
    recordsDigest: string;
  };
  completeness: {
    mappedRate: number | null;
    unresolvedRate: number | null;
    rejectedRate: number | null;
    conflictRate: number | null;
    unresolvedReasonCounts: Record<string, number>;
    rejectedReasonCounts: Record<string, number>;
    taxonomyCounts: Record<string, number>;
  };
  privacy: {
    rawRecordsIncluded: false;
    sourceRowIdsIncluded: false;
    raceIdsIncluded: false;
    selectionsIncluded: false;
    absolutePathsIncluded: false;
    localDbPathIncluded: false;
    outcomeColumnsRead: false;
  };
  safety: {
    operationalDbWrites: 0;
    notificationWrites: 0;
    lineSends: 0;
    appSettingsReads: 0;
    publicWrites: 0;
    productionPromotion: false;
  };
  contentDigest: string;
};

export type RuntimeDecisionLedgerShadowEvidenceInput = {
  generatedAt: string;
  source: RuntimeDecisionLedgerShadowSourceDescriptor;
  scope: RuntimeDecisionLedgerShadowScope;
  context: RuntimeDecisionLedgerMappingContext;
  reconciliation: RuntimeDecisionLedgerReconciliation;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function countReasons(rows: Array<{ reasons: string[] }>): Record<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const reason of row.reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function taxonomyForReason(reason: string): string {
  if (reason === "source_row_update_or_odds_observation_after_created_at") return "source_mutability";
  if (
    reason.includes("timezone") ||
    reason.includes("timestamp") ||
    reason.includes("scheduled_close") ||
    reason.includes("program_import") ||
    reason.includes("close_time") ||
    reason.includes("decision occurs after") ||
    reason.includes("odds observation occurs after")
  ) return "temporal_provenance";
  if (reason.includes("model_version") || reason.includes("identity")) return "identity_completeness";
  if (reason.includes("conflict")) return "identity_conflict";
  return "schema_or_value";
}

function taxonomyCounts(
  unresolved: Record<string, number>,
  rejected: Record<string, number>,
  conflictCount: number,
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const [reason, count] of [...Object.entries(unresolved), ...Object.entries(rejected)]) {
    const taxonomy = taxonomyForReason(reason);
    counts.set(taxonomy, (counts.get(taxonomy) ?? 0) + count);
  }
  if (conflictCount > 0) counts.set("identity_conflict", (counts.get("identity_conflict") ?? 0) + conflictCount);
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function rate(count: number, total: number): number | null {
  return total === 0 ? null : count / total;
}

function evidenceVerdict(input: RuntimeDecisionLedgerShadowEvidenceInput): RuntimeDecisionLedgerShadowEvidenceVerdict {
  if (input.reconciliation.conflictCount > 0 || input.reconciliation.status === "FAILED") return "FAILED";
  if (
    input.reconciliation.sourceRows === 0 ||
    input.scope.limitReached ||
    input.reconciliation.unresolvedCount > 0 ||
    input.reconciliation.rejectedCount > 0 ||
    input.reconciliation.status === "CONDITIONAL"
  ) return "CONDITIONAL";
  return "PASS";
}

function expectedEvidenceVerdict(evidence: RuntimeDecisionLedgerShadowEvidence): RuntimeDecisionLedgerShadowEvidenceVerdict {
  const reconciliation = evidence.reconciliation;
  if (reconciliation.conflictCount > 0 || reconciliation.status === "FAILED") return "FAILED";
  if (
    reconciliation.sourceRows === 0 ||
    evidence.scope.limitReached ||
    reconciliation.unresolvedCount > 0 ||
    reconciliation.rejectedCount > 0 ||
    reconciliation.status === "CONDITIONAL"
  ) return "CONDITIONAL";
  return "PASS";
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function canonicalGeneratedAt(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function expectedRate(count: number, total: number): number | null {
  return total === 0 ? null : count / total;
}

function rateMatches(actual: unknown, count: number, total: number): boolean {
  const expected = expectedRate(count, total);
  return expected === null ? actual === null : actual === expected;
}

function digestableEvidence(
  evidence: Omit<RuntimeDecisionLedgerShadowEvidence, "generatedAt" | "contentDigest">,
): unknown {
  return evidence;
}

export function buildRuntimeDecisionLedgerShadowEvidence(
  input: RuntimeDecisionLedgerShadowEvidenceInput,
): RuntimeDecisionLedgerShadowEvidence {
  const unresolvedReasonCounts = countReasons(input.reconciliation.unresolved);
  const rejectedReasonCounts = countReasons(input.reconciliation.rejected);
  const base: Omit<RuntimeDecisionLedgerShadowEvidence, "generatedAt" | "contentDigest"> = {
    schemaVersion: RUNTIME_DECISION_LEDGER_SHADOW_EVIDENCE_SCHEMA_VERSION,
    verdict: evidenceVerdict(input),
    sourceDescriptorDigest: digest(input.source),
    contextDigest: digest(input.context),
    scope: input.scope,
    source: input.source,
    reconciliation: {
      status: input.reconciliation.status,
      sourceRows: input.reconciliation.sourceRows,
      mappedUnique: input.reconciliation.mappedUnique,
      exactDuplicates: input.reconciliation.exactDuplicates,
      unresolvedCount: input.reconciliation.unresolvedCount,
      rejectedCount: input.reconciliation.rejectedCount,
      conflictCount: input.reconciliation.conflictCount,
      recordsDigest: input.reconciliation.recordsDigest,
    },
    completeness: {
      mappedRate: rate(input.reconciliation.mappedUnique, input.reconciliation.sourceRows),
      unresolvedRate: rate(input.reconciliation.unresolvedCount, input.reconciliation.sourceRows),
      rejectedRate: rate(input.reconciliation.rejectedCount, input.reconciliation.sourceRows),
      conflictRate: rate(input.reconciliation.conflictCount, input.reconciliation.sourceRows),
      unresolvedReasonCounts,
      rejectedReasonCounts,
      taxonomyCounts: taxonomyCounts(
        unresolvedReasonCounts,
        rejectedReasonCounts,
        input.reconciliation.conflictCount,
      ),
    },
    privacy: {
      rawRecordsIncluded: false,
      sourceRowIdsIncluded: false,
      raceIdsIncluded: false,
      selectionsIncluded: false,
      absolutePathsIncluded: false,
      localDbPathIncluded: false,
      outcomeColumnsRead: false,
    },
    safety: {
      operationalDbWrites: 0,
      notificationWrites: 0,
      lineSends: 0,
      appSettingsReads: 0,
      publicWrites: 0,
      productionPromotion: false,
    },
  };
  return {
    ...base,
    generatedAt: input.generatedAt,
    contentDigest: digest(digestableEvidence(base)),
  };
}

const TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "generatedAt",
  "verdict",
  "sourceDescriptorDigest",
  "contextDigest",
  "scope",
  "source",
  "reconciliation",
  "completeness",
  "privacy",
  "safety",
  "contentDigest",
]);

const FORBIDDEN_KEYS = new Set([
  "records",
  "record",
  "sourceDecisionHistoryId",
  "decisionId",
  "canonicalRaceId",
  "raceId",
  "selection",
  "dbPath",
  "localPath",
  "result",
  "payoutYen",
  "stakeYen",
]);

function walk(value: unknown, path: string, errors: string[]): void {
  if (typeof value === "string") {
    if (/^(?:\/|file:\/\/|[A-Za-z]:\\)/.test(value) || value.includes("/Users/") || value.includes("\\Users\\")) {
      errors.push(`absolute path-like value at ${path}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) errors.push(`forbidden key at ${path}.${key}`);
    walk(entry, `${path}.${key}`, errors);
  }
}

export function validateRuntimeDecisionLedgerShadowEvidence(
  value: unknown,
): { valid: boolean; errors: string[]; evidence: RuntimeDecisionLedgerShadowEvidence | null } {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["evidence must be an object"], evidence: null };
  for (const key of Object.keys(value)) if (!TOP_LEVEL_KEYS.has(key)) errors.push(`unknown top-level field: ${key}`);
  for (const key of TOP_LEVEL_KEYS) if (!(key in value)) errors.push(`missing top-level field: ${key}`);
  if (errors.length > 0) return { valid: false, errors, evidence: null };

  const evidence = value as unknown as RuntimeDecisionLedgerShadowEvidence;
  if (evidence.schemaVersion !== RUNTIME_DECISION_LEDGER_SHADOW_EVIDENCE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${RUNTIME_DECISION_LEDGER_SHADOW_EVIDENCE_SCHEMA_VERSION}`);
  }
  if (!canonicalGeneratedAt(evidence.generatedAt)) errors.push("generatedAt must be a canonical UTC date-time");
  if (!(["PASS", "CONDITIONAL", "FAILED"] as string[]).includes(evidence.verdict)) errors.push("invalid verdict");
  for (const [name, valueToCheck] of [
    ["sourceDescriptorDigest", evidence.sourceDescriptorDigest],
    ["contextDigest", evidence.contextDigest],
    ["recordsDigest", evidence.reconciliation?.recordsDigest],
    ["contentDigest", evidence.contentDigest],
  ] as const) {
    if (typeof valueToCheck !== "string" || !/^[0-9a-f]{64}$/.test(valueToCheck)) errors.push(`${name} must be sha256 hex`);
  }

  if (evidence.sourceDescriptorDigest !== digest(evidence.source)) {
    errors.push("sourceDescriptorDigest mismatch");
  }

  const source = evidence.source;
  for (const [name, count] of [
    ["fileSizeBytes", source.fileSizeBytes],
    ["sqliteSchemaVersion", source.sqliteSchemaVersion],
    ["sqliteUserVersion", source.sqliteUserVersion],
    ["pageCount", source.pageCount],
    ["freelistCount", source.freelistCount],
  ] as const) {
    if (!nonNegativeSafeInteger(count)) errors.push(`source.${name} must be a non-negative safe integer`);
  }
  if (!Number.isSafeInteger(source.pageSizeBytes) || source.pageSizeBytes < 1) {
    errors.push("source.pageSizeBytes must be a positive safe integer");
  }
  if (!Number.isFinite(source.modifiedTimeMs) || source.modifiedTimeMs < 0) {
    errors.push("source.modifiedTimeMs must be a non-negative finite number");
  }
  if (typeof source.journalMode !== "string" || source.journalMode.trim().length === 0) {
    errors.push("source.journalMode must be a non-empty string");
  }

  const r = evidence.reconciliation;
  if (!r || !isRecord(r)) {
    errors.push("reconciliation must be an object");
  } else {
    if (!(["PASS", "CONDITIONAL", "FAILED"] as string[]).includes(r.status)) {
      errors.push("reconciliation.status is invalid");
    }
    for (const [name, count] of [
      ["sourceRows", r.sourceRows],
      ["mappedUnique", r.mappedUnique],
      ["exactDuplicates", r.exactDuplicates],
      ["unresolvedCount", r.unresolvedCount],
      ["rejectedCount", r.rejectedCount],
      ["conflictCount", r.conflictCount],
    ] as const) {
      if (!nonNegativeSafeInteger(count)) errors.push(`${name} must be a non-negative safe integer`);
    }
    if (
      nonNegativeSafeInteger(r.sourceRows) &&
      r.sourceRows !== r.mappedUnique + r.exactDuplicates + r.unresolvedCount + r.rejectedCount + r.conflictCount
    ) errors.push("reconciliation counts do not sum to sourceRows");
  }

  if (!Number.isSafeInteger(evidence.scope.limit) || evidence.scope.limit < 1 || evidence.scope.limit > 5000) {
    errors.push("scope.limit must be an integer between 1 and 5000");
  }
  if (!nonNegativeSafeInteger(evidence.scope.returnedRows)) {
    errors.push("scope.returnedRows must be a non-negative safe integer");
  }
  if (evidence.scope.bounded !== true) errors.push("scope.bounded must be true");
  if (typeof evidence.scope.limitReached !== "boolean") errors.push("scope.limitReached must be boolean");
  if (Number.isSafeInteger(evidence.scope.limit)
    && nonNegativeSafeInteger(evidence.scope.returnedRows)
    && evidence.scope.returnedRows > evidence.scope.limit) {
    errors.push("scope.returnedRows must not exceed scope.limit");
  }
  if (evidence.scope.returnedRows !== evidence.reconciliation.sourceRows) {
    errors.push("scope.returnedRows must equal reconciliation.sourceRows");
  }
  if (evidence.scope.limitReached && evidence.scope.returnedRows !== evidence.scope.limit) {
    errors.push("limitReached requires returnedRows to equal limit");
  }
  if (evidence.source.walPresent) errors.push("bounded evidence requires walPresent=false");
  if (evidence.source.readOnly !== true || evidence.source.queryOnly !== true) {
    errors.push("source must be readOnly and queryOnly");
  }

  const expectedVerdict = expectedEvidenceVerdict(evidence);
  if (evidence.verdict !== expectedVerdict) errors.push(`verdict must be ${expectedVerdict}`);

  if (!rateMatches(evidence.completeness.mappedRate, r.mappedUnique, r.sourceRows)) {
    errors.push("completeness.mappedRate mismatch");
  }
  if (!rateMatches(evidence.completeness.unresolvedRate, r.unresolvedCount, r.sourceRows)) {
    errors.push("completeness.unresolvedRate mismatch");
  }
  if (!rateMatches(evidence.completeness.rejectedRate, r.rejectedCount, r.sourceRows)) {
    errors.push("completeness.rejectedRate mismatch");
  }
  if (!rateMatches(evidence.completeness.conflictRate, r.conflictCount, r.sourceRows)) {
    errors.push("completeness.conflictRate mismatch");
  }

  for (const [name, actual] of Object.entries(evidence.privacy)) {
    if (actual !== false) errors.push(`privacy.${name} must be false`);
  }
  for (const field of ["operationalDbWrites", "notificationWrites", "lineSends", "appSettingsReads", "publicWrites"] as const) {
    if (evidence.safety[field] !== 0) errors.push(`safety.${field} must be 0`);
  }
  if (evidence.safety.productionPromotion !== false) errors.push("safety.productionPromotion must be false");

  const expectedDigest = digest(digestableEvidence({
    schemaVersion: evidence.schemaVersion,
    verdict: evidence.verdict,
    sourceDescriptorDigest: evidence.sourceDescriptorDigest,
    contextDigest: evidence.contextDigest,
    scope: evidence.scope,
    source: evidence.source,
    reconciliation: evidence.reconciliation,
    completeness: evidence.completeness,
    privacy: evidence.privacy,
    safety: evidence.safety,
  }));
  if (evidence.contentDigest !== expectedDigest) errors.push("contentDigest mismatch");

  walk(evidence, "$", errors);
  return { valid: errors.length === 0, errors, evidence: errors.length === 0 ? evidence : null };
}
