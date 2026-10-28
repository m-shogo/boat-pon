import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
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

// Inspect only own data descriptors: no Proxy traps or accessor getters execute.
// Bound traversal so an unexpected cyclic/deep graph cannot become an unbounded preflight.
function hasProxyInOwnData(value: unknown, visited: object[] = []): boolean {
  if (isProxy(value)) return true;
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
  for (let index = 0; index < visited.length; index++) {
    if (visited[index] === value) return false;
  }
  if (visited.length >= 10000) return true;
  Object.defineProperty(visited, String(visited.length), {
    value, writable: true, enumerable: true, configurable: true,
  });
  const keys = Reflect.ownKeys(value);
  for (let index = 0; index < keys.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, keys[index]!);
    if (descriptor && "value" in descriptor && hasProxyInOwnData(descriptor.value, visited)) return true;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !isProxy(value) && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  // Never serialize a caller-controlled Proxy through its traps as canonical evidence.
  if (isProxy(value)) throw new TypeError("invalid canonical shadow evidence proxy");
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError("invalid canonical shadow evidence array");
      }
      Object.defineProperty(result, String(index), {
        value: canonicalize(descriptor.value), enumerable: true, writable: true, configurable: true,
      });
    }
    return result;
  }
  if (!isRecord(value)) return value;
  const keys = Object.keys(value);
  // Source and content digests must not depend on mutable Array.map/sort.
  for (let index = 1; index < keys.length; index++) {
    const key = keys[index]!;
    let previous = index - 1;
    while (previous >= 0 && keys[previous]! > key) {
      keys[previous + 1] = keys[previous]!;
      previous--;
    }
    keys[previous + 1] = key;
  }
  const result: Record<string, unknown> = Object.create(null);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError("invalid canonical shadow evidence object");
    }
    Object.defineProperty(result, key, {
      value: canonicalize(descriptor.value), enumerable: true, writable: true, configurable: true,
    });
  }
  return result;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

// Do not feed an array to Object.fromEntries: an ambient empty Array iterator
// can silently erase the complete reason/taxonomy map.
function orderedCountMap(counts: Map<string, number>): Record<string, number> {
  const keys = [...counts.keys()];
  for (let index = 1; index < keys.length; index++) {
    const key = keys[index]!;
    let previous = index - 1;
    while (previous >= 0 && keys[previous]! > key) {
      keys[previous + 1] = keys[previous]!;
      previous--;
    }
    keys[previous + 1] = key;
  }
  const result: Record<string, number> = {};
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    Object.defineProperty(result, key, {
      value: counts.get(key)!, enumerable: true, writable: true, configurable: true,
    });
  }
  return result;
}

function countReasons(rows: Array<{ reasons: string[] }>): Record<string, number> {
  const counts = new Map<string, number>();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const reasons = rows[rowIndex]!.reasons;
    for (let index = 0; index < reasons.length; index++) {
      const reason = reasons[index]!;
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return orderedCountMap(counts);
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
  const sources = [unresolved, rejected];
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
    const entries = Object.entries(sources[sourceIndex]!);
    for (let index = 0; index < entries.length; index++) {
      const pair = entries[index]!;
      const reason = pair[0];
      const count = pair[1];
      const taxonomy = taxonomyForReason(reason);
      counts.set(taxonomy, (counts.get(taxonomy) ?? 0) + count);
    }
  }
  if (conflictCount > 0) counts.set("identity_conflict", (counts.get("identity_conflict") ?? 0) + conflictCount);
  return orderedCountMap(counts);
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

function canonicalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function canonicalNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
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

const TOP_LEVEL_KEYS = [
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
] as const;

const SCOPE_KEYS = ["runKind", "modelVersion", "from", "to", "limit", "returnedRows", "limitReached", "bounded"] as const;
const SOURCE_KEYS = [
  "fileSizeBytes",
  "modifiedTimeMs",
  "sqliteSchemaVersion",
  "sqliteUserVersion",
  "pageCount",
  "pageSizeBytes",
  "freelistCount",
  "journalMode",
  "walPresent",
  "readOnly",
  "queryOnly",
] as const;
const RECONCILIATION_KEYS = [
  "status",
  "sourceRows",
  "mappedUnique",
  "exactDuplicates",
  "unresolvedCount",
  "rejectedCount",
  "conflictCount",
  "recordsDigest",
] as const;
const COMPLETENESS_KEYS = [
  "mappedRate",
  "unresolvedRate",
  "rejectedRate",
  "conflictRate",
  "unresolvedReasonCounts",
  "rejectedReasonCounts",
  "taxonomyCounts",
] as const;
const PRIVACY_KEYS = [
  "rawRecordsIncluded",
  "sourceRowIdsIncluded",
  "raceIdsIncluded",
  "selectionsIncluded",
  "absolutePathsIncluded",
  "localDbPathIncluded",
  "outcomeColumnsRead",
] as const;
const SAFETY_KEYS = [
  "operationalDbWrites",
  "notificationWrites",
  "lineSends",
  "appSettingsReads",
  "publicWrites",
  "productionPromotion",
] as const;

// Avoid ambient Array.prototype.push and inherited numeric setters when collecting failures.
function appendError(errors: string[], message: string): void {
  Object.defineProperty(errors, String(errors.length), {
    value: message,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

// Module-owned indexed allowlists must not depend on mutable Set.has or Set iterators.
function includesOwn(keys: readonly string[], value: unknown): boolean {
  if (typeof value !== "string") return false;
  for (let index = 0; index < keys.length; index++) {
    if (keys[index] === value) return true;
  }
  return false;
}

function requireExactObject(value: unknown, path: string, keys: readonly string[], errors: string[]): boolean {
  if (!isRecord(value)) {
    appendError(errors,`${path} must be an object`);
    return false;
  }
  const ownKeys = Reflect.ownKeys(value);
  for (let index = 0; index < ownKeys.length; index++) {
    const key = ownKeys[index]!;
    if (typeof key !== "string" || !includesOwn(keys, key)) appendError(errors,`unknown field: ${path}.${String(key)}`);
  }
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      appendError(errors,`missing own enumerable data field: ${path}.${key}`);
    }
  }
  return true;
}

const FORBIDDEN_KEYS = [
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
] as const;

// Dynamic reason-count dictionaries are part of the public sanitized evidence shape.
// Unlike the fixed schema objects, their keys must be validated individually.
function validateCountMap(value: unknown, path: string, errors: string[]): Record<string, number> | null {
  if (!isRecord(value)) {
    appendError(errors, `${path} must be a count map`);
    return null;
  }
  const initialErrors = errors.length;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    appendError(errors, `${path} must have a plain object prototype`);
  }
  const keys = Reflect.ownKeys(value);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    if (typeof key !== "string") {
      appendError(errors, `${path} must not contain symbol keys`);
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      appendError(errors, `${path}.${key} must be an own enumerable data field`);
      continue;
    }
    if (includesOwn(FORBIDDEN_KEYS, key) || /^(?:\/|file:\/\/|[A-Za-z]:\\)/.test(key) ||
      key.includes("/Users/") || key.includes("\\Users\\")) {
      appendError(errors, `${path} contains forbidden reason key`);
    }
    if (!nonNegativeSafeInteger(descriptor.value)) {
      appendError(errors, `${path}.${key} must be a non-negative safe integer`);
    }
  }
  return errors.length === initialErrors ? value as Record<string, number> : null;
}

function countMapTotal(counts: Record<string, number>): number {
  let total = 0;
  const keys = Reflect.ownKeys(counts);
  for (let index = 0; index < keys.length; index++) total += counts[keys[index] as string]!;
  return total;
}

// Taxonomy admission must not depend on ambient Map.has/get/set hooks: a
// re-digested count map with the wrong taxonomy key must still fail closed.
function taxonomyMatches(
  actual: Record<string, number>,
  unresolved: Record<string, number>,
  rejected: Record<string, number>,
  conflictCount: number,
): boolean {
  const expected: Record<string, number> = Object.create(null);
  const addExpected = (key: string, count: number): void => {
    Object.defineProperty(expected, key, {
      value: (Object.getOwnPropertyDescriptor(expected, key)?.value as number | undefined ?? 0) + count,
      enumerable: true, writable: true, configurable: true,
    });
  };
  const sources = [unresolved, rejected];
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
    const source = sources[sourceIndex]!;
    const keys = Reflect.ownKeys(source);
    for (let index = 0; index < keys.length; index++) {
      const reason = keys[index] as string;
      const taxonomy = taxonomyForReason(reason);
      const descriptor = Object.getOwnPropertyDescriptor(source, reason);
      if (!descriptor || !("value" in descriptor)) return false;
      addExpected(taxonomy, descriptor.value as number);
    }
  }
  if (conflictCount > 0) addExpected("identity_conflict", conflictCount);
  const keys = Reflect.ownKeys(actual);
  if (keys.length !== Reflect.ownKeys(expected).length) return false;
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index] as string;
    const actualDescriptor = Object.getOwnPropertyDescriptor(actual, key);
    const expectedDescriptor = Object.getOwnPropertyDescriptor(expected, key);
    if (!actualDescriptor || !expectedDescriptor || actualDescriptor.value !== expectedDescriptor.value) return false;
  }
  return true;
}

function walk(value: unknown, path: string, errors: string[]): void {
  if (isProxy(value)) {
    appendError(errors, `proxy value forbidden at ${path}`);
    return;
  }
  if (typeof value === "string") {
    if (/^(?:\/|file:\/\/|[A-Za-z]:\\)/.test(value) || value.includes("/Users/") || value.includes("\\Users\\")) {
      appendError(errors,`absolute path-like value at ${path}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    // The sanitized shadow-evidence schema contains no arrays at any depth.
    // Reject them rather than trusting mutable Array.prototype.forEach to inspect contents.
    appendError(errors, `unexpected array at ${path}`);
    return;
  }
  if (!isRecord(value)) return;
  const entries = Object.entries(value);
  for (let index = 0; index < entries.length; index++) {
    const pair = entries[index]!;
    const key = pair[0];
    const entry = pair[1];
    if (includesOwn(FORBIDDEN_KEYS, key)) appendError(errors,`forbidden key at ${path}.${key}`);
    walk(entry, `${path}.${key}`, errors);
  }
}

// A caller must not be able to rewrite the validation verdict or suppress its
// recorded errors after validation. Keep the accepted evidence caller-owned:
// this protects the result envelope, not the underlying evidence snapshot.
function immutableValidationResult(
  errors: string[],
  evidence: RuntimeDecisionLedgerShadowEvidence | null,
): { valid: boolean; errors: string[]; evidence: RuntimeDecisionLedgerShadowEvidence | null } {
  const valid = errors.length === 0;
  Object.freeze(errors);
  return Object.freeze({ valid, errors, evidence: valid ? evidence : null });
}

export function validateRuntimeDecisionLedgerShadowEvidence(
  value: unknown,
): { valid: boolean; errors: string[]; evidence: RuntimeDecisionLedgerShadowEvidence | null } {
  const errors: string[] = [];
  if (hasProxyInOwnData(value)) return immutableValidationResult(["proxy value forbidden in evidence graph"], null);
  if (!isRecord(value)) return immutableValidationResult(["evidence must be an object"], null);
  const topLevelKeys = Reflect.ownKeys(value);
  for (let index = 0; index < topLevelKeys.length; index++) {
    const key = topLevelKeys[index]!;
    if (typeof key !== "string" || !includesOwn(TOP_LEVEL_KEYS, key)) appendError(errors,`unknown top-level field: ${String(key)}`);
  }
  for (let index = 0; index < TOP_LEVEL_KEYS.length; index++) {
    const key = TOP_LEVEL_KEYS[index]!;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      appendError(errors,`missing own enumerable data top-level field: ${key}`);
    }
  }
  if (errors.length > 0) return immutableValidationResult(errors, null);

  requireExactObject(value.scope, "scope", SCOPE_KEYS, errors);
  requireExactObject(value.source, "source", SOURCE_KEYS, errors);
  requireExactObject(value.reconciliation, "reconciliation", RECONCILIATION_KEYS, errors);
  requireExactObject(value.completeness, "completeness", COMPLETENESS_KEYS, errors);
  requireExactObject(value.privacy, "privacy", PRIVACY_KEYS, errors);
  requireExactObject(value.safety, "safety", SAFETY_KEYS, errors);
  if (errors.length > 0) return immutableValidationResult(errors, null);

  const evidence = value as unknown as RuntimeDecisionLedgerShadowEvidence;
  if (evidence.schemaVersion !== RUNTIME_DECISION_LEDGER_SHADOW_EVIDENCE_SCHEMA_VERSION) {
    appendError(errors,`schemaVersion must be ${RUNTIME_DECISION_LEDGER_SHADOW_EVIDENCE_SCHEMA_VERSION}`);
  }
  if (!canonicalGeneratedAt(evidence.generatedAt)) appendError(errors,"generatedAt must be a canonical UTC date-time");
  if (!includesOwn(["PASS", "CONDITIONAL", "FAILED"], evidence.verdict)) appendError(errors,"invalid verdict");
  const digestFields = [
    ["sourceDescriptorDigest", evidence.sourceDescriptorDigest],
    ["contextDigest", evidence.contextDigest],
    ["recordsDigest", evidence.reconciliation?.recordsDigest],
    ["contentDigest", evidence.contentDigest],
  ] as const;
  for (let index = 0; index < digestFields.length; index++) {
    const pair = digestFields[index]!;
    const name = pair[0];
    const valueToCheck = pair[1];
    if (typeof valueToCheck !== "string" || !/^[0-9a-f]{64}$/.test(valueToCheck)) appendError(errors,`${name} must be sha256 hex`);
  }

  if (evidence.sourceDescriptorDigest !== digest(evidence.source)) {
    appendError(errors,"sourceDescriptorDigest mismatch");
  }

  const source = evidence.source;
  const sourceCountFields = [
    ["fileSizeBytes", source.fileSizeBytes],
    ["sqliteSchemaVersion", source.sqliteSchemaVersion],
    ["sqliteUserVersion", source.sqliteUserVersion],
    ["pageCount", source.pageCount],
    ["freelistCount", source.freelistCount],
  ] as const;
  for (let index = 0; index < sourceCountFields.length; index++) {
    const pair = sourceCountFields[index]!;
    const name = pair[0];
    const count = pair[1];
    if (!nonNegativeSafeInteger(count)) appendError(errors,`source.${name} must be a non-negative safe integer`);
  }
  if (!Number.isSafeInteger(source.pageSizeBytes) || source.pageSizeBytes < 1) {
    appendError(errors,"source.pageSizeBytes must be a positive safe integer");
  }
  if (!Number.isFinite(source.modifiedTimeMs) || source.modifiedTimeMs < 0) {
    appendError(errors,"source.modifiedTimeMs must be a non-negative finite number");
  }
  if (typeof source.journalMode !== "string" || source.journalMode.trim().length === 0) {
    appendError(errors,"source.journalMode must be a non-empty string");
  }

  const r = evidence.reconciliation;
  if (!r || !isRecord(r)) {
    appendError(errors,"reconciliation must be an object");
  } else {
    if (!includesOwn(["PASS", "CONDITIONAL", "FAILED"], r.status)) {
      appendError(errors,"reconciliation.status is invalid");
    }
    const reconciliationCountFields = [
      ["sourceRows", r.sourceRows],
      ["mappedUnique", r.mappedUnique],
      ["exactDuplicates", r.exactDuplicates],
      ["unresolvedCount", r.unresolvedCount],
      ["rejectedCount", r.rejectedCount],
      ["conflictCount", r.conflictCount],
    ] as const;
    for (let index = 0; index < reconciliationCountFields.length; index++) {
      const pair = reconciliationCountFields[index]!;
      const name = pair[0];
      const count = pair[1];
      if (!nonNegativeSafeInteger(count)) appendError(errors,`${name} must be a non-negative safe integer`);
    }
    if (
      nonNegativeSafeInteger(r.sourceRows) &&
      r.sourceRows !== r.mappedUnique + r.exactDuplicates + r.unresolvedCount + r.rejectedCount + r.conflictCount
    ) appendError(errors,"reconciliation counts do not sum to sourceRows");
  }

  if (!canonicalNonEmpty(evidence.scope.runKind)) appendError(errors,"scope.runKind must be a canonical non-empty string");
  if (!canonicalNonEmpty(evidence.scope.modelVersion)) appendError(errors,"scope.modelVersion must be a canonical non-empty string");
  if (!canonicalDate(evidence.scope.from) || !canonicalDate(evidence.scope.to)) {
    appendError(errors,"bounded scope requires canonical from/to dates");
  } else if (evidence.scope.from > evidence.scope.to) {
    appendError(errors,"scope.from must not be after scope.to");
  }
  if (!Number.isSafeInteger(evidence.scope.limit) || evidence.scope.limit < 1 || evidence.scope.limit > 5000) {
    appendError(errors,"scope.limit must be an integer between 1 and 5000");
  }
  if (!nonNegativeSafeInteger(evidence.scope.returnedRows)) {
    appendError(errors,"scope.returnedRows must be a non-negative safe integer");
  }
  if (evidence.scope.bounded !== true) appendError(errors,"scope.bounded must be true");
  if (typeof evidence.scope.limitReached !== "boolean") appendError(errors,"scope.limitReached must be boolean");
  if (Number.isSafeInteger(evidence.scope.limit)
    && nonNegativeSafeInteger(evidence.scope.returnedRows)
    && evidence.scope.returnedRows > evidence.scope.limit) {
    appendError(errors,"scope.returnedRows must not exceed scope.limit");
  }
  if (evidence.scope.returnedRows !== evidence.reconciliation.sourceRows) {
    appendError(errors,"scope.returnedRows must equal reconciliation.sourceRows");
  }
  if (evidence.scope.limitReached && evidence.scope.returnedRows !== evidence.scope.limit) {
    appendError(errors,"limitReached requires returnedRows to equal limit");
  }
  if (evidence.source.walPresent) appendError(errors,"bounded evidence requires walPresent=false");
  if (evidence.source.readOnly !== true || evidence.source.queryOnly !== true) {
    appendError(errors,"source must be readOnly and queryOnly");
  }

  const expectedVerdict = expectedEvidenceVerdict(evidence);
  if (evidence.verdict !== expectedVerdict) appendError(errors,`verdict must be ${expectedVerdict}`);

  if (!rateMatches(evidence.completeness.mappedRate, r.mappedUnique, r.sourceRows)) {
    appendError(errors,"completeness.mappedRate mismatch");
  }
  if (!rateMatches(evidence.completeness.unresolvedRate, r.unresolvedCount, r.sourceRows)) {
    appendError(errors,"completeness.unresolvedRate mismatch");
  }
  if (!rateMatches(evidence.completeness.rejectedRate, r.rejectedCount, r.sourceRows)) {
    appendError(errors,"completeness.rejectedRate mismatch");
  }
  if (!rateMatches(evidence.completeness.conflictRate, r.conflictCount, r.sourceRows)) {
    appendError(errors,"completeness.conflictRate mismatch");
  }

  const unresolvedCounts = validateCountMap(
    evidence.completeness.unresolvedReasonCounts, "completeness.unresolvedReasonCounts", errors,
  );
  const rejectedCounts = validateCountMap(
    evidence.completeness.rejectedReasonCounts, "completeness.rejectedReasonCounts", errors,
  );
  const taxonomies = validateCountMap(
    evidence.completeness.taxonomyCounts, "completeness.taxonomyCounts", errors,
  );
  if (unresolvedCounts && rejectedCounts && taxonomies) {
    if (!Number.isSafeInteger(countMapTotal(unresolvedCounts)) ||
      countMapTotal(unresolvedCounts) < r.unresolvedCount) {
      appendError(errors, "completeness.unresolvedReasonCounts does not cover unresolved rows");
    }
    if (!Number.isSafeInteger(countMapTotal(rejectedCounts)) ||
      countMapTotal(rejectedCounts) < r.rejectedCount) {
      appendError(errors, "completeness.rejectedReasonCounts does not cover rejected rows");
    }
    if (!taxonomyMatches(taxonomies, unresolvedCounts, rejectedCounts, r.conflictCount)) {
      appendError(errors, "completeness.taxonomyCounts mismatch");
    }
  }

  const privacyFields = Object.entries(evidence.privacy);
  for (let index = 0; index < privacyFields.length; index++) {
    const pair = privacyFields[index]!;
    const name = pair[0];
    const actual = pair[1];
    if (actual !== false) appendError(errors,`privacy.${name} must be false`);
  }
  const zeroWriteFields = ["operationalDbWrites", "notificationWrites", "lineSends", "appSettingsReads", "publicWrites"] as const;
  for (let index = 0; index < zeroWriteFields.length; index++) {
    const field = zeroWriteFields[index]!;
    if (evidence.safety[field] !== 0) appendError(errors,`safety.${field} must be 0`);
  }
  if (evidence.safety.productionPromotion !== false) appendError(errors,"safety.productionPromotion must be false");

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
  if (evidence.contentDigest !== expectedDigest) appendError(errors,"contentDigest mismatch");

  walk(evidence, "$", errors);
  return immutableValidationResult(errors, evidence);
}
