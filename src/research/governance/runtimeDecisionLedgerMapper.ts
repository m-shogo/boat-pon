import { createHash } from "node:crypto";
import {
  RUNTIME_DECISION_LEDGER_SCHEMA_VERSION,
  runtimeDecisionLedgerDigest,
  validateRuntimeDecisionLedgerRecord,
  type RuntimeDecision,
  type RuntimeDecisionLedgerRecord,
  type RuntimeEvaluationMode,
} from "./runtimeDecisionLedger";

export type DecisionHistoryShadowRow = {
  id: number;
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
  bet_type: string;
  selection: string;
  estimated_hit_rate: number;
  raw_estimated_hit_rate: number | null;
  required_odds: number;
  current_odds: number | null;
  ev: number | null;
  decision: string;
  recommended_stake_yen: number;
  sample_size: number;
  model_version: string | null;
  run_kind: string;
  source: string;
  fetched_at: string;
  created_at: string;
  decision_reasons: string | null;
  feature_adjustment: number | null;
  feature_adjustment_breakdown: string | null;
  close_at: string | null;
  program_imported_at: string | null;
};

export type RuntimeDecisionLedgerMappingContext = {
  decisionSystem: string;
  strategyVersion: string;
  featureVersion: string;
  manifestId: string;
  cohortId: string;
  evaluationMode: RuntimeEvaluationMode;
  lineNotificationEligible?: boolean;
};

export type RuntimeDecisionLedgerMapResult =
  | {
      status: "mapped";
      record: RuntimeDecisionLedgerRecord;
      ledgerDigest: string;
      warnings: string[];
    }
  | {
      status: "unresolved";
      sourceDecisionHistoryId: number | null;
      reasons: string[];
    }
  | {
      status: "rejected";
      sourceDecisionHistoryId: number | null;
      reasons: string[];
    };

export type RuntimeDecisionLedgerConflict = {
  recordId: string;
  sourceDecisionHistoryId: number | null;
  firstDigest: string;
  conflictingDigest: string;
};

export type RuntimeDecisionLedgerReconciliation = {
  status: "PASS" | "CONDITIONAL" | "FAILED";
  sourceRows: number;
  mappedUnique: number;
  exactDuplicates: number;
  unresolvedCount: number;
  rejectedCount: number;
  conflictCount: number;
  recordsDigest: string;
  records: RuntimeDecisionLedgerRecord[];
  unresolved: Array<{ sourceDecisionHistoryId: number | null; reasons: string[] }>;
  rejected: Array<{ sourceDecisionHistoryId: number | null; reasons: string[] }>;
  conflicts: RuntimeDecisionLedgerConflict[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function hasValidCalendarDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T| )(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day >= 1 && day <= daysInMonth;
}

function normalizeUtcTimestamp(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)) {
    if (!hasValidCalendarDateTime(trimmed)) return null;
    const parsed = Date.parse(`${trimmed.replace(" ", "T")}Z`);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(trimmed) || !hasValidCalendarDateTime(trimmed)) return null;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeCloseTimestamp(date: string, closeAt: string): string | null {
  const trimmed = closeAt.trim();
  if (/^\d{2}:\d{2}$/.test(trimmed)) {
    const source = `${date}T${trimmed}:00+09:00`;
    if (!hasValidCalendarDateTime(source)) return null;
    const parsed = Date.parse(source);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  if (/^\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    const source = `${date}T${trimmed}+09:00`;
    if (!hasValidCalendarDateTime(source)) return null;
    const parsed = Date.parse(source);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  return normalizeUtcTimestamp(trimmed);
}

function parseReasons(value: string | null): { reasons: string[]; warnings: string[] } {
  if (!value) return { reasons: [], warnings: [] };
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.some((entry) => !nonEmpty(entry))) {
      return { reasons: [], warnings: ["decision_reasons_not_string_array"] };
    }
    return { reasons: parsed.map((entry) => String(entry).trim()), warnings: [] };
  } catch {
    return { reasons: [], warnings: ["decision_reasons_invalid_json"] };
  }
}

function featureWarnings(row: DecisionHistoryShadowRow): string[] {
  const warnings: string[] = [];
  if (row.feature_adjustment == null) warnings.push("feature_adjustment_unavailable");
  if (row.feature_adjustment_breakdown == null) return warnings;
  try {
    const parsed = JSON.parse(row.feature_adjustment_breakdown) as unknown;
    if (!isRecord(parsed)) warnings.push("feature_adjustment_breakdown_not_object");
  } catch {
    warnings.push("feature_adjustment_breakdown_invalid_json");
  }
  return warnings;
}

function sourceRowDigest(row: DecisionHistoryShadowRow): string {
  return digest({
    id: row.id,
    raceId: row.race_id,
    date: row.date,
    venue: row.venue,
    raceNo: row.race_no,
    ticketType: row.bet_type,
    selection: row.selection,
    estimatedHitRate: row.estimated_hit_rate,
    rawEstimatedHitRate: row.raw_estimated_hit_rate,
    requiredOdds: row.required_odds,
    currentOdds: row.current_odds,
    expectedValue: row.ev,
    decision: row.decision,
    recommendedStakeYen: row.recommended_stake_yen,
    sampleSize: row.sample_size,
    modelVersion: row.model_version,
    runKind: row.run_kind,
    source: row.source,
    fetchedAt: row.fetched_at,
    createdAt: row.created_at,
    decisionReasons: row.decision_reasons,
    featureAdjustment: row.feature_adjustment,
    featureAdjustmentBreakdown: row.feature_adjustment_breakdown,
    closeAt: row.close_at,
    programImportedAt: row.program_imported_at,
  });
}

function validateSourceShape(row: DecisionHistoryShadowRow): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(row.id) || row.id < 1) errors.push("id must be a positive integer");
  for (const [field, value] of [
    ["race_id", row.race_id],
    ["date", row.date],
    ["venue", row.venue],
    ["bet_type", row.bet_type],
    ["selection", row.selection],
    ["run_kind", row.run_kind],
    ["source", row.source],
    ["fetched_at", row.fetched_at],
    ["created_at", row.created_at],
  ] as const) {
    if (!nonEmpty(value)) errors.push(`${field} must be non-empty`);
  }
  if (!Number.isInteger(row.race_no) || row.race_no < 1 || row.race_no > 12) errors.push("race_no is invalid");
  if (!finiteOrNull(row.raw_estimated_hit_rate)) errors.push("raw_estimated_hit_rate must be finite or null");
  for (const [field, value] of [
    ["estimated_hit_rate", row.estimated_hit_rate],
    ["required_odds", row.required_odds],
    ["current_odds", row.current_odds],
    ["ev", row.ev],
    ["feature_adjustment", row.feature_adjustment],
  ] as const) {
    if (!finiteOrNull(value)) errors.push(`${field} must be finite or null`);
  }
  if (!Number.isInteger(row.recommended_stake_yen) || row.recommended_stake_yen < 0) {
    errors.push("recommended_stake_yen must be a non-negative integer");
  }
  if (!Number.isInteger(row.sample_size) || row.sample_size < 0) errors.push("sample_size must be a non-negative integer");
  if (!(["BUY", "WATCH", "SKIP"] as string[]).includes(row.decision)) errors.push("decision is invalid");
  return errors;
}

export function mapDecisionHistoryRowToRuntimeLedger(
  row: DecisionHistoryShadowRow,
  context: RuntimeDecisionLedgerMappingContext,
): RuntimeDecisionLedgerMapResult {
  const sourceErrors = validateSourceShape(row);
  if (sourceErrors.length > 0) {
    return { status: "rejected", sourceDecisionHistoryId: Number.isInteger(row.id) ? row.id : null, reasons: sourceErrors };
  }

  const unresolved: string[] = [];
  const decisionAt = normalizeUtcTimestamp(row.created_at);
  const oddsObservedAt = normalizeUtcTimestamp(row.fetched_at);
  const programImportedAt = row.program_imported_at == null ? null : normalizeUtcTimestamp(row.program_imported_at);
  const scheduledCloseAtSeen = row.close_at == null ? null : normalizeCloseTimestamp(row.date, row.close_at);

  if (decisionAt == null) unresolved.push("decision_at_timezone_or_format_unresolved");
  if (oddsObservedAt == null) unresolved.push("odds_observed_at_timezone_or_format_unresolved");
  if (row.model_version == null || !nonEmpty(row.model_version)) unresolved.push("model_version_missing");
  if (row.close_at == null || scheduledCloseAtSeen == null) unresolved.push("scheduled_close_missing_or_invalid");
  if (row.program_imported_at == null || programImportedAt == null) unresolved.push("program_import_time_missing_or_invalid");

  if (decisionAt != null && oddsObservedAt != null && Date.parse(oddsObservedAt) > Date.parse(decisionAt)) {
    unresolved.push("source_row_update_or_odds_observation_after_created_at");
  }
  if (decisionAt != null && programImportedAt != null && Date.parse(programImportedAt) > Date.parse(decisionAt)) {
    unresolved.push("close_time_not_proven_visible_at_decision");
  }

  if (unresolved.length > 0) {
    return { status: "unresolved", sourceDecisionHistoryId: row.id, reasons: [...new Set(unresolved)] };
  }

  const parsedReasons = parseReasons(row.decision_reasons);
  const warnings = [...parsedReasons.warnings, ...featureWarnings(row)];
  const decision = row.decision as RuntimeDecision;
  const notificationEligible = context.lineNotificationEligible === true && decision === "BUY";
  const currentOddsPresent = row.current_odds != null && row.current_odds > 0;
  const dataCompleteness = decision === "BUY" || currentOddsPresent ? "complete" : "partial";
  const sourceDigest = sourceRowDigest(row);

  const record: RuntimeDecisionLedgerRecord = {
    schemaVersion: RUNTIME_DECISION_LEDGER_SCHEMA_VERSION,
    recordId: `runtime-decision:${context.decisionSystem}:decision-history:${row.id}`,
    decisionId: `decision-history:${row.id}`,
    canonicalRaceId: row.race_id,
    sourceDecisionHistoryId: row.id,
    decisionSystem: context.decisionSystem,
    strategyVersion: context.strategyVersion,
    modelVersion: row.model_version!,
    featureVersion: context.featureVersion,
    manifestId: context.manifestId,
    cohortId: context.cohortId,
    evaluationMode: context.evaluationMode,
    ticketType: row.bet_type,
    selection: row.selection,
    decision,
    decisionAt: decisionAt!,
    oddsObservedAt: row.current_odds == null ? null : oddsObservedAt!,
    scheduledCloseAtSeen: scheduledCloseAtSeen!,
    currentOdds: row.current_odds,
    requiredOdds: row.required_odds,
    estimatedHitRate: row.estimated_hit_rate,
    rawEstimatedHitRate: row.raw_estimated_hit_rate,
    expectedValue: row.ev,
    recommendedStakeYen: row.recommended_stake_yen,
    sampleSize: row.sample_size,
    reasons: parsedReasons.reasons,
    warnings: [...new Set(warnings)],
    dataCompleteness,
    notificationEligible,
    notificationDedupeKey: notificationEligible ? `line:${row.race_id}` : null,
    sourceRowDigest: sourceDigest,
  };

  const validation = validateRuntimeDecisionLedgerRecord(record);
  if (!validation.valid) {
    return { status: "rejected", sourceDecisionHistoryId: row.id, reasons: validation.errors };
  }

  return {
    status: "mapped",
    record,
    ledgerDigest: runtimeDecisionLedgerDigest(record),
    warnings: record.warnings,
  };
}

export function reconcileDecisionHistoryRowsToRuntimeLedger(
  rows: DecisionHistoryShadowRow[],
  context: RuntimeDecisionLedgerMappingContext,
): RuntimeDecisionLedgerReconciliation {
  const records = new Map<string, { record: RuntimeDecisionLedgerRecord; digest: string }>();
  const unresolved: RuntimeDecisionLedgerReconciliation["unresolved"] = [];
  const rejected: RuntimeDecisionLedgerReconciliation["rejected"] = [];
  const conflicts: RuntimeDecisionLedgerConflict[] = [];
  let exactDuplicates = 0;

  for (const row of rows) {
    const result = mapDecisionHistoryRowToRuntimeLedger(row, context);
    if (result.status === "unresolved") {
      unresolved.push({ sourceDecisionHistoryId: result.sourceDecisionHistoryId, reasons: result.reasons });
      continue;
    }
    if (result.status === "rejected") {
      rejected.push({ sourceDecisionHistoryId: result.sourceDecisionHistoryId, reasons: result.reasons });
      continue;
    }

    const existing = records.get(result.record.recordId);
    if (!existing) {
      records.set(result.record.recordId, { record: result.record, digest: result.ledgerDigest });
      continue;
    }
    if (existing.digest === result.ledgerDigest) {
      exactDuplicates += 1;
      continue;
    }
    conflicts.push({
      recordId: result.record.recordId,
      sourceDecisionHistoryId: result.record.sourceDecisionHistoryId,
      firstDigest: existing.digest,
      conflictingDigest: result.ledgerDigest,
    });
  }

  const ordered = [...records.values()].map((entry) => entry.record).sort((a, b) => a.recordId.localeCompare(b.recordId));
  const status = conflicts.length > 0
    ? "FAILED"
    : unresolved.length > 0 || rejected.length > 0
      ? "CONDITIONAL"
      : "PASS";

  return {
    status,
    sourceRows: rows.length,
    mappedUnique: ordered.length,
    exactDuplicates,
    unresolvedCount: unresolved.length,
    rejectedCount: rejected.length,
    conflictCount: conflicts.length,
    recordsDigest: digest(ordered.map((record) => runtimeDecisionLedgerDigest(record))),
    records: ordered,
    unresolved,
    rejected,
    conflicts,
  };
}
