export const PUBLIC_SNAPSHOT_SCHEMA_VERSION = "public-dashboard-snapshot-v1" as const;

export type PublicResearchStatus =
  | "PASS"
  | "READY"
  | "RUNNING"
  | "BLOCKED"
  | "ENGINEERING_REQUIRED"
  | "NOT_AVAILABLE"
  | "NOT_STARTED"
  | "NOT_APPLICABLE";

export type PublicDashboardSnapshot = {
  schemaVersion: typeof PUBLIC_SNAPSHOT_SCHEMA_VERSION;
  generatedAt: string;
  dataAsOf: string;
  modelVersion: string;
  integrity: {
    algorithm: "sha256";
    digest: string;
  };
  status: {
    currentPhase: string | null;
    readiness: PublicResearchStatus;
    lastRunAt: string | null;
    nextTask: string | null;
    runner: PublicResearchStatus;
    snapshotFreshness: "FRESH" | "STALE" | "NOT_AVAILABLE";
  };
  metrics: Array<{
    id: string;
    label: string;
    value: number | string | null;
    unit: string | null;
    sampleSize: number | null;
    period: string | null;
    basis: "historical" | "forward" | "paper-live" | "data-quality" | "not-available";
    maxHitExcludedValue?: number | string | null;
  }>;
  pipeline: Array<{
    taskId: string;
    label: string;
    status: PublicResearchStatus;
    dependencies: string[];
    evidence: string[];
  }>;
  registries: {
    experiments: number | null;
    discoveries: number | null;
    rejections: number | null;
  };
  dataQuality: {
    coverageStatus: PublicResearchStatus;
    pitStatus: PublicResearchStatus;
    holdoutStatus: PublicResearchStatus;
    commonCohortStatus: PublicResearchStatus;
    notes: string[];
  };
  methodologyReferences: Array<{
    label: string;
    path: string;
  }>;
};

export type PublicSnapshotValidationResult = {
  ok: boolean;
  errors: string[];
};

const TOP_LEVEL_ALLOWLIST = new Set([
  "schemaVersion",
  "generatedAt",
  "dataAsOf",
  "modelVersion",
  "integrity",
  "status",
  "metrics",
  "pipeline",
  "registries",
  "dataQuality",
  "methodologyReferences",
]);
const INTEGRITY_KEYS = new Set(["algorithm", "digest"]);
const STATUS_KEYS = new Set(["currentPhase", "readiness", "lastRunAt", "nextTask", "runner", "snapshotFreshness"]);
const METRIC_KEYS = new Set(["id", "label", "value", "unit", "sampleSize", "period", "basis", "maxHitExcludedValue"]);
const METRIC_REQUIRED_KEYS = ["id", "label", "value", "unit", "sampleSize", "period", "basis"] as const;
const PIPELINE_KEYS = new Set(["taskId", "label", "status", "dependencies", "evidence"]);
const REGISTRY_KEYS = new Set(["experiments", "discoveries", "rejections"]);
const DATA_QUALITY_KEYS = new Set(["coverageStatus", "pitStatus", "holdoutStatus", "commonCohortStatus", "notes"]);
const METHODOLOGY_REFERENCE_KEYS = new Set(["label", "path"]);
const METRIC_BASES = new Set(["historical", "forward", "paper-live", "data-quality", "not-available"]);
const METRIC_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

const STATUS_VALUES = new Set<PublicResearchStatus>([
  "PASS",
  "READY",
  "RUNNING",
  "BLOCKED",
  "ENGINEERING_REQUIRED",
  "NOT_AVAILABLE",
  "NOT_STARTED",
  "NOT_APPLICABLE",
]);

const FORBIDDEN_KEY_FRAGMENTS = [
  "selection",
  "recommendedamount",
  "stake",
  "currentodds",
  "requiredodds",
  "app_settings",
  "appsettings",
  "internalthreshold",
  "ownerhistory",
  "manualpurchase",
  "notificationidentity",
  "credential",
  "authorization",
  "secret",
  "token",
  "dbpath",
  "databasepath",
  "localpath",
  "sidecarpath",
  "holdoutracekey",
  "holdoutrawkey",
];

const ABSOLUTE_PATH_PATTERNS = [
  /(?:^|[\s"'])\/(?:Users|home|var|private|Volumes)\//,
  /(?:^|[\s"'])[A-Za-z]:\\/,
  /(?:^|[\s"'])file:\/\//i,
];

const PRIVATE_RELATIVE_PATH_PATTERNS = [
  /(?:^|[\s"'\/])automation\/control\//,
  /(?:^|[\s"'\/])automation\/requests\//,
  /(?:^|\/)\.\.(?:\/|$)/,
  /(?:^|[\s"'\/])data\/(?:private|raw)\//,
];

const SECRET_VALUE_PATTERNS = [
  /\bgh[opusr]_[A-Za-z0-9_]{20,}\b/,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}\b/i,
  /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token)\s*[:=]\s*[^\s,;]{8,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

const RFC3339_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string"
    && RFC3339_TIMESTAMP_RE.test(value)
    && Number.isFinite(Date.parse(value));
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isNullablePublicValue(value: unknown): value is number | string | null {
  return value === null || typeof value === "number" || typeof value === "string";
}

function isNullableCount(value: unknown): value is number | null {
  return value === null || (Number.isInteger(value) && (value as number) >= 0);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPublicStatus(value: unknown): value is PublicResearchStatus {
  return typeof value === "string" && STATUS_VALUES.has(value as PublicResearchStatus);
}

function validateExactKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  required: readonly string[],
  path: string,
  errors: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${path}.${key}: unknown key`);
  }
  for (const key of required) {
    if (!(key in value)) errors.push(`${path}.${key}: required`);
  }
}

function scanValue(value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanValue(item, `${path}[${index}]`, errors));
    return;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLowerCase().replaceAll("-", "").replaceAll("_", "");
      const forbidden = FORBIDDEN_KEY_FRAGMENTS.find((fragment) =>
        normalized.includes(fragment.replaceAll("_", "")),
      );
      if (forbidden) errors.push(`${path}.${key}: forbidden public key (${forbidden})`);
      scanValue(child, `${path}.${key}`, errors);
    }
    return;
  }
  if (typeof value !== "string") return;
  if (ABSOLUTE_PATH_PATTERNS.some((pattern) => pattern.test(value))) {
    errors.push(`${path}: absolute/local path is forbidden`);
  }
  const normalizedPathValue = value.replaceAll("\\", "/");
  if (PRIVATE_RELATIVE_PATH_PATTERNS.some((pattern) => pattern.test(normalizedPathValue))) {
    errors.push(`${path}: private relative path is forbidden`);
  }
  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    errors.push(`${path}: secret-like value is forbidden`);
  }
}

export function validatePublicDashboardSnapshot(value: unknown): PublicSnapshotValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["snapshot must be an object"] };

  validateExactKeys(value, TOP_LEVEL_ALLOWLIST, [...TOP_LEVEL_ALLOWLIST], "$", errors);

  if (value.schemaVersion !== PUBLIC_SNAPSHOT_SCHEMA_VERSION) {
    errors.push(`$.schemaVersion: expected ${PUBLIC_SNAPSHOT_SCHEMA_VERSION}`);
  }
  if (!isIsoDate(value.generatedAt)) errors.push("$.generatedAt: invalid date-time");
  if (!isIsoDate(value.dataAsOf)) errors.push("$.dataAsOf: invalid date-time");
  if (typeof value.modelVersion !== "string" || value.modelVersion.length < 1 || value.modelVersion.length > 120) {
    errors.push("$.modelVersion: string with length 1..120 required");
  }

  if (!isRecord(value.integrity)) {
    errors.push("$.integrity: object required");
  } else {
    validateExactKeys(value.integrity, INTEGRITY_KEYS, [...INTEGRITY_KEYS], "$.integrity", errors);
    if (value.integrity.algorithm !== "sha256") errors.push("$.integrity.algorithm: expected sha256");
    if (typeof value.integrity.digest !== "string" || !/^[a-f0-9]{64}$/.test(value.integrity.digest)) {
      errors.push("$.integrity.digest: expected 64 lowercase hex characters");
    }
  }

  if (!isRecord(value.status)) {
    errors.push("$.status: object required");
  } else {
    validateExactKeys(value.status, STATUS_KEYS, [...STATUS_KEYS], "$.status", errors);
    if (!isNullableString(value.status.currentPhase)) errors.push("$.status.currentPhase: string or null required");
    if (!isPublicStatus(value.status.readiness)) errors.push("$.status.readiness: invalid status");
    if (!(value.status.lastRunAt === null || isIsoDate(value.status.lastRunAt))) {
      errors.push("$.status.lastRunAt: date-time or null required");
    }
    if (!isNullableString(value.status.nextTask)) errors.push("$.status.nextTask: string or null required");
    if (!isPublicStatus(value.status.runner)) errors.push("$.status.runner: invalid status");
    if (!["FRESH", "STALE", "NOT_AVAILABLE"].includes(String(value.status.snapshotFreshness))) {
      errors.push("$.status.snapshotFreshness: invalid value");
    }
  }

  if (!Array.isArray(value.metrics)) {
    errors.push("$.metrics: array required");
  } else {
    if (value.metrics.length > 100) errors.push("$.metrics: max 100 items");
    value.metrics.forEach((metric, index) => {
      const path = `$.metrics[${index}]`;
      if (!isRecord(metric)) {
        errors.push(`${path}: object required`);
        return;
      }
      validateExactKeys(metric, METRIC_KEYS, METRIC_REQUIRED_KEYS, path, errors);
      if (typeof metric.id !== "string" || !METRIC_ID_RE.test(metric.id)) errors.push(`${path}.id: invalid metric id`);
      if (!isNonEmptyString(metric.label)) errors.push(`${path}.label: non-empty string required`);
      if (!isNullablePublicValue(metric.value)) errors.push(`${path}.value: number, string or null required`);
      if (!isNullableString(metric.unit)) errors.push(`${path}.unit: string or null required`);
      if (!isNullableCount(metric.sampleSize)) errors.push(`${path}.sampleSize: non-negative integer or null required`);
      if (!isNullableString(metric.period)) errors.push(`${path}.period: string or null required`);
      if (typeof metric.basis !== "string" || !METRIC_BASES.has(metric.basis)) errors.push(`${path}.basis: invalid value`);
      if ("maxHitExcludedValue" in metric && !isNullablePublicValue(metric.maxHitExcludedValue)) {
        errors.push(`${path}.maxHitExcludedValue: number, string or null required`);
      }
    });
  }

  if (!Array.isArray(value.pipeline)) {
    errors.push("$.pipeline: array required");
  } else {
    if (value.pipeline.length > 200) errors.push("$.pipeline: max 200 items");
    value.pipeline.forEach((item, index) => {
      const path = `$.pipeline[${index}]`;
      if (!isRecord(item)) {
        errors.push(`${path}: object required`);
        return;
      }
      validateExactKeys(item, PIPELINE_KEYS, [...PIPELINE_KEYS], path, errors);
      if (!isNonEmptyString(item.taskId)) errors.push(`${path}.taskId: non-empty string required`);
      if (!isNonEmptyString(item.label)) errors.push(`${path}.label: non-empty string required`);
      if (!isPublicStatus(item.status)) errors.push(`${path}.status: invalid status`);
      if (!isStringArray(item.dependencies)) errors.push(`${path}.dependencies: string array required`);
      else if (item.dependencies.length > 50) errors.push(`${path}.dependencies: max 50 items`);
      if (!isStringArray(item.evidence)) errors.push(`${path}.evidence: string array required`);
      else if (item.evidence.length > 20) errors.push(`${path}.evidence: max 20 items`);
    });
  }

  if (!isRecord(value.registries)) {
    errors.push("$.registries: object required");
  } else {
    validateExactKeys(value.registries, REGISTRY_KEYS, [...REGISTRY_KEYS], "$.registries", errors);
    for (const key of REGISTRY_KEYS) {
      if (!isNullableCount(value.registries[key])) errors.push(`$.registries.${key}: non-negative integer or null required`);
    }
  }

  if (!isRecord(value.dataQuality)) {
    errors.push("$.dataQuality: object required");
  } else {
    validateExactKeys(value.dataQuality, DATA_QUALITY_KEYS, [...DATA_QUALITY_KEYS], "$.dataQuality", errors);
    for (const key of ["coverageStatus", "pitStatus", "holdoutStatus", "commonCohortStatus"] as const) {
      if (!isPublicStatus(value.dataQuality[key])) errors.push(`$.dataQuality.${key}: invalid status`);
    }
    if (!isStringArray(value.dataQuality.notes)) errors.push("$.dataQuality.notes: string array required");
    else if (value.dataQuality.notes.length > 50) errors.push("$.dataQuality.notes: max 50 items");
  }

  if (!Array.isArray(value.methodologyReferences)) {
    errors.push("$.methodologyReferences: array required");
  } else {
    if (value.methodologyReferences.length > 50) errors.push("$.methodologyReferences: max 50 items");
    value.methodologyReferences.forEach((reference, index) => {
      const path = `$.methodologyReferences[${index}]`;
      if (!isRecord(reference)) {
        errors.push(`${path}: object required`);
        return;
      }
      validateExactKeys(reference, METHODOLOGY_REFERENCE_KEYS, [...METHODOLOGY_REFERENCE_KEYS], path, errors);
      if (!isNonEmptyString(reference.label)) errors.push(`${path}.label: non-empty string required`);
      if (!isNonEmptyString(reference.path) || !reference.path.startsWith("/")) errors.push(`${path}.path: root-relative path required`);
    });
  }

  scanValue(value, "$", errors);
  return { ok: errors.length === 0, errors };
}

export function assertPublicDashboardSnapshot(value: unknown): asserts value is PublicDashboardSnapshot {
  const result = validatePublicDashboardSnapshot(value);
  if (!result.ok) throw new Error(`Invalid public dashboard snapshot:\n${result.errors.join("\n")}`);
}
