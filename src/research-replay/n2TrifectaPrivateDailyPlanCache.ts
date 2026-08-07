import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";

import { canonicalHash } from "./canonical";
import {
  buildN2TrifectaOddsCheckpointPlan,
  type N2TrifectaOddsCheckpointPlan,
  type N2TrifectaOddsRaceInput,
} from "./n2TrifectaOddsCheckpointCollection";

export const N2_TRIFECTA_PRIVATE_DAILY_PLAN_CACHE_VERSION =
  "n2-trifecta-private-daily-plan-cache-v1" as const;
export const N2_TRIFECTA_PRIVATE_DAILY_PLAN_CACHE_MAX_BYTES = 500_000;

export type N2TrifectaPrivateDailyPlanSourceEvidence = {
  primaryDbBytes: number;
  primaryDbModifiedMs: number;
  primaryDbWalBytes: 0;
  metadataFingerprintDigest: string;
  readOnly: true;
  queryOnly: true;
  immutable: true;
};

export type N2TrifectaPrivateDailyPlanCache = {
  cacheVersion: typeof N2_TRIFECTA_PRIVATE_DAILY_PLAN_CACHE_VERSION;
  date: string;
  venueCode: string;
  generatedAt: string;
  sourcePlanDigest: string;
  source: N2TrifectaPrivateDailyPlanSourceEvidence;
  plan: N2TrifectaOddsCheckpointPlan;
  databaseWriteAuthorized: false;
  currentBuyConnectionAuthorized: false;
  lineConnectionAuthorized: false;
  publicPublishAuthorized: false;
  automatedBettingAuthorized: false;
  cacheDigest: string;
};

export type N2TrifectaPrivateDailyPlanCacheReadResult = {
  status: "PASS" | "MISSING" | "STALE" | "BLOCKED";
  blockers: string[];
  relativePath: string;
  cache: N2TrifectaPrivateDailyPlanCache | null;
  plan: N2TrifectaOddsCheckpointPlan | null;
  fallbackToPrimaryDbAllowed: boolean;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VENUE_RE = /^(0[1-9]|1\d|2[0-4])$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const EXPECTED_LABELS = ["T-30", "T-20", "T-10", "T-5"] as const;

function parseInstant(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function jstDate(value: string): string | null {
  const parsed = parseInstant(value);
  if (parsed == null) return null;
  return new Date(parsed + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function resolveInside(rootDir: string, relativePath: string): string {
  if (relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new Error("UNSAFE_RELATIVE_PATH");
  }
  const root = resolve(rootDir);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("PATH_ESCAPES_ROOT");
  }
  return target;
}

export function n2TrifectaPrivateDailyPlanRelativePath(date: string): string {
  if (!DATE_RE.test(date)) throw new Error("INVALID_DATE");
  return `data/private/trifecta-capture/plans/${date}.json`;
}

export function buildN2TrifectaPrivateDailyPlanSourceEvidence(input: {
  primaryDbBytes: number;
  primaryDbModifiedMs: number;
  primaryDbWalBytes: number;
}): N2TrifectaPrivateDailyPlanSourceEvidence {
  if (!Number.isSafeInteger(input.primaryDbBytes) || input.primaryDbBytes <= 0) {
    throw new Error("PRIMARY_DB_BYTES_INVALID");
  }
  if (!Number.isFinite(input.primaryDbModifiedMs) || input.primaryDbModifiedMs <= 0) {
    throw new Error("PRIMARY_DB_MTIME_INVALID");
  }
  if (input.primaryDbWalBytes !== 0) throw new Error("PRIMARY_DB_ACTIVE_WAL");
  const core = {
    primaryDbBytes: input.primaryDbBytes,
    primaryDbModifiedMs: input.primaryDbModifiedMs,
    primaryDbWalBytes: 0 as const,
    readOnly: true as const,
    queryOnly: true as const,
    immutable: true as const,
  };
  return {
    ...core,
    metadataFingerprintDigest: canonicalHash(core),
  };
}

function rebuildPlan(plan: N2TrifectaOddsCheckpointPlan): N2TrifectaOddsCheckpointPlan | null {
  if (plan.stage !== "ONE_VENUE_REVIEW") return null;
  const races = new Map<number, N2TrifectaOddsRaceInput>();
  for (const entry of plan.entries) {
    if (!DATE_RE.test(entry.date) || !VENUE_RE.test(entry.venueCode)) return null;
    const existing = races.get(entry.raceNo);
    const candidate = {
      date: entry.date,
      venueCode: entry.venueCode,
      raceNo: entry.raceNo,
      closeAt: entry.closeAt,
    };
    if (existing && canonicalHash(existing) !== canonicalHash(candidate)) return null;
    races.set(entry.raceNo, candidate);
  }
  return buildN2TrifectaOddsCheckpointPlan({
    stage: "ONE_VENUE_REVIEW",
    races: [...races.values()].sort((left, right) => left.raceNo - right.raceNo),
  });
}

export function auditN2TrifectaPrivateDailyPlanCache(
  cache: N2TrifectaPrivateDailyPlanCache,
  input: { expectedDate: string; now: string },
): { status: "PASS" | "STALE" | "BLOCKED"; blockers: string[] } {
  const blockers: string[] = [];
  const stale: string[] = [];
  if (cache.cacheVersion !== N2_TRIFECTA_PRIVATE_DAILY_PLAN_CACHE_VERSION) {
    blockers.push("CACHE_VERSION_MISMATCH");
  }
  if (!DATE_RE.test(cache.date) || cache.date !== input.expectedDate) stale.push("CACHE_DATE_STALE");
  if (!VENUE_RE.test(cache.venueCode)) blockers.push("VENUE_CODE_INVALID");
  const nowMs = parseInstant(input.now);
  const generatedMs = parseInstant(cache.generatedAt);
  if (nowMs == null) blockers.push("NOW_INVALID");
  if (generatedMs == null) blockers.push("GENERATED_AT_INVALID");
  if (generatedMs != null && nowMs != null && generatedMs > nowMs + 5 * 60_000) {
    blockers.push("GENERATED_AT_IN_FUTURE");
  }
  if (jstDate(input.now) !== input.expectedDate) stale.push("REQUESTED_DATE_NOT_CURRENT_JST_DAY");
  if (generatedMs != null && jstDate(cache.generatedAt) !== cache.date) {
    blockers.push("GENERATED_AT_DATE_MISMATCH");
  }

  if (cache.source.primaryDbWalBytes !== 0) blockers.push("SOURCE_WAL_NOT_ZERO");
  if (cache.source.readOnly !== true || cache.source.queryOnly !== true || cache.source.immutable !== true) {
    blockers.push("SOURCE_READ_BOUNDARY_INVALID");
  }
  const sourceCore = {
    primaryDbBytes: cache.source.primaryDbBytes,
    primaryDbModifiedMs: cache.source.primaryDbModifiedMs,
    primaryDbWalBytes: cache.source.primaryDbWalBytes,
    readOnly: cache.source.readOnly,
    queryOnly: cache.source.queryOnly,
    immutable: cache.source.immutable,
  };
  if (!SHA256_RE.test(cache.source.metadataFingerprintDigest)
    || canonicalHash(sourceCore) !== cache.source.metadataFingerprintDigest) {
    blockers.push("SOURCE_FINGERPRINT_MISMATCH");
  }

  const rebuilt = rebuildPlan(cache.plan);
  if (!rebuilt) blockers.push("PLAN_REBUILD_FAILED");
  else {
    if (rebuilt.status !== "READY_FOR_PRIVATE_REVIEW") blockers.push("PLAN_NOT_READY");
    if (rebuilt.raceCount !== 12) blockers.push("RACE_COUNT_NOT_12");
    if (rebuilt.requestBudget !== 48) blockers.push("REQUEST_BUDGET_NOT_48");
    if (rebuilt.entries.length !== 48) blockers.push("ENTRY_COUNT_NOT_48");
    if (rebuilt.entries[0]?.date !== cache.date) blockers.push("PLAN_DATE_MISMATCH");
    if (rebuilt.entries[0]?.venueCode !== cache.venueCode) blockers.push("PLAN_VENUE_MISMATCH");
    if (canonicalHash(rebuilt) !== canonicalHash(cache.plan)) blockers.push("PLAN_CONTENT_MISMATCH");
    if (rebuilt.manifestDigest !== cache.sourcePlanDigest) blockers.push("SOURCE_PLAN_DIGEST_MISMATCH");
    const labelsByRace = new Map<number, Set<string>>();
    for (const entry of rebuilt.entries) {
      const labels = labelsByRace.get(entry.raceNo) ?? new Set<string>();
      labels.add(entry.checkpointLabel);
      labelsByRace.set(entry.raceNo, labels);
    }
    for (let raceNo = 1; raceNo <= 12; raceNo += 1) {
      const labels = [...(labelsByRace.get(raceNo) ?? new Set())].sort();
      if (canonicalHash(labels) !== canonicalHash([...EXPECTED_LABELS].sort())) {
        blockers.push("CHECKPOINT_SET_INCOMPLETE");
        break;
      }
    }
  }

  const core = {
    cacheVersion: cache.cacheVersion,
    date: cache.date,
    venueCode: cache.venueCode,
    generatedAt: cache.generatedAt,
    sourcePlanDigest: cache.sourcePlanDigest,
    source: cache.source,
    plan: cache.plan,
    databaseWriteAuthorized: cache.databaseWriteAuthorized,
    currentBuyConnectionAuthorized: cache.currentBuyConnectionAuthorized,
    lineConnectionAuthorized: cache.lineConnectionAuthorized,
    publicPublishAuthorized: cache.publicPublishAuthorized,
    automatedBettingAuthorized: cache.automatedBettingAuthorized,
  };
  if (!SHA256_RE.test(cache.cacheDigest) || canonicalHash(core) !== cache.cacheDigest) {
    blockers.push("CACHE_DIGEST_MISMATCH");
  }
  if (cache.databaseWriteAuthorized !== false) blockers.push("DATABASE_WRITE_MUST_BE_FALSE");
  if (cache.currentBuyConnectionAuthorized !== false) blockers.push("CURRENT_BUY_MUST_BE_FALSE");
  if (cache.lineConnectionAuthorized !== false) blockers.push("LINE_MUST_BE_FALSE");
  if (cache.publicPublishAuthorized !== false) blockers.push("PUBLIC_PUBLISH_MUST_BE_FALSE");
  if (cache.automatedBettingAuthorized !== false) blockers.push("AUTOMATED_BETTING_MUST_BE_FALSE");

  const normalizedBlockers = unique(blockers);
  if (normalizedBlockers.length > 0) return { status: "BLOCKED", blockers: normalizedBlockers };
  const normalizedStale = unique(stale);
  if (normalizedStale.length > 0) return { status: "STALE", blockers: normalizedStale };
  return { status: "PASS", blockers: [] };
}

export function buildN2TrifectaPrivateDailyPlanCache(input: {
  date: string;
  generatedAt: string;
  plans: N2TrifectaOddsCheckpointPlan[];
  source: N2TrifectaPrivateDailyPlanSourceEvidence;
}): N2TrifectaPrivateDailyPlanCache {
  if (!DATE_RE.test(input.date) || jstDate(input.generatedAt) !== input.date) {
    throw new Error("DAILY_PLAN_DATE_INVALID");
  }
  const eligible = input.plans
    .filter((plan) => plan.status === "READY_FOR_PRIVATE_REVIEW"
      && plan.stage === "ONE_VENUE_REVIEW"
      && plan.raceCount === 12
      && plan.requestBudget === 48
      && plan.entries.length === 48
      && plan.entries.every((entry) => entry.date === input.date))
    .sort((left, right) => {
      const firstAt = String(left.entries[0]?.targetCaptureAt).localeCompare(
        String(right.entries[0]?.targetCaptureAt),
      );
      if (firstAt !== 0) return firstAt;
      return String(left.entries[0]?.venueCode).localeCompare(String(right.entries[0]?.venueCode));
    });
  const plan = eligible[0];
  const venueCode = plan?.entries[0]?.venueCode;
  if (!plan || !venueCode) throw new Error("NO_COMPLETE_ONE_VENUE_PLAN");
  const core = {
    cacheVersion: N2_TRIFECTA_PRIVATE_DAILY_PLAN_CACHE_VERSION,
    date: input.date,
    venueCode,
    generatedAt: input.generatedAt,
    sourcePlanDigest: plan.manifestDigest,
    source: input.source,
    plan,
    databaseWriteAuthorized: false as const,
    currentBuyConnectionAuthorized: false as const,
    lineConnectionAuthorized: false as const,
    publicPublishAuthorized: false as const,
    automatedBettingAuthorized: false as const,
  };
  const cache: N2TrifectaPrivateDailyPlanCache = {
    ...core,
    cacheDigest: canonicalHash(core),
  };
  const audit = auditN2TrifectaPrivateDailyPlanCache(cache, {
    expectedDate: input.date,
    now: input.generatedAt,
  });
  if (audit.status !== "PASS") throw new Error(`DAILY_PLAN_AUDIT_${audit.blockers.join("_")}`);
  return cache;
}

export function writeN2TrifectaPrivateDailyPlanCache(input: {
  dataRoot: string;
  cache: N2TrifectaPrivateDailyPlanCache;
}): string {
  const relativePath = n2TrifectaPrivateDailyPlanRelativePath(input.cache.date);
  const path = resolveInside(input.dataRoot, relativePath);
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error("DAILY_PLAN_SYMLINK_NOT_ALLOWED");
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(input.cache, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } finally {
    rmSync(temporary, { force: true });
  }
  return relativePath;
}

export function readN2TrifectaPrivateDailyPlanCache(input: {
  dataRoot: string;
  expectedDate: string;
  now: string;
}): N2TrifectaPrivateDailyPlanCacheReadResult {
  const relativePath = n2TrifectaPrivateDailyPlanRelativePath(input.expectedDate);
  const path = resolveInside(input.dataRoot, relativePath);
  if (!existsSync(path)) {
    return {
      status: "MISSING",
      blockers: ["DAILY_PLAN_MISSING"],
      relativePath,
      cache: null,
      plan: null,
      fallbackToPrimaryDbAllowed: true,
    };
  }
  if (lstatSync(path).isSymbolicLink()) {
    return {
      status: "BLOCKED",
      blockers: ["DAILY_PLAN_SYMLINK_NOT_ALLOWED"],
      relativePath,
      cache: null,
      plan: null,
      fallbackToPrimaryDbAllowed: false,
    };
  }
  const stat = statSync(path);
  if (!stat.isFile() || stat.size <= 0 || stat.size > N2_TRIFECTA_PRIVATE_DAILY_PLAN_CACHE_MAX_BYTES) {
    return {
      status: "BLOCKED",
      blockers: ["DAILY_PLAN_SIZE_OR_TYPE_INVALID"],
      relativePath,
      cache: null,
      plan: null,
      fallbackToPrimaryDbAllowed: false,
    };
  }
  let cache: N2TrifectaPrivateDailyPlanCache;
  try {
    cache = JSON.parse(readFileSync(path, "utf8")) as N2TrifectaPrivateDailyPlanCache;
  } catch {
    return {
      status: "BLOCKED",
      blockers: ["DAILY_PLAN_INVALID_JSON"],
      relativePath,
      cache: null,
      plan: null,
      fallbackToPrimaryDbAllowed: false,
    };
  }
  const audit = auditN2TrifectaPrivateDailyPlanCache(cache, {
    expectedDate: input.expectedDate,
    now: input.now,
  });
  return {
    status: audit.status,
    blockers: audit.blockers,
    relativePath,
    cache,
    plan: audit.status === "PASS" ? cache.plan : null,
    fallbackToPrimaryDbAllowed: audit.status === "STALE",
  };
}
