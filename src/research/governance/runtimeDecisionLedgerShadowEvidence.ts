import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import type {
  RuntimeDecisionLedgerMappingContext,
  RuntimeDecisionLedgerReconciliation,
} from "./runtimeDecisionLedgerMapper";

// Call the captured native regex executor directly: a captured .test still
// delegates to mutable RegExp.prototype.exec and can be bypassed by callers.
// These fixed, non-global patterns never rely on lastIndex or caller hooks.
const BUILTIN_REGEXP_EXEC = RegExp.prototype.exec;
// Capturing a native method is insufficient if the call dispatcher is mutable.
// Keep Reflect.apply itself stable for the captured regex/date intrinsics.
const BUILTIN_REFLECT_APPLY = Reflect.apply;
// Numeric integrity checks must not be redirected by mutable caller-realm
// Number/Object helpers after this research module is initialized.
const BUILTIN_NUMBER_IS_FINITE = Number.isFinite;
const BUILTIN_NUMBER_IS_SAFE_INTEGER = Number.isSafeInteger;
const BUILTIN_OBJECT_IS = Object.is;
// Bind structural inspection to the same native own-key, descriptor and
// prototype authority used for shadow evidence admission and canonical hashes.
// Caller-realm overrides must not hide metadata or disguise accessors.
const BUILTIN_REFLECT_OWN_KEYS = Reflect.ownKeys;
const BUILTIN_OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
// Error collection and canonical materialization must not rely on an ambient
// Object.defineProperty replacement that can silently discard own data fields.
const BUILTIN_OBJECT_DEFINE_PROPERTY = Object.defineProperty;
// Canonical evidence digests must not depend on a caller-replaced JSON.stringify.
// Capture the native serializer after module load, alongside other digest intrinsics.
const BUILTIN_JSON_STRINGIFY = JSON.stringify;
// Snapshot date parsing/formatting intrinsics for untrusted evidence validation.
// Ambient Date.parse or Date.prototype.toISOString changes must not relabel
// noncanonical caller time strings as canonical UTC (still NOT trusted time).
const BUILTIN_DATE = Date;
const BUILTIN_DATE_PARSE = Date.parse;
const BUILTIN_DATE_TO_ISO_STRING = Date.prototype.toISOString;
function stableCanonicalIso(value: string): string | null {
  const parsed = BUILTIN_REFLECT_APPLY(BUILTIN_DATE_PARSE, BUILTIN_DATE, [value]) as number;
  return BUILTIN_NUMBER_IS_FINITE(parsed)
    ? BUILTIN_REFLECT_APPLY(BUILTIN_DATE_TO_ISO_STRING, new BUILTIN_DATE(parsed), []) as string
    : null;
}
function stableRegexTest(pattern: RegExp, value: string): boolean {
  return BUILTIN_REFLECT_APPLY(BUILTIN_REGEXP_EXEC, pattern, [value]) !== null;
}

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
// Track active ancestors separately from visited aliases: cycles must be denied
// before canonicalization, but shared acyclic objects are not cycles.
// Bound traversal so an unexpected deep graph cannot become an unbounded preflight.
type OwnDataGraphIssue = "proxy" | "cycle" | "limit" | "bigint" | "function" | "undefined" | "symbol" | "nonfinite" | "negativezero" | "prototype";
function inspectOwnDataGraph(
  value: unknown,
  visited: object[] = [],
  ancestors: object[] = [],
): OwnDataGraphIssue | null {
  if (isProxy(value)) return "proxy";
  // JSON.stringify throws for bigint before the validator can report invalid fields.
  if (typeof value === "bigint") return "bigint";
  if (typeof value === "function") return "function";
  if (value === undefined) return "undefined";
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "number" && !BUILTIN_NUMBER_IS_FINITE(value)) return "nonfinite";
  // JSON.stringify(-0) produces 0, erasing a distinct numeric input state.
  if (typeof value === "number" && BUILTIN_OBJECT_IS(value, -0)) return "negativezero";
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return null;
  for (let index = 0; index < ancestors.length; index++) {
    if (ancestors[index] === value) return "cycle";
  }
  for (let index = 0; index < visited.length; index++) {
    if (visited[index] === value) return null;
  }
  if (visited.length >= 128) return "limit";
  // A fixed-schema object with inherited metadata can pass own-key admission,
  // then either be accepted without that metadata (root) or throw during digest.
  // Deny exotic prototypes before any semantic reads or canonical hashing.
  const prototype = BUILTIN_OBJECT_GET_PROTOTYPE_OF(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype && prototype !== null) return "prototype";
  } else if (prototype !== Object.prototype && prototype !== null) {
    return "prototype";
  }
  BUILTIN_OBJECT_DEFINE_PROPERTY(visited, String(visited.length), {
    value, writable: true, enumerable: true, configurable: true,
  });
  const depth = ancestors.length;
  BUILTIN_OBJECT_DEFINE_PROPERTY(ancestors, String(depth), {
    value, writable: true, enumerable: true, configurable: true,
  });
  try {
    const keys = BUILTIN_REFLECT_OWN_KEYS(value);
    for (let index = 0; index < keys.length; index++) {
      const descriptor = BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, keys[index]!);
      if (descriptor && "value" in descriptor) {
        const issue = inspectOwnDataGraph(descriptor.value, visited, ancestors);
        if (issue) return issue;
      }
    }
    return null;
  } finally {
    ancestors.length = depth;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !isProxy(value) && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  // JSON.stringify invokes callable own toJSON and inherited Array.prototype.toJSON.
  // Deny callable scalar fields and isolate canonical arrays from ambient hooks.
  if (isProxy(value)) throw new TypeError("invalid canonical shadow evidence proxy");
  if (typeof value === "function") throw new TypeError("invalid canonical shadow evidence function");
  // JSON.stringify drops undefined/symbol object values and converts NaN/Infinity to null.
  // Reject before hashing so distinct malformed research contexts cannot alias.
  if (value === undefined || typeof value === "symbol" ||
      (typeof value === "number" && !BUILTIN_NUMBER_IS_FINITE(value))) {
    throw new TypeError("invalid canonical shadow evidence non-JSON primitive");
  }
  // Preserve source/context digest identity: JSON serializes -0 exactly as 0.
  if (typeof value === "number" && BUILTIN_OBJECT_IS(value, -0)) {
    throw new TypeError("invalid canonical shadow evidence negative zero");
  }
  if (Array.isArray(value)) {
    // JSON serialization omits extra own array keys (including symbols) and
    // projects sparse slots as null. Bind the admitted array shape to its digest.
    const prototype = BUILTIN_OBJECT_GET_PROTOTYPE_OF(value);
    if (prototype !== Array.prototype && prototype !== null) {
      throw new TypeError("invalid canonical shadow evidence array prototype");
    }
    const ownKeys = BUILTIN_REFLECT_OWN_KEYS(value);
    if (ownKeys.length !== value.length + 1) {
      throw new TypeError("invalid canonical shadow evidence array own shape");
    }
    for (let index = 0; index < ownKeys.length; index++) {
      const key = ownKeys[index]!;
      if (key === "length") continue;
      const numericIndex = typeof key === "string" ? Number(key) : Number.NaN;
      if (!BUILTIN_NUMBER_IS_SAFE_INTEGER(numericIndex) || numericIndex < 0 ||
          numericIndex >= value.length || String(numericIndex) !== key) {
        throw new TypeError("invalid canonical shadow evidence array own shape");
      }
      const descriptor = BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError("invalid canonical shadow evidence array");
      }
    }
    const result: unknown[] = [];
    Object.setPrototypeOf(result, null);
    for (let index = 0; index < value.length; index++) {
      const descriptor = BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError("invalid canonical shadow evidence array");
      }
      BUILTIN_OBJECT_DEFINE_PROPERTY(result, String(index), {
        value: canonicalize(descriptor.value), enumerable: true, writable: true, configurable: true,
      });
    }
    return result;
  }
  if (!isRecord(value)) return value;
  // The source/context digest must cover the exact accepted own-data shape.
  // JSON.stringify silently ignores symbol keys, hidden properties and
  // inherited fields; a non-plain object can also project to an empty object.
  const prototype = BUILTIN_OBJECT_GET_PROTOTYPE_OF(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("invalid canonical shadow evidence object prototype");
  }
  // An ambient Object.keys override must not erase all digest fields.
  // Admit only own enumerable string-keyed data before sorting descriptors.
  const keys: string[] = [];
  const ownKeys = BUILTIN_REFLECT_OWN_KEYS(value);
  for (let index = 0; index < ownKeys.length; index++) {
    const key = ownKeys[index]!;
    if (typeof key !== "string") {
      throw new TypeError("invalid canonical shadow evidence symbol key");
    }
    const descriptor = BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError("invalid canonical shadow evidence non-data property");
    }
    BUILTIN_OBJECT_DEFINE_PROPERTY(keys, String(keys.length), {
      value: key, writable: true, enumerable: true, configurable: true,
    });
  }
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
    const descriptor = BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError("invalid canonical shadow evidence object");
    }
    BUILTIN_OBJECT_DEFINE_PROPERTY(result, key, {
      value: canonicalize(descriptor.value), enumerable: true, writable: true, configurable: true,
    });
  }
  return result;
}

function digest(value: unknown): string {
  return createHash("sha256").update(BUILTIN_JSON_STRINGIFY(canonicalize(value))).digest("hex");
}

// Do not feed an array to Object.fromEntries: an ambient empty Array iterator
// can silently erase the complete reason/taxonomy map.
// Build sanitized reason maps without mutable ambient Map methods or iterators.
// A null-prototype accumulator prevents inherited names from changing membership.
function addCount(counts: Record<string, number>, key: string, increment: number): void {
  const previous = BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(counts, key);
  BUILTIN_OBJECT_DEFINE_PROPERTY(counts, key, {
    value: (previous?.value as number | undefined ?? 0) + increment,
    enumerable: true, writable: true, configurable: true,
  });
}

function orderedCountMap(counts: Record<string, number>): Record<string, number> {
  const keys = BUILTIN_REFLECT_OWN_KEYS(counts) as string[];
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
    const descriptor = BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(counts, key);
    if (!descriptor || !("value" in descriptor)) throw new TypeError("invalid reason count");
    BUILTIN_OBJECT_DEFINE_PROPERTY(result, key, {
      value: descriptor.value as number, enumerable: true, writable: true, configurable: true,
    });
  }
  return result;
}

function countReasons(rows: Array<{ reasons: string[] }>): Record<string, number> {
  const counts: Record<string, number> = Object.create(null);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const reasons = rows[rowIndex]!.reasons;
    for (let index = 0; index < reasons.length; index++) {
      addCount(counts, reasons[index]!, 1);
    }
  }
  return orderedCountMap(counts);
}

// Inspect literal UTF-16 substrings without mutable ambient String.prototype.includes.
// Taxonomy and privacy/path admission must agree even if that prototype is changed.
function containsLiteral(haystack: string, needle: string): boolean {
  if (needle.length === 0) return true;
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset++) {
      if (haystack[start + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

// Reject embedded filesystem path tokens in diagnostic strings and reason keys.
// Do not confuse HTTPS scheme separators with absolute local paths.
function containsAbsolutePathLike(value: string): boolean {
  return stableRegexTest(/(?:^|[\s"'(=:])(?:file:\/\/|\/(?!\/|\s)|[A-Za-z]:[\\/]|\\\\[^\\\s])/u, value) ||
    containsLiteral(value, "/Users/") || containsLiteral(value, "\\Users\\");
}

function taxonomyForReason(reason: string): string {
  if (reason === "source_row_update_or_odds_observation_after_created_at") return "source_mutability";
  if (
    containsLiteral(reason, "timezone") ||
    containsLiteral(reason, "timestamp") ||
    containsLiteral(reason, "scheduled_close") ||
    containsLiteral(reason, "program_import") ||
    containsLiteral(reason, "close_time") ||
    containsLiteral(reason, "decision occurs after") ||
    containsLiteral(reason, "odds observation occurs after")
  ) return "temporal_provenance";
  if (containsLiteral(reason, "model_version") || containsLiteral(reason, "identity")) return "identity_completeness";
  if (containsLiteral(reason, "conflict")) return "identity_conflict";
  return "schema_or_value";
}

function taxonomyCounts(
  unresolved: Record<string, number>,
  rejected: Record<string, number>,
  conflictCount: number,
): Record<string, number> {
  const counts: Record<string, number> = Object.create(null);
  const sources = [unresolved, rejected];
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
    const source = sources[sourceIndex]!;
    const keys = BUILTIN_REFLECT_OWN_KEYS(source);
    for (let index = 0; index < keys.length; index++) {
      const reason = keys[index] as string;
      const descriptor = BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(source, reason);
      if (!descriptor || !("value" in descriptor)) throw new TypeError("invalid reason count");
      addCount(counts, taxonomyForReason(reason), descriptor.value as number);
    }
  }
  if (conflictCount > 0) addCount(counts, "identity_conflict", conflictCount);
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
  return typeof value === "number" && BUILTIN_NUMBER_IS_SAFE_INTEGER(value) && value >= 0;
}

function canonicalGeneratedAt(value: unknown): value is string {
  return typeof value === "string" && stableCanonicalIso(value) === value;
}

function canonicalDate(value: unknown): value is string {
  return typeof value === "string"
    && stableRegexTest(/^\d{4}-\d{2}-\d{2}$/, value)
    && stableCanonicalIso(`${value}T00:00:00.000Z`) === `${value}T00:00:00.000Z`;
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
  BUILTIN_OBJECT_DEFINE_PROPERTY(errors, String(errors.length), {
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
  const ownKeys = BUILTIN_REFLECT_OWN_KEYS(value);
  for (let index = 0; index < ownKeys.length; index++) {
    const key = ownKeys[index]!;
    if (typeof key !== "string" || !includesOwn(keys, key)) appendError(errors,`unknown field: ${path}.${String(key)}`);
  }
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    const descriptor = BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
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
  const prototype = BUILTIN_OBJECT_GET_PROTOTYPE_OF(value);
  if (prototype !== Object.prototype && prototype !== null) {
    appendError(errors, `${path} must have a plain object prototype`);
  }
  const keys = BUILTIN_REFLECT_OWN_KEYS(value);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    if (typeof key !== "string") {
      appendError(errors, `${path} must not contain symbol keys`);
      continue;
    }
    const descriptor = BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      appendError(errors, `${path}.${key} must be an own enumerable data field`);
      continue;
    }
    if (includesOwn(FORBIDDEN_KEYS, key) || containsAbsolutePathLike(key)) {
      appendError(errors, `${path} contains forbidden reason key`);
    }
    if (!nonNegativeSafeInteger(descriptor.value)) {
      appendError(errors, `${path}.${key} must be a non-negative safe integer`);
    } else if (descriptor.value === 0) {
      // The builder emits a count-map key only for an observed reason or conflict.
      // Zero-valued phantom keys can otherwise survive total and taxonomy checks.
      appendError(errors, `${path}.${key} must be positive`);
    }
  }
  return errors.length === initialErrors ? value as Record<string, number> : null;
}

function countMapTotal(counts: Record<string, number>): number {
  let total = 0;
  const keys = BUILTIN_REFLECT_OWN_KEYS(counts);
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
    BUILTIN_OBJECT_DEFINE_PROPERTY(expected, key, {
      value: (BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(expected, key)?.value as number | undefined ?? 0) + count,
      enumerable: true, writable: true, configurable: true,
    });
  };
  const sources = [unresolved, rejected];
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
    const source = sources[sourceIndex]!;
    const keys = BUILTIN_REFLECT_OWN_KEYS(source);
    for (let index = 0; index < keys.length; index++) {
      const reason = keys[index] as string;
      const taxonomy = taxonomyForReason(reason);
      const descriptor = BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(source, reason);
      if (!descriptor || !("value" in descriptor)) return false;
      addExpected(taxonomy, descriptor.value as number);
    }
  }
  if (conflictCount > 0) addExpected("identity_conflict", conflictCount);
  const keys = BUILTIN_REFLECT_OWN_KEYS(actual);
  if (keys.length !== BUILTIN_REFLECT_OWN_KEYS(expected).length) return false;
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index] as string;
    const actualDescriptor = BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(actual, key);
    const expectedDescriptor = BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(expected, key);
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
    if (containsAbsolutePathLike(value)) {
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
  // A mutable Object.entries hook must not erase path/forbidden-field diagnostics.
  // Own descriptors also avoid invoking an untrusted accessor while walking.
  const keys = BUILTIN_REFLECT_OWN_KEYS(value);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    const descriptor = BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      appendError(errors, `non-data field at ${path}.${String(key)}`);
      continue;
    }
    if (includesOwn(FORBIDDEN_KEYS, key)) appendError(errors,`forbidden key at ${path}.${String(key)}`);
    walk(descriptor.value, `${path}.${String(key)}`, errors);
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
  const graphIssue = inspectOwnDataGraph(value);
  if (graphIssue) {
    const message = graphIssue === "proxy" ? "proxy value forbidden in evidence graph"
      : graphIssue === "cycle" ? "cyclic reference forbidden in evidence graph"
      : graphIssue === "bigint" ? "non-JSON bigint forbidden in evidence graph"
      : graphIssue === "function" ? "non-JSON function forbidden in evidence graph"
      : graphIssue === "undefined" ? "non-JSON undefined forbidden in evidence graph"
      : graphIssue === "symbol" ? "non-JSON symbol forbidden in evidence graph"
      : graphIssue === "nonfinite" ? "non-finite number forbidden in evidence graph"
      : graphIssue === "negativezero" ? "negative zero forbidden in evidence graph"
      : graphIssue === "prototype" ? "non-plain prototype forbidden in evidence graph"
      : "evidence graph exceeds preflight bound";
    return immutableValidationResult([message], null);
  }
  if (!isRecord(value)) return immutableValidationResult(["evidence must be an object"], null);
  const topLevelKeys = BUILTIN_REFLECT_OWN_KEYS(value);
  for (let index = 0; index < topLevelKeys.length; index++) {
    const key = topLevelKeys[index]!;
    if (typeof key !== "string" || !includesOwn(TOP_LEVEL_KEYS, key)) appendError(errors,`unknown top-level field: ${String(key)}`);
  }
  for (let index = 0; index < TOP_LEVEL_KEYS.length; index++) {
    const key = TOP_LEVEL_KEYS[index]!;
    const descriptor = BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
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
    if (typeof valueToCheck !== "string" || !stableRegexTest(/^[0-9a-f]{64}$/, valueToCheck)) appendError(errors,`${name} must be sha256 hex`);
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
  if (!BUILTIN_NUMBER_IS_SAFE_INTEGER(source.pageSizeBytes) || source.pageSizeBytes < 1) {
    appendError(errors,"source.pageSizeBytes must be a positive safe integer");
  }
  if (!BUILTIN_NUMBER_IS_FINITE(source.modifiedTimeMs) || source.modifiedTimeMs < 0) {
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
    // The mapper derives reconciliation.status from conflict/unresolved/rejected counts.
    // A re-digested outer verdict must not launder a contradictory inner status.
    if (nonNegativeSafeInteger(r.conflictCount) &&
        nonNegativeSafeInteger(r.unresolvedCount) && nonNegativeSafeInteger(r.rejectedCount)) {
      const expectedStatus = r.conflictCount > 0 ? "FAILED"
        : r.unresolvedCount > 0 || r.rejectedCount > 0 ? "CONDITIONAL" : "PASS";
      if (r.status !== expectedStatus) {
        appendError(errors,`reconciliation.status must be ${expectedStatus}`);
      }
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
  if (!BUILTIN_NUMBER_IS_SAFE_INTEGER(evidence.scope.limit) || evidence.scope.limit < 1 || evidence.scope.limit > 5000) {
    appendError(errors,"scope.limit must be an integer between 1 and 5000");
  }
  if (!nonNegativeSafeInteger(evidence.scope.returnedRows)) {
    appendError(errors,"scope.returnedRows must be a non-negative safe integer");
  }
  if (evidence.scope.bounded !== true) appendError(errors,"scope.bounded must be true");
  if (typeof evidence.scope.limitReached !== "boolean") appendError(errors,"scope.limitReached must be boolean");
  if (BUILTIN_NUMBER_IS_SAFE_INTEGER(evidence.scope.limit)
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
  if (evidence.source.walPresent !== false) appendError(errors,"source.walPresent must be false");
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
  // A malformed dynamic count map may contain an enumerable accessor.
  // Do not canonicalize or walk it after its descriptor has already failed
  // admission: JSON serialization would execute caller-owned getters.
  if (!unresolvedCounts || !rejectedCounts || !taxonomies) {
    return immutableValidationResult(errors, null);
  }
  if (unresolvedCounts && rejectedCounts && taxonomies) {
    if (!BUILTIN_NUMBER_IS_SAFE_INTEGER(countMapTotal(unresolvedCounts)) ||
      countMapTotal(unresolvedCounts) < r.unresolvedCount) {
      appendError(errors, "completeness.unresolvedReasonCounts does not cover unresolved rows");
    }
    if (!BUILTIN_NUMBER_IS_SAFE_INTEGER(countMapTotal(rejectedCounts)) ||
      countMapTotal(rejectedCounts) < r.rejectedCount) {
      appendError(errors, "completeness.rejectedReasonCounts does not cover rejected rows");
    }
    // A positive reason count cannot describe zero rows in its own category.
    // Multi-reason rows remain valid: only the zero-row boundary is exact.
    if (r.unresolvedCount === 0 && countMapTotal(unresolvedCounts) !== 0) {
      appendError(errors, "completeness.unresolvedReasonCounts must be empty when unresolvedCount is zero");
    }
    if (r.rejectedCount === 0 && countMapTotal(rejectedCounts) !== 0) {
      appendError(errors, "completeness.rejectedReasonCounts must be empty when rejectedCount is zero");
    }
    if (!taxonomyMatches(taxonomies, unresolvedCounts, rejectedCounts, r.conflictCount)) {
      appendError(errors, "completeness.taxonomyCounts mismatch");
    }
  }

  // Fixed privacy flags must not depend on ambient Object.entries enumeration.
  for (let index = 0; index < PRIVACY_KEYS.length; index++) {
    const name = PRIVACY_KEYS[index]!;
    if (evidence.privacy[name] !== false) appendError(errors,`privacy.${name} must be false`);
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
