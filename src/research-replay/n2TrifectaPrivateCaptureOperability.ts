import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { resolve, sep } from "node:path";

import { canonicalHash } from "./canonical";
import {
  N2_TRIFECTA_PRIVATE_CAPTURE_LATE_WINDOW_SECONDS,
  type N2TrifectaPrivateCaptureEnvelope,
} from "./n2TrifectaPrivateCaptureExecutor";
import {
  readN2TrifectaPrivateDailyPlanCache,
} from "./n2TrifectaPrivateDailyPlanCache";
import type {
  N2TrifectaLocalCaptureAuthorization,
  N2TrifectaLocalCaptureReservation,
  N2TrifectaLocalCaptureTickReport,
} from "./n2TrifectaLocalCaptureService";

export const N2_TRIFECTA_PRIVATE_CAPTURE_OPERABILITY_VERSION =
  "n2-trifecta-private-capture-operability-v1" as const;

export type N2TrifectaCheckpointOperabilityState =
  | "ACCEPTED"
  | "BLOCKED_EVIDENCE"
  | "RESERVED_NO_ACCEPTED_EVIDENCE"
  | "MISSED_NO_RESERVATION"
  | "DUE_WINDOW_OPEN"
  | "PENDING";

export type N2TrifectaPrivateCaptureOperabilityReport = {
  reportVersion: typeof N2_TRIFECTA_PRIVATE_CAPTURE_OPERABILITY_VERSION;
  status: "PASS" | "DEGRADED" | "BLOCKED";
  blockers: string[];
  checkedAt: string;
  date: string;
  selectedVenueCode: string | null;
  authoritySha: string | null;
  launchdRegistered: boolean | null;
  authorization: {
    present: boolean;
    expiresAt: string | null;
    expiresInHours: number | null;
    expiryWarning: boolean;
    maxRequestsPerDay: number | null;
  };
  heartbeat: {
    latestStatusPresent: boolean;
    latestCheckedAt: string | null;
    latestStatus: string | null;
    ageSeconds: number | null;
    staleThresholdSeconds: number;
    stale: boolean;
    lastSuccessfulTickAt: string | null;
  };
  coverage: {
    expectedCheckpointCount: number;
    maturedCheckpointCount: number;
    acceptedCount: number;
    blockedEvidenceCount: number;
    reservedNoAcceptedEvidenceCount: number;
    missedNoReservationCount: number;
    dueWindowOpenCount: number;
    pendingCount: number;
    attemptedMaturedCount: number;
    attemptedMaturedRatio: number | null;
    acceptedMaturedCount: number;
    acceptedMaturedRatio: number | null;
    consecutiveMissedCheckpointCount: number;
  };
  checkpoints: Array<{
    raceIdentity: string;
    checkpointLabel: string;
    targetCaptureAt: string;
    state: N2TrifectaCheckpointOperabilityState;
    blockerCodes: string[];
  }>;
  storage: {
    rawVenueDayFileCount: number;
    rawVenueDayBytes: number;
    privateCaptureMetadataFileCount: number;
    privateCaptureMetadataBytes: number;
    symlinkCountSkipped: number;
  };
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

type RuntimeAuthorityLike = {
  authoritySha?: unknown;
};

type LatestStatusLike = {
  checkedAt?: unknown;
  report?: Partial<N2TrifectaLocalCaptureTickReport> | unknown;
};

type StorageSummary = {
  fileCount: number;
  bytes: number;
  symlinkCountSkipped: number;
};

const MAX_JSON_BYTES = 2_000_000;
const SHA_RE = /^[0-9a-f]{40}$/u;

function parseInstant(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveInside(rootDir: string, relativePath: string): string {
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new Error("UNSAFE_RELATIVE_PATH");
  }
  const root = resolve(rootDir);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("PATH_ESCAPES_ROOT");
  }
  return target;
}

function readPrivateJson<T>(rootDir: string, relativePath: string): T {
  const path = resolveInside(rootDir, relativePath);
  const lst = lstatSync(path);
  if (lst.isSymbolicLink() || !lst.isFile()) throw new Error("PRIVATE_JSON_FILE_TYPE_INVALID");
  const stat = statSync(path);
  if (stat.size <= 0 || stat.size > MAX_JSON_BYTES) throw new Error("PRIVATE_JSON_SIZE_INVALID");
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function safeReadPrivateJson<T>(rootDir: string, relativePath: string): T | null {
  const path = resolveInside(rootDir, relativePath);
  if (!existsSync(path)) return null;
  return readPrivateJson<T>(rootDir, relativePath);
}

function listRegularJsonFiles(rootDir: string, relativeDir: string): string[] {
  const dir = resolveInside(rootDir, relativeDir);
  if (!existsSync(dir)) return [];
  const lst = lstatSync(dir);
  if (lst.isSymbolicLink() || !lst.isDirectory()) throw new Error("PRIVATE_DIRECTORY_TYPE_INVALID");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => `${relativeDir}/${name}`);
}

function storageSummary(rootDir: string, relativeDir: string): StorageSummary {
  const start = resolveInside(rootDir, relativeDir);
  if (!existsSync(start)) return { fileCount: 0, bytes: 0, symlinkCountSkipped: 0 };
  const summary: StorageSummary = { fileCount: 0, bytes: 0, symlinkCountSkipped: 0 };
  const visit = (path: string): void => {
    const lst = lstatSync(path);
    if (lst.isSymbolicLink()) {
      summary.symlinkCountSkipped += 1;
      return;
    }
    if (lst.isFile()) {
      summary.fileCount += 1;
      summary.bytes += lst.size;
      return;
    }
    if (!lst.isDirectory()) return;
    for (const name of readdirSync(path)) visit(resolve(path, name));
  };
  visit(start);
  return summary;
}

function checkpointDirectory(input: {
  date: string;
  venueCode: string;
  raceNo: number;
  checkpointLabel: string;
}): string {
  return [
    "data",
    "raw",
    "research",
    "trifecta-market",
    input.date,
    input.venueCode,
    String(input.raceNo).padStart(2, "0"),
    input.checkpointLabel,
  ].join("/");
}

function reservationsByCheckpoint(rootDir: string, date: string): Map<string, N2TrifectaLocalCaptureReservation> {
  const map = new Map<string, N2TrifectaLocalCaptureReservation>();
  for (const relativePath of listRegularJsonFiles(
    rootDir,
    `data/private/trifecta-capture/reservations/${date}`,
  )) {
    const reservation = readPrivateJson<N2TrifectaLocalCaptureReservation>(rootDir, relativePath);
    const key = `${reservation.raceIdentity}|${reservation.checkpointLabel}`;
    map.set(key, reservation);
  }
  return map;
}

function blockedEnvelopeCodes(rootDir: string, relativeDir: string): string[] {
  const dir = resolveInside(rootDir, relativeDir);
  if (!existsSync(dir)) return [];
  const lst = lstatSync(dir);
  if (lst.isSymbolicLink() || !lst.isDirectory()) return ["CHECKPOINT_DIRECTORY_TYPE_INVALID"];
  const codes: string[] = [];
  for (const name of readdirSync(dir).filter((value) => value.endsWith(".envelope.json")).sort()) {
    try {
      const envelope = readPrivateJson<N2TrifectaPrivateCaptureEnvelope>(rootDir, `${relativeDir}/${name}`);
      if (envelope.status === "BLOCKED") codes.push(...envelope.blockers);
    } catch {
      codes.push("ENVELOPE_METADATA_INVALID");
    }
  }
  return [...new Set(codes)].sort();
}

function findLastSuccessfulTick(rootDir: string, date: string): string | null {
  const paths = listRegularJsonFiles(rootDir, `data/private/trifecta-capture/reports/${date}`);
  let latest: number | null = null;
  for (const path of paths) {
    try {
      const report = readPrivateJson<N2TrifectaLocalCaptureTickReport>(rootDir, path);
      if (report.status !== "PASS") continue;
      const parsed = parseInstant(report.completedAt);
      if (parsed != null && (latest == null || parsed > latest)) latest = parsed;
    } catch {
      // Operability remains best-effort for historical event reports; latest status is audited separately.
    }
  }
  return latest == null ? null : new Date(latest).toISOString();
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(6));
}

export function buildN2TrifectaPrivateCaptureOperabilityReport(input: {
  dataRoot: string;
  date: string;
  now: string;
  launchdRegistered?: boolean | null;
  heartbeatStaleThresholdSeconds?: number;
  authorizationExpiryWarningHours?: number;
}): N2TrifectaPrivateCaptureOperabilityReport {
  const blockers: string[] = [];
  const nowMs = parseInstant(input.now);
  if (nowMs == null) blockers.push("NOW_INVALID");
  const heartbeatStaleThresholdSeconds = input.heartbeatStaleThresholdSeconds ?? 120;
  const authorizationExpiryWarningHours = input.authorizationExpiryWarningHours ?? 7 * 24;
  if (!Number.isFinite(heartbeatStaleThresholdSeconds) || heartbeatStaleThresholdSeconds <= 0) {
    blockers.push("HEARTBEAT_THRESHOLD_INVALID");
  }
  if (!Number.isFinite(authorizationExpiryWarningHours) || authorizationExpiryWarningHours <= 0) {
    blockers.push("AUTH_EXPIRY_THRESHOLD_INVALID");
  }

  const cacheRead = readN2TrifectaPrivateDailyPlanCache({
    dataRoot: input.dataRoot,
    expectedDate: input.date,
    now: input.now,
  });
  if (cacheRead.status !== "PASS" || !cacheRead.plan || !cacheRead.cache) {
    blockers.push(...cacheRead.blockers.map((code) => `DAILY_PLAN_${code}`));
  }
  const plan = cacheRead.plan;
  const venueCode = cacheRead.cache?.venueCode ?? null;

  let authorization: N2TrifectaLocalCaptureAuthorization | null = null;
  try {
    authorization = safeReadPrivateJson<N2TrifectaLocalCaptureAuthorization>(
      input.dataRoot,
      "data/private/trifecta-capture/authorization.json",
    );
  } catch {
    blockers.push("AUTHORIZATION_METADATA_INVALID");
  }
  if (!authorization) blockers.push("AUTHORIZATION_MISSING");
  const authExpiryMs = authorization ? parseInstant(authorization.expiresAt) : null;
  if (authorization && authExpiryMs == null) blockers.push("AUTHORIZATION_EXPIRY_INVALID");
  const expiresInHours = authExpiryMs != null && nowMs != null
    ? Number(((authExpiryMs - nowMs) / 3_600_000).toFixed(3))
    : null;
  const expiryWarning = expiresInHours != null && expiresInHours <= authorizationExpiryWarningHours;

  let authoritySha: string | null = null;
  try {
    const authority = safeReadPrivateJson<RuntimeAuthorityLike>(
      input.dataRoot,
      "data/private/trifecta-capture/runtime-authority.json",
    );
    if (authority && typeof authority.authoritySha === "string" && SHA_RE.test(authority.authoritySha)) {
      authoritySha = authority.authoritySha;
    } else if (authority) {
      blockers.push("RUNTIME_AUTHORITY_SHA_INVALID");
    } else {
      blockers.push("RUNTIME_AUTHORITY_MISSING");
    }
  } catch {
    blockers.push("RUNTIME_AUTHORITY_METADATA_INVALID");
  }

  let latestStatusPresent = false;
  let latestCheckedAt: string | null = null;
  let latestStatus: string | null = null;
  let heartbeatAgeSeconds: number | null = null;
  let heartbeatStale = true;
  try {
    const latest = safeReadPrivateJson<LatestStatusLike>(
      input.dataRoot,
      "data/private/trifecta-capture/status/latest.json",
    );
    if (latest) {
      latestStatusPresent = true;
      if (typeof latest.checkedAt === "string" && parseInstant(latest.checkedAt) != null) {
        latestCheckedAt = latest.checkedAt;
        heartbeatAgeSeconds = nowMs == null
          ? null
          : Math.max(0, Number(((nowMs - parseInstant(latest.checkedAt)!) / 1_000).toFixed(3)));
        heartbeatStale = heartbeatAgeSeconds == null
          || heartbeatAgeSeconds > heartbeatStaleThresholdSeconds;
      } else {
        blockers.push("LATEST_STATUS_CHECKED_AT_INVALID");
      }
      if (typeof latest.report === "object" && latest.report !== null
        && "status" in latest.report && typeof (latest.report as { status?: unknown }).status === "string") {
        latestStatus = String((latest.report as { status?: unknown }).status);
      }
    }
  } catch {
    blockers.push("LATEST_STATUS_METADATA_INVALID");
  }
  if (!latestStatusPresent) blockers.push("LATEST_STATUS_MISSING");

  const reservations = plan ? reservationsByCheckpoint(input.dataRoot, input.date) : new Map();
  const checkpoints: N2TrifectaPrivateCaptureOperabilityReport["checkpoints"] = [];
  if (plan && venueCode && nowMs != null) {
    for (const entry of [...plan.entries].sort((a, b) => a.targetCaptureAt.localeCompare(b.targetCaptureAt))) {
      const directory = checkpointDirectory({
        date: entry.date,
        venueCode: entry.venueCode,
        raceNo: entry.raceNo,
        checkpointLabel: entry.checkpointLabel,
      });
      const acceptedPath = `${directory}/accepted.json`;
      const accepted = existsSync(resolveInside(input.dataRoot, acceptedPath));
      const envelopeBlockers = accepted ? [] : blockedEnvelopeCodes(input.dataRoot, directory);
      const reservation = reservations.get(`${entry.raceIdentity}|${entry.checkpointLabel}`) ?? null;
      const targetMs = parseInstant(entry.targetCaptureAt);
      if (targetMs == null) {
        blockers.push("PLAN_TARGET_CAPTURE_AT_INVALID");
        continue;
      }
      let state: N2TrifectaCheckpointOperabilityState;
      if (accepted) state = "ACCEPTED";
      else if (envelopeBlockers.length > 0) state = "BLOCKED_EVIDENCE";
      else if (reservation) state = "RESERVED_NO_ACCEPTED_EVIDENCE";
      else if (nowMs > targetMs + N2_TRIFECTA_PRIVATE_CAPTURE_LATE_WINDOW_SECONDS * 1_000) {
        state = "MISSED_NO_RESERVATION";
      } else if (nowMs >= targetMs) state = "DUE_WINDOW_OPEN";
      else state = "PENDING";
      checkpoints.push({
        raceIdentity: entry.raceIdentity,
        checkpointLabel: entry.checkpointLabel,
        targetCaptureAt: entry.targetCaptureAt,
        state,
        blockerCodes: envelopeBlockers,
      });
    }
  }

  const matured = checkpoints.filter((checkpoint) => {
    const target = parseInstant(checkpoint.targetCaptureAt);
    return target != null && nowMs != null
      && nowMs > target + N2_TRIFECTA_PRIVATE_CAPTURE_LATE_WINDOW_SECONDS * 1_000;
  });
  const acceptedCount = checkpoints.filter((item) => item.state === "ACCEPTED").length;
  const blockedEvidenceCount = checkpoints.filter((item) => item.state === "BLOCKED_EVIDENCE").length;
  const reservedNoAcceptedEvidenceCount = checkpoints.filter(
    (item) => item.state === "RESERVED_NO_ACCEPTED_EVIDENCE",
  ).length;
  const missedNoReservationCount = checkpoints.filter(
    (item) => item.state === "MISSED_NO_RESERVATION",
  ).length;
  const dueWindowOpenCount = checkpoints.filter((item) => item.state === "DUE_WINDOW_OPEN").length;
  const pendingCount = checkpoints.filter((item) => item.state === "PENDING").length;
  const attemptedMatured = matured.filter((item) => [
    "ACCEPTED",
    "BLOCKED_EVIDENCE",
    "RESERVED_NO_ACCEPTED_EVIDENCE",
  ].includes(item.state));
  const acceptedMatured = matured.filter((item) => item.state === "ACCEPTED");
  let consecutiveMissedCheckpointCount = 0;
  for (const checkpoint of [...matured].sort((a, b) => b.targetCaptureAt.localeCompare(a.targetCaptureAt))) {
    if (checkpoint.state !== "MISSED_NO_RESERVATION") break;
    consecutiveMissedCheckpointCount += 1;
  }

  const rawStorage = venueCode
    ? storageSummary(input.dataRoot, `data/raw/research/trifecta-market/${input.date}/${venueCode}`)
    : { fileCount: 0, bytes: 0, symlinkCountSkipped: 0 };
  const privateStorage = storageSummary(input.dataRoot, "data/private/trifecta-capture");
  const normalizedBlockers = [...new Set(blockers)].sort();
  const degraded = normalizedBlockers.length === 0 && (
    heartbeatStale
    || expiryWarning
    || missedNoReservationCount > 0
    || reservedNoAcceptedEvidenceCount > 0
    || input.launchdRegistered === false
  );
  const status = normalizedBlockers.length > 0 ? "BLOCKED" as const : degraded ? "DEGRADED" as const : "PASS" as const;

  const core = {
    reportVersion: N2_TRIFECTA_PRIVATE_CAPTURE_OPERABILITY_VERSION,
    status,
    blockers: normalizedBlockers,
    checkedAt: input.now,
    date: input.date,
    selectedVenueCode: venueCode,
    authoritySha,
    launchdRegistered: input.launchdRegistered ?? null,
    authorization: {
      present: authorization != null,
      expiresAt: authorization?.expiresAt ?? null,
      expiresInHours,
      expiryWarning,
      maxRequestsPerDay: authorization?.maxRequestsPerDay ?? null,
    },
    heartbeat: {
      latestStatusPresent,
      latestCheckedAt,
      latestStatus,
      ageSeconds: heartbeatAgeSeconds,
      staleThresholdSeconds: heartbeatStaleThresholdSeconds,
      stale: heartbeatStale,
      lastSuccessfulTickAt: findLastSuccessfulTick(input.dataRoot, input.date),
    },
    coverage: {
      expectedCheckpointCount: checkpoints.length,
      maturedCheckpointCount: matured.length,
      acceptedCount,
      blockedEvidenceCount,
      reservedNoAcceptedEvidenceCount,
      missedNoReservationCount,
      dueWindowOpenCount,
      pendingCount,
      attemptedMaturedCount: attemptedMatured.length,
      attemptedMaturedRatio: ratio(attemptedMatured.length, matured.length),
      acceptedMaturedCount: acceptedMatured.length,
      acceptedMaturedRatio: ratio(acceptedMatured.length, matured.length),
      consecutiveMissedCheckpointCount,
    },
    checkpoints,
    storage: {
      rawVenueDayFileCount: rawStorage.fileCount,
      rawVenueDayBytes: rawStorage.bytes,
      privateCaptureMetadataFileCount: privateStorage.fileCount,
      privateCaptureMetadataBytes: privateStorage.bytes,
      symlinkCountSkipped: rawStorage.symlinkCountSkipped + privateStorage.symlinkCountSkipped,
    },
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
