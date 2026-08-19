import {
  existsSync,
  lstatSync,
  readFileSync,
  statSync,
} from "node:fs";
import { resolve, sep } from "node:path";

import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import { N2_TRIFECTA_PRIVATE_CAPTURE_LATE_WINDOW_SECONDS } from "./n2TrifectaPrivateCaptureExecutor";
import {
  N2_TRIFECTA_PRIVATE_HEARTBEAT_VERSION,
  type N2TrifectaPrivateHeartbeatRecord,
} from "./n2TrifectaPrivateHeartbeat";
import { readN2TrifectaPrivateDailyPlanCache } from "./n2TrifectaPrivateDailyPlanCache";

export const N2_TRIFECTA_PRIVATE_HEARTBEAT_GAP_DIAGNOSTICS_VERSION =
  "n2-trifecta-private-heartbeat-gap-diagnostics-v1" as const;

const MAX_HEARTBEAT_HISTORY_BYTES = 10_000_000;
const MAX_HEARTBEAT_RECORDS = 10_000;
const DEFAULT_EXPECTED_INTERVAL_SECONDS = 30;
const DEFAULT_GAP_THRESHOLD_SECONDS = 120;
const DEFAULT_RECENT_WINDOW_SECONDS = 60 * 60;

export type N2TrifectaHeartbeatGapAffectedCheckpoint = {
  raceIdentity: string;
  checkpointLabel: string;
  targetCaptureAt: string;
  lateWindowEndsAt: string;
  overlapSeconds: number;
};

export type N2TrifectaHeartbeatGap = {
  fromRecordedAt: string;
  toRecordedAt: string | null;
  durationSeconds: number;
  currentOpenGap: boolean;
  affectedCheckpoints: N2TrifectaHeartbeatGapAffectedCheckpoint[];
};

export type N2TrifectaPrivateHeartbeatGapDiagnosticsReport = {
  reportVersion: typeof N2_TRIFECTA_PRIVATE_HEARTBEAT_GAP_DIAGNOSTICS_VERSION;
  status: "PASS" | "DEGRADED" | "BLOCKED";
  blockers: string[];
  checkedAt: string;
  date: string;
  historyPresent: boolean;
  historyRecordCount: number;
  historyCoverageStartsAt: string | null;
  latestRecordedAt: string | null;
  latestAgeSeconds: number | null;
  expectedIntervalSeconds: number;
  gapThresholdSeconds: number;
  recentWindowSeconds: number;
  significantGapCount: number;
  recentSignificantGapCount: number;
  largestGapSeconds: number | null;
  currentGapOverThreshold: boolean;
  latestSignificantGap: N2TrifectaHeartbeatGap | null;
  gaps: N2TrifectaHeartbeatGap[];
  affectedCheckpointCount: number;
  planStatus: "PASS" | "UNAVAILABLE";
  planBlockers: string[];
  networkRequestCount: 0;
  databaseReadCount: 0;
  databaseWriteCount: 0;
  rawOddsValuesRead: false;
  rawOddsValuesPrinted: false;
  rawOddsValuesPublished: false;
  currentBuyChanged: false;
  lineChanged: false;
  publicPublished: false;
  automatedBettingChanged: false;
  productionApplyExecuted: false;
  outputDigest: string;
};

type HeartbeatRecordLike = Partial<N2TrifectaPrivateHeartbeatRecord> & Record<string, unknown>;

type CheckpointWindow = {
  raceIdentity: string;
  checkpointLabel: string;
  targetCaptureAt: string;
  targetMs: number;
  endMs: number;
};

function canonicalInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return canonicalUtcTimestamp(value);
  } catch {
    return null;
  }
}

function parseInstant(value: unknown): number | null {
  const canonical = canonicalInstant(value);
  if (canonical == null) return null;
  const parsed = Date.parse(canonical);
  return Number.isFinite(parsed) ? parsed : null;
}

function validCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return false;
  try {
    return canonicalUtcTimestamp(`${date}T00:00:00.000Z`).slice(0, 10) === date;
  } catch {
    return false;
  }
}

function resolveInside(rootDir: string, relativePath: string): string {
  const root = resolve(rootDir);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("PATH_ESCAPES_ROOT");
  return target;
}

function heartbeatRelativePath(date: string): string {
  if (!validCalendarDate(date)) throw new Error("HEARTBEAT_DATE_INVALID");
  return `data/private/trifecta-capture/heartbeats/${date}.jsonl`;
}

function validateHeartbeatRecord(record: HeartbeatRecordLike, date: string): string[] {
  const blockers: string[] = [];
  if (record.heartbeatVersion !== N2_TRIFECTA_PRIVATE_HEARTBEAT_VERSION) {
    blockers.push("HEARTBEAT_VERSION_INVALID");
  }
  const canonicalRecordedAt = canonicalInstant(record.recordedAt);
  if (canonicalRecordedAt == null) blockers.push("HEARTBEAT_RECORDED_AT_INVALID");
  else if (canonicalRecordedAt !== record.recordedAt) blockers.push("HEARTBEAT_RECORDED_AT_NON_CANONICAL");
  if (record.dateJst !== date) blockers.push("HEARTBEAT_DATE_MISMATCH");
  if (!["PASS", "NO_CHANGE", "BLOCKED"].includes(String(record.status))) {
    blockers.push("HEARTBEAT_STATUS_INVALID");
  }
  if (!["PASS", "BLOCKED"].includes(String(record.runtimeAuthorityStatus))) {
    blockers.push("HEARTBEAT_RUNTIME_AUTHORITY_STATUS_INVALID");
  }
  if (record.databaseWriteCount !== 0 || record.primaryDbWriteCount !== 0 || record.sidecarWriteCount !== 0) {
    blockers.push("HEARTBEAT_DATABASE_WRITE_BOUNDARY_INVALID");
  }
  if (record.rawOddsValuesRecorded !== false) blockers.push("HEARTBEAT_RAW_ODDS_BOUNDARY_INVALID");
  if (record.currentBuyChanged !== false) blockers.push("HEARTBEAT_CURRENT_BUY_BOUNDARY_INVALID");
  if (record.lineChanged !== false) blockers.push("HEARTBEAT_LINE_BOUNDARY_INVALID");
  if (record.publicPublished !== false) blockers.push("HEARTBEAT_PUBLIC_BOUNDARY_INVALID");
  if (record.automatedBettingChanged !== false) blockers.push("HEARTBEAT_AUTOMATED_BETTING_BOUNDARY_INVALID");
  if (record.productionApplyExecuted !== false) blockers.push("HEARTBEAT_PRODUCTION_APPLY_BOUNDARY_INVALID");
  const { recordDigest, ...core } = record;
  if (typeof recordDigest !== "string" || canonicalHash(core) !== recordDigest) {
    blockers.push("HEARTBEAT_RECORD_DIGEST_MISMATCH");
  }
  return blockers;
}

function readHeartbeatHistory(input: {
  dataRoot: string;
  date: string;
}): { records: HeartbeatRecordLike[]; blockers: string[]; present: boolean } {
  const relativePath = heartbeatRelativePath(input.date);
  const path = resolveInside(input.dataRoot, relativePath);
  if (!existsSync(path)) return { records: [], blockers: ["HEARTBEAT_HISTORY_MISSING"], present: false };
  const lst = lstatSync(path);
  if (lst.isSymbolicLink() || !lst.isFile()) {
    return { records: [], blockers: ["HEARTBEAT_HISTORY_FILE_TYPE_INVALID"], present: true };
  }
  const stat = statSync(path);
  if (stat.size <= 0 || stat.size > MAX_HEARTBEAT_HISTORY_BYTES) {
    return { records: [], blockers: ["HEARTBEAT_HISTORY_SIZE_INVALID"], present: true };
  }

  const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.trim().length > 0);
  if (lines.length > MAX_HEARTBEAT_RECORDS) {
    return { records: [], blockers: ["HEARTBEAT_HISTORY_RECORD_LIMIT_EXCEEDED"], present: true };
  }

  const records: HeartbeatRecordLike[] = [];
  const blockers: string[] = [];
  let previousMs: number | null = null;
  for (const line of lines) {
    let record: HeartbeatRecordLike;
    try {
      record = JSON.parse(line) as HeartbeatRecordLike;
    } catch {
      blockers.push("HEARTBEAT_HISTORY_JSON_INVALID");
      continue;
    }
    blockers.push(...validateHeartbeatRecord(record, input.date));
    const recordedMs = parseInstant(record.recordedAt);
    if (recordedMs != null && previousMs != null && recordedMs < previousMs) {
      blockers.push("HEARTBEAT_HISTORY_NON_MONOTONIC");
    }
    if (recordedMs != null) previousMs = recordedMs;
    records.push(record);
  }
  return { records, blockers: [...new Set(blockers)].sort(), present: true };
}

function checkpointWindows(input: {
  dataRoot: string;
  date: string;
  now: string;
}): { windows: CheckpointWindow[]; status: "PASS" | "UNAVAILABLE"; blockers: string[] } {
  const cacheRead = readN2TrifectaPrivateDailyPlanCache({
    dataRoot: input.dataRoot,
    expectedDate: input.date,
    now: input.now,
  });
  if (cacheRead.status !== "PASS" || !cacheRead.plan) {
    return {
      windows: [],
      status: "UNAVAILABLE",
      blockers: cacheRead.blockers.map((code) => `DAILY_PLAN_${code}`).sort(),
    };
  }
  const windows: CheckpointWindow[] = [];
  const blockers: string[] = [];
  for (const entry of cacheRead.plan.entries) {
    const targetMs = parseInstant(entry.targetCaptureAt);
    if (targetMs == null) {
      blockers.push("PLAN_TARGET_CAPTURE_AT_INVALID");
      continue;
    }
    windows.push({
      raceIdentity: entry.raceIdentity,
      checkpointLabel: entry.checkpointLabel,
      targetCaptureAt: entry.targetCaptureAt,
      targetMs,
      endMs: targetMs + N2_TRIFECTA_PRIVATE_CAPTURE_LATE_WINDOW_SECONDS * 1_000,
    });
  }
  return {
    windows,
    status: blockers.length === 0 ? "PASS" : "UNAVAILABLE",
    blockers: [...new Set(blockers)].sort(),
  };
}

function affectedCheckpoints(input: {
  gapStartMs: number;
  gapEndMs: number;
  windows: CheckpointWindow[];
}): N2TrifectaHeartbeatGapAffectedCheckpoint[] {
  return input.windows.flatMap((window) => {
    const overlapStart = Math.max(input.gapStartMs, window.targetMs);
    const overlapEnd = Math.min(input.gapEndMs, window.endMs);
    if (overlapEnd <= overlapStart) return [];
    return [{
      raceIdentity: window.raceIdentity,
      checkpointLabel: window.checkpointLabel,
      targetCaptureAt: window.targetCaptureAt,
      lateWindowEndsAt: new Date(window.endMs).toISOString(),
      overlapSeconds: Number(((overlapEnd - overlapStart) / 1_000).toFixed(3)),
    }];
  });
}

export function buildN2TrifectaPrivateHeartbeatGapDiagnostics(input: {
  dataRoot: string;
  date: string;
  now: string;
  expectedIntervalSeconds?: number;
  gapThresholdSeconds?: number;
  recentWindowSeconds?: number;
}): N2TrifectaPrivateHeartbeatGapDiagnosticsReport {
  const blockers: string[] = [];
  const canonicalNow = canonicalInstant(input.now);
  const nowMs = canonicalNow == null ? null : Date.parse(canonicalNow);
  if (nowMs == null || !Number.isFinite(nowMs)) blockers.push("NOW_INVALID");
  const expectedIntervalSeconds = input.expectedIntervalSeconds ?? DEFAULT_EXPECTED_INTERVAL_SECONDS;
  const gapThresholdSeconds = input.gapThresholdSeconds ?? DEFAULT_GAP_THRESHOLD_SECONDS;
  const recentWindowSeconds = input.recentWindowSeconds ?? DEFAULT_RECENT_WINDOW_SECONDS;
  if (!Number.isFinite(expectedIntervalSeconds) || expectedIntervalSeconds <= 0) blockers.push("EXPECTED_INTERVAL_INVALID");
  if (!Number.isFinite(gapThresholdSeconds) || gapThresholdSeconds <= expectedIntervalSeconds) blockers.push("GAP_THRESHOLD_INVALID");
  if (!Number.isFinite(recentWindowSeconds) || recentWindowSeconds <= 0) blockers.push("RECENT_WINDOW_INVALID");

  let history: ReturnType<typeof readHeartbeatHistory> = { records: [], blockers: [], present: false };
  try {
    history = readHeartbeatHistory({ dataRoot: input.dataRoot, date: input.date });
    blockers.push(...history.blockers);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : "HEARTBEAT_HISTORY_READ_FAILED");
  }

  const plan = checkpointWindows({
    dataRoot: input.dataRoot,
    date: input.date,
    now: canonicalNow ?? input.now,
  });
  const validRecords = history.records
    .map((record) => ({ record, ms: parseInstant(record.recordedAt) }))
    .filter((item): item is { record: HeartbeatRecordLike; ms: number } => item.ms != null);

  const gaps: N2TrifectaHeartbeatGap[] = [];
  if (nowMs != null && Number.isFinite(nowMs) && blockers.length === 0) {
    for (let index = 1; index < validRecords.length; index += 1) {
      const previous = validRecords[index - 1];
      const current = validRecords[index];
      const durationSeconds = Number(((current.ms - previous.ms) / 1_000).toFixed(3));
      if (durationSeconds <= gapThresholdSeconds) continue;
      gaps.push({
        fromRecordedAt: String(previous.record.recordedAt),
        toRecordedAt: String(current.record.recordedAt),
        durationSeconds,
        currentOpenGap: false,
        affectedCheckpoints: affectedCheckpoints({
          gapStartMs: previous.ms,
          gapEndMs: current.ms,
          windows: plan.windows,
        }),
      });
    }
    const latest = validRecords.at(-1);
    if (latest) {
      const durationSeconds = Number(((nowMs - latest.ms) / 1_000).toFixed(3));
      if (durationSeconds > gapThresholdSeconds) {
        gaps.push({
          fromRecordedAt: String(latest.record.recordedAt),
          toRecordedAt: null,
          durationSeconds,
          currentOpenGap: true,
          affectedCheckpoints: affectedCheckpoints({
            gapStartMs: latest.ms,
            gapEndMs: nowMs,
            windows: plan.windows,
          }),
        });
      }
    }
  }

  const latestRecord = validRecords.at(-1) ?? null;
  const latestAgeSeconds = latestRecord && nowMs != null && Number.isFinite(nowMs)
    ? Math.max(0, Number(((nowMs - latestRecord.ms) / 1_000).toFixed(3)))
    : null;
  const recentCutoff = nowMs == null || !Number.isFinite(nowMs)
    ? null
    : nowMs - recentWindowSeconds * 1_000;
  const recentSignificantGapCount = recentCutoff == null
    ? 0
    : gaps.filter((gap) => {
      const endpoint = gap.toRecordedAt ? parseInstant(gap.toRecordedAt) : nowMs;
      return endpoint != null && endpoint >= recentCutoff;
    }).length;
  const currentGapOverThreshold = gaps.some((gap) => gap.currentOpenGap);
  const affectedCheckpointCount = new Set(
    gaps.flatMap((gap) => gap.affectedCheckpoints.map(
      (checkpoint) => `${checkpoint.raceIdentity}|${checkpoint.checkpointLabel}`,
    )),
  ).size;
  const normalizedBlockers = [...new Set(blockers)].sort();
  const status = normalizedBlockers.length > 0
    ? "BLOCKED" as const
    : currentGapOverThreshold || recentSignificantGapCount > 0
      ? "DEGRADED" as const
      : "PASS" as const;

  const core = {
    reportVersion: N2_TRIFECTA_PRIVATE_HEARTBEAT_GAP_DIAGNOSTICS_VERSION,
    status,
    blockers: normalizedBlockers,
    checkedAt: canonicalNow ?? input.now,
    date: input.date,
    historyPresent: history.present,
    historyRecordCount: validRecords.length,
    historyCoverageStartsAt: validRecords[0]?.record.recordedAt as string | undefined ?? null,
    latestRecordedAt: latestRecord?.record.recordedAt as string | undefined ?? null,
    latestAgeSeconds,
    expectedIntervalSeconds,
    gapThresholdSeconds,
    recentWindowSeconds,
    significantGapCount: gaps.length,
    recentSignificantGapCount,
    largestGapSeconds: gaps.length > 0 ? Math.max(...gaps.map((gap) => gap.durationSeconds)) : null,
    currentGapOverThreshold,
    latestSignificantGap: gaps.at(-1) ?? null,
    gaps,
    affectedCheckpointCount,
    planStatus: plan.status,
    planBlockers: plan.blockers,
    networkRequestCount: 0 as const,
    databaseReadCount: 0 as const,
    databaseWriteCount: 0 as const,
    rawOddsValuesRead: false as const,
    rawOddsValuesPrinted: false as const,
    rawOddsValuesPublished: false as const,
    currentBuyChanged: false as const,
    lineChanged: false as const,
    publicPublished: false as const,
    automatedBettingChanged: false as const,
    productionApplyExecuted: false as const,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}
