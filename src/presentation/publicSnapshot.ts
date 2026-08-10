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
  /(?:^|[\s"'])automation\/control\//,
  /(?:^|[\s"'])automation\/requests\//,
  /(?:^|\/)\.\.(?:\/|$)/,
  /(?:^|[\s"'])data\/(?:private|raw)\//,
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

function isPublicStatus(value: unknown): value is PublicResearchStatus {
  return typeof value === "string" && STATUS_VALUES.has(value as PublicResearchStatus);
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
  if (PRIVATE_RELATIVE_PATH_PATTERNS.some((pattern) => pattern.test(value))) {
    errors.push(`${path}: private relative path is forbidden`);
  }
  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    errors.push(`${path}: secret-like value is forbidden`);
  }
}

export function validatePublicDashboardSnapshot(value: unknown): PublicSnapshotValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["snapshot must be an object"] };

  for (const key of Object.keys(value)) {
    if (!TOP_LEVEL_ALLOWLIST.has(key)) errors.push(`$.${key}: unknown top-level key`);
  }
  for (const key of TOP_LEVEL_ALLOWLIST) {
    if (!(key in value)) errors.push(`$.${key}: required`);
  }

  if (value.schemaVersion !== PUBLIC_SNAPSHOT_SCHEMA_VERSION) {
    errors.push(`$.schemaVersion: expected ${PUBLIC_SNAPSHOT_SCHEMA_VERSION}`);
  }
  if (!isIsoDate(value.generatedAt)) errors.push("$.generatedAt: invalid date-time");
  if (!isIsoDate(value.dataAsOf)) errors.push("$.dataAsOf: invalid date-time");
  if (typeof value.modelVersion !== "string" || value.modelVersion.length === 0) {
    errors.push("$.modelVersion: non-empty string required");
  }

  if (!isRecord(value.integrity)) {
    errors.push("$.integrity: object required");
  } else {
    if (value.integrity.algorithm !== "sha256") errors.push("$.integrity.algorithm: expected sha256");
    if (typeof value.integrity.digest !== "string" || !/^[a-f0-9]{64}$/.test(value.integrity.digest)) {
      errors.push("$.integrity.digest: expected 64 lowercase hex characters");
    }
  }

  if (!isRecord(value.status)) {
    errors.push("$.status: object required");
  } else {
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

  if (!Array.isArray(value.metrics)) errors.push("$.metrics: array required");
  if (!Array.isArray(value.pipeline)) errors.push("$.pipeline: array required");
  if (!isRecord(value.registries)) errors.push("$.registries: object required");
  if (!isRecord(value.dataQuality)) errors.push("$.dataQuality: object required");
  if (!Array.isArray(value.methodologyReferences)) errors.push("$.methodologyReferences: array required");

  scanValue(value, "$", errors);
  return { ok: errors.length === 0, errors };
}

export function assertPublicDashboardSnapshot(value: unknown): asserts value is PublicDashboardSnapshot {
  const result = validatePublicDashboardSnapshot(value);
  if (!result.ok) throw new Error(`Invalid public dashboard snapshot:\n${result.errors.join("\n")}`);
}
