import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";

import { canonicalHash } from "./canonical";
import {
  buildN2TrifectaPrivateHeartbeatGapDiagnostics,
  type N2TrifectaPrivateHeartbeatGapDiagnosticsReport,
} from "./n2TrifectaPrivateHeartbeatGapDiagnostics";
import {
  N2_TRIFECTA_PRIVATE_MARKET_FEATURE_DAY_INDEX_VERSION,
  buildN2TrifectaPrivateMarketFeatureDayIndex,
  privateMarketFeatureDayIndexRelativePath,
  type N2TrifectaPrivateMarketFeatureDayIndex,
} from "./n2TrifectaPrivateMarketFeatureDayIndex";

export const N2_TRIFECTA_PRIVATE_MARKET_DAILY_READINESS_VERSION =
  "n2-trifecta-private-market-daily-readiness-v1" as const;

const MAX_DAY_INDEX_BYTES = 5_000_000;
const MAX_READINESS_BYTES = 2_000_000;

export type N2TrifectaPrivateMarketDailyReadinessStatus =
  | "PASS"
  | "DEGRADED"
  | "NO_DATA"
  | "BLOCKED";

export type N2TrifectaPrivateMarketDailyReadiness = {
  readinessVersion: typeof N2_TRIFECTA_PRIVATE_MARKET_DAILY_READINESS_VERSION;
  evidenceRole: "EXPLORATION_READINESS_ONLY";
  checkedAt: string;
  date: string;
  venueCode: string;
  status: N2TrifectaPrivateMarketDailyReadinessStatus;
  blockers: string[];
  sourceDayIndexVersion: typeof N2_TRIFECTA_PRIVATE_MARKET_FEATURE_DAY_INDEX_VERSION;
  sourceDayIndexDigest: string;
  sourceDayIndexGeneratedAt: string;
  sourceDayIndexStatus: "PASS" | "PARTIAL" | "NO_DATA";
  completeRaceCount: number;
  partialRaceCount: number;
  noDataRaceCount: number;
  cohortCandidateRaceCount: number;
  cohortCandidateRaceIdentities: string[];
  totalSnapshotCount: number;
  totalTransitionCount: number;
  checkpointCoverageNumerator: number;
  checkpointCoverageDenominator: 48;
  checkpointCoverageRatio: number;
  heartbeatStatus: N2TrifectaPrivateHeartbeatGapDiagnosticsReport["status"];
  heartbeatOutputDigest: string;
  heartbeatHistoryRecordCount: number;
  heartbeatLatestAgeSeconds: number | null;
  heartbeatSignificantGapCount: number;
  heartbeatRecentSignificantGapCount: number;
  heartbeatAffectedCheckpointCount: number;
  heartbeatCurrentGapOverThreshold: boolean;
  heartbeatPlanStatus: N2TrifectaPrivateHeartbeatGapDiagnosticsReport["planStatus"];
  automaticFreezeAuthorized: false;
  outcomeDataRead: false;
  validationDataRead: false;
  holdoutDataRead: false;
  rawCaptureEvidenceRead: false;
  rawOddsValuesRead: false;
  rawOddsValuesPrinted: false;
  rawOddsValuesPublished: false;
  networkRequestCount: 0;
  databaseReadCount: 0;
  databaseWriteCount: 0;
  currentBuyConnectionAuthorized: false;
  lineConnectionAuthorized: false;
  automatedBettingAuthorized: false;
  publicPublishAuthorized: false;
  productionApplyAuthorized: false;
  outputDigest: string;
};

type StoredDayIndexLike = Partial<N2TrifectaPrivateMarketFeatureDayIndex> & Record<string, unknown>;

function parseInstant(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function jstDate(value: string): string | null {
  const parsed = parseInstant(value);
  if (parsed == null) return null;
  return new Date(parsed + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

function resolveInside(rootDir: string, relativePath: string): string {
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new Error("DAILY_READINESS_PATH_UNSAFE");
  }
  const root = resolve(rootDir);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("DAILY_READINESS_PATH_ESCAPES_ROOT");
  }
  return target;
}

function validateScope(date: string, venueCode: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error("DAILY_READINESS_DATE_INVALID");
  if (!/^(0[1-9]|1\d|2[0-4])$/u.test(venueCode)) throw new Error("DAILY_READINESS_VENUE_INVALID");
}

function readVerifiedDayIndex(input: {
  dataRoot: string;
  date: string;
  venueCode: string;
}): N2TrifectaPrivateMarketFeatureDayIndex {
  validateScope(input.date, input.venueCode);
  const relativePath = privateMarketFeatureDayIndexRelativePath({
    date: input.date,
    venueCode: input.venueCode,
  });
  const path = resolveInside(input.dataRoot, relativePath);
  if (!existsSync(path)) throw new Error("DAILY_READINESS_DAY_INDEX_MISSING");
  const lst = lstatSync(path);
  if (lst.isSymbolicLink() || !lst.isFile()) throw new Error("DAILY_READINESS_DAY_INDEX_FILE_TYPE_INVALID");
  const stat = statSync(path);
  if ((stat.mode & 0o777) !== 0o600) throw new Error("DAILY_READINESS_DAY_INDEX_FILE_MODE_INVALID");
  if (stat.size <= 0 || stat.size > MAX_DAY_INDEX_BYTES) throw new Error("DAILY_READINESS_DAY_INDEX_SIZE_INVALID");

  let stored: StoredDayIndexLike;
  try {
    stored = JSON.parse(readFileSync(path, "utf8")) as StoredDayIndexLike;
  } catch {
    throw new Error("DAILY_READINESS_DAY_INDEX_JSON_INVALID");
  }
  if (stored.indexVersion !== N2_TRIFECTA_PRIVATE_MARKET_FEATURE_DAY_INDEX_VERSION) {
    throw new Error("DAILY_READINESS_DAY_INDEX_VERSION_INVALID");
  }
  if (stored.date !== input.date || stored.venueCode !== input.venueCode) {
    throw new Error("DAILY_READINESS_DAY_INDEX_SCOPE_MISMATCH");
  }
  if (typeof stored.generatedAt !== "string" || parseInstant(stored.generatedAt) == null) {
    throw new Error("DAILY_READINESS_DAY_INDEX_GENERATED_AT_INVALID");
  }
  if (typeof stored.indexDigest !== "string" || !/^[0-9a-f]{64}$/u.test(stored.indexDigest)) {
    throw new Error("DAILY_READINESS_DAY_INDEX_DIGEST_INVALID");
  }

  const rebuilt = buildN2TrifectaPrivateMarketFeatureDayIndex({
    rootDir: input.dataRoot,
    date: input.date,
    venueCode: input.venueCode,
    generatedAt: stored.generatedAt,
  });
  if (rebuilt.indexDigest !== stored.indexDigest) {
    throw new Error("DAILY_READINESS_DAY_INDEX_DIGEST_MISMATCH");
  }
  return rebuilt;
}

function normalizedNumber(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

export function buildN2TrifectaPrivateMarketDailyReadiness(input: {
  dataRoot: string;
  date: string;
  venueCode: string;
  checkedAt: string;
}): N2TrifectaPrivateMarketDailyReadiness {
  validateScope(input.date, input.venueCode);
  const checkedAtMs = parseInstant(input.checkedAt);
  if (checkedAtMs == null) throw new Error("DAILY_READINESS_CHECKED_AT_INVALID");
  const checkedAt = new Date(checkedAtMs).toISOString();
  if (jstDate(checkedAt) !== input.date) throw new Error("DAILY_READINESS_CHECKED_AT_DATE_MISMATCH");

  const dayIndex = readVerifiedDayIndex({
    dataRoot: input.dataRoot,
    date: input.date,
    venueCode: input.venueCode,
  });
  const heartbeat = buildN2TrifectaPrivateHeartbeatGapDiagnostics({
    dataRoot: input.dataRoot,
    date: input.date,
    now: checkedAt,
  });

  const blockers: string[] = [];
  if (heartbeat.status === "BLOCKED") {
    blockers.push(...heartbeat.blockers.map((code) => `HEARTBEAT_${code}`));
  }
  const completeRaceIdentities = dayIndex.races
    .filter((race) => race.status === "PASS")
    .map((race) => race.raceIdentity)
    .sort();
  const denominator = 48 as const;
  const coverageNumerator = dayIndex.totalSnapshotCount;
  const coverageRatio = normalizedNumber(coverageNumerator / denominator);

  const status: N2TrifectaPrivateMarketDailyReadinessStatus = blockers.length > 0
    ? "BLOCKED"
    : dayIndex.status === "NO_DATA"
      ? "NO_DATA"
      : dayIndex.status !== "PASS" || heartbeat.status !== "PASS" || heartbeat.planStatus !== "PASS"
        ? "DEGRADED"
        : "PASS";

  const core = {
    readinessVersion: N2_TRIFECTA_PRIVATE_MARKET_DAILY_READINESS_VERSION,
    evidenceRole: "EXPLORATION_READINESS_ONLY" as const,
    checkedAt,
    date: input.date,
    venueCode: input.venueCode,
    status,
    blockers: [...new Set(blockers)].sort(),
    sourceDayIndexVersion: dayIndex.indexVersion,
    sourceDayIndexDigest: dayIndex.indexDigest,
    sourceDayIndexGeneratedAt: dayIndex.generatedAt,
    sourceDayIndexStatus: dayIndex.status,
    completeRaceCount: dayIndex.passCount,
    partialRaceCount: dayIndex.partialCount,
    noDataRaceCount: dayIndex.noDataCount,
    cohortCandidateRaceCount: completeRaceIdentities.length,
    cohortCandidateRaceIdentities: completeRaceIdentities,
    totalSnapshotCount: dayIndex.totalSnapshotCount,
    totalTransitionCount: dayIndex.totalTransitionCount,
    checkpointCoverageNumerator: coverageNumerator,
    checkpointCoverageDenominator: denominator,
    checkpointCoverageRatio: coverageRatio,
    heartbeatStatus: heartbeat.status,
    heartbeatOutputDigest: heartbeat.outputDigest,
    heartbeatHistoryRecordCount: heartbeat.historyRecordCount,
    heartbeatLatestAgeSeconds: heartbeat.latestAgeSeconds,
    heartbeatSignificantGapCount: heartbeat.significantGapCount,
    heartbeatRecentSignificantGapCount: heartbeat.recentSignificantGapCount,
    heartbeatAffectedCheckpointCount: heartbeat.affectedCheckpointCount,
    heartbeatCurrentGapOverThreshold: heartbeat.currentGapOverThreshold,
    heartbeatPlanStatus: heartbeat.planStatus,
    automaticFreezeAuthorized: false as const,
    outcomeDataRead: false as const,
    validationDataRead: false as const,
    holdoutDataRead: false as const,
    rawCaptureEvidenceRead: false as const,
    rawOddsValuesRead: false as const,
    rawOddsValuesPrinted: false as const,
    rawOddsValuesPublished: false as const,
    networkRequestCount: 0 as const,
    databaseReadCount: 0 as const,
    databaseWriteCount: 0 as const,
    currentBuyConnectionAuthorized: false as const,
    lineConnectionAuthorized: false as const,
    automatedBettingAuthorized: false as const,
    publicPublishAuthorized: false as const,
    productionApplyAuthorized: false as const,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

export function privateMarketDailyReadinessRelativePath(input: {
  date: string;
  venueCode: string;
  outputDigest: string;
}): string {
  validateScope(input.date, input.venueCode);
  if (!/^[0-9a-f]{64}$/u.test(input.outputDigest)) throw new Error("DAILY_READINESS_DIGEST_INVALID");
  return `data/private/trifecta-market-experiments/readiness/${input.date}/${input.venueCode}/${input.outputDigest}.json`;
}

export function writeN2TrifectaPrivateMarketDailyReadiness(input: {
  dataRoot: string;
  readiness: N2TrifectaPrivateMarketDailyReadiness;
}): { relativePath: string; created: boolean; outputDigest: string; fileMode: 0o600 } {
  const relativePath = privateMarketDailyReadinessRelativePath(input.readiness);
  const path = resolveInside(input.dataRoot, relativePath);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const parent = lstatSync(dirname(path));
  if (parent.isSymbolicLink() || !parent.isDirectory()) throw new Error("DAILY_READINESS_PARENT_INVALID");

  const { outputDigest, ...core } = input.readiness;
  if (canonicalHash(core) !== outputDigest) throw new Error("DAILY_READINESS_OUTPUT_DIGEST_MISMATCH");

  if (existsSync(path)) {
    const lst = lstatSync(path);
    if (lst.isSymbolicLink() || !lst.isFile()) throw new Error("DAILY_READINESS_EXISTING_FILE_TYPE_INVALID");
    const stat = statSync(path);
    if ((stat.mode & 0o777) !== 0o600) throw new Error("DAILY_READINESS_EXISTING_FILE_MODE_INVALID");
    if (stat.size <= 0 || stat.size > MAX_READINESS_BYTES) throw new Error("DAILY_READINESS_EXISTING_SIZE_INVALID");
    let existing: unknown;
    try {
      existing = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      throw new Error("DAILY_READINESS_EXISTING_JSON_INVALID");
    }
    if (canonicalHash(existing) !== canonicalHash(input.readiness)) {
      throw new Error("DAILY_READINESS_DIGEST_COLLISION");
    }
    return { relativePath, created: false, outputDigest, fileMode: 0o600 };
  }

  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(input.readiness, null, 2)}\n`, "utf8");
  } finally {
    closeSync(fd);
  }
  const stat = statSync(path);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) throw new Error("DAILY_READINESS_FINAL_MODE_INVALID");
  return { relativePath, created: true, outputDigest, fileMode: 0o600 };
}
