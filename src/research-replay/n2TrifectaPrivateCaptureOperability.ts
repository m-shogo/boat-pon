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

type AcceptedMarkerLike = {
  markerVersion?: unknown;
  checkpointKey?: unknown;
  raceIdentity?: unknown;
  checkpointLabel?: unknown;
  rawSha256?: unknown;
  rawRelativePath?: unknown;
  envelopeRelativePath?: unknown;
  acceptedAt?: unknown;
  databaseWriteAuthorized?: unknown;
  productionApplyExecuted?: unknown;
};

type StorageSummary = {
  fileCount: number;
  bytes: number;
  symlinkCountSkipped: number;
};

type CaptureEvidenceSummary = {
  blockersByCheckpoint: Map<string, string[]>;
  invalidReportCount: number;
};

const MAX_JSON_BYTES = 2_000_000;
const SHA_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;

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
    if (reservation.date !== date) throw new Error("RESERVATION_DATE_MISMATCH");
    const key = `${reservation.raceIdentity}|${reservation.checkpointLabel}`;
    if (map.has(key)) throw new Error("RESERVATION_CHECKPOINT_DUPLICATE");
    map.set(key, reservation);
  }
  return map;
}

function captureEvidenceByCheckpoint(rootDir: string, date: string): CaptureEvidenceSummary {
  const blockersByCheckpoint = new Map<string, string[]>();
  let invalidReportCount = 0;
  for (const relativePath of listRegularJsonFiles(
    rootDir,
    `data/private/trifecta-capture/reports/${date}`,
  )) {
    let report: N2TrifectaLocalCaptureTickReport;
    try {
      report = readPrivateJson<N2TrifectaLocalCaptureTickReport>(rootDir, relativePath);
    } catch {
      invalidReportCount += 1;
      continue;
    }
    for (const result of report.executorReport?.entryResults ?? []) {
      if (result.result !== "BLOCKED_EVIDENCE_SAVED") continue;
      const key = `${result.raceIdentity}|${result.checkpointLabel}`;
      const existing = blockersByCheckpoint.get(key) ?? [];
      blockersByCheckpoint.set(
        key,
        [...new Set([
          ...existing,
          ...(result.blockers.length > 0 ? result.blockers : ["BLOCKED_CAPTURE_REPORTED"]),
        ])].sort(),
      );
    }
  }
  return { blockersByCheckpoint, invalidReportCount };
}

function auditAcceptedMarker(input: {
  rootDir: string;
  relativePath: string;
  directory: string;
  raceIdentity: string;
  checkpointLabel: string;
}): { accepted: boolean; blockers: string[] } {
  const path = resolveInside(input.rootDir, input.relativePath);
  if (!existsSync(path)) return { accepted: false, blockers: [] };
  let marker: AcceptedMarkerLike;
  try {
    marker = readPrivateJson<AcceptedMarkerLike>(input.rootDir, input.relativePath);
  } catch {
    return { accepted: false, blockers: ["ACCEPTED_MARKER_METADATA_INVALID"] };
  }
  const blockers: string[] = [];
  if (marker.markerVersion !== "n2-trifecta-private-capture-accepted-v1") {
    blockers.push("ACCEPTED_MARKER_VERSION_INVALID");
  }
  if (typeof marker.checkpointKey !== "string" || !SHA256_RE.test(marker.checkpointKey)) {
    blockers.push("ACCEPTED_MARKER_CHECKPOINT_KEY_INVALID");
  }
  if (marker.raceIdentity !== input.raceIdentity) blockers.push("ACCEPTED_MARKER_RACE_IDENTITY_MISMATCH");
  if (marker.checkpointLabel !== input.checkpointLabel) blockers.push("ACCEPTED_MARKER_CHECKPOINT_LABEL_MISMATCH");
  if (typeof marker.rawSha256 !== "string" || !SHA256_RE.test(marker.rawSha256)) {
    blockers.push("ACCEPTED_MARKER_RAW_SHA256_INVALID");
  }
  if (typeof marker.rawRelativePath !== "string"
    || !marker.rawRelativePath.startsWith(`${input.directory}/`)
    || !marker.rawRelativePath.endsWith(".html")) {
    blockers.push("ACCEPTED_MARKER_RAW_PATH_INVALID");
  }
  if (typeof marker.envelopeRelativePath !== "string"
    || !marker.envelopeRelativePath.startsWith(`${input.directory}/`)
    || !marker.envelopeRelativePath.endsWith(".envelope.json")) {
    blockers.push("ACCEPTED_MARKER_ENVELOPE_PATH_INVALID");
  }
  if (typeof marker.acceptedAt !== "string" || parseInstant(marker.acceptedAt) == null) {
    blockers.push("ACCEPTED_MARKER_ACCEPTED_AT_INVALID");
  }
  if (marker.databaseWriteAuthorized !== false) blockers.push("ACCEPTED_MARKER_DATABASE_WRITE_AUTHORITY_INVALID");
  if (marker.productionApplyExecuted !== false) blockers.push("ACCEPTED_MARKER_PRODUCTION_APPLY_INVALID");
  return { accepted: blockers.length === 0, blockers: [...new Set(blockers)].sort() };
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
      // The main report audit records malformed metadata separately.
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

  let reservations = new Map<string, N2TrifectaLocalCaptureReservation>();
  try {
    reservations = plan ? reservationsByCheckpoint(input.dataRoot, input.date) : new Map();
  } catch {
    blockers.push("RESERVATION_METADATA_INVALID");
  }
  let captureEvidence: CaptureEvidenceSummary = {
    blockersByCheckpoint: new Map(),
    invalidReportCount: 0,
  };
  try {
    captureEvidence = captureEvidenceByCheckpoint(input.dataRoot, input.date);
  } catch {
    blockers.push("CAPTURE_REPORT_METADATA_INVALID");
  }
  if (captureEvidence.invalidReportCount > 0) blockers.push("CAPTURE_REPORT_METADATA_INVALID");

  const checkpoints: N2TrifectaPrivateCaptureOperabilityReport["checkpoints"] = [];
  if (plan && venueCode && nowMs != null) {
    for (const entry of [...plan.entries].sort((a, b) => {
      const target = a.targetCaptureAt.localeCompare(b.targetCaptureAt);
      if (target !== 0) return target;
      return a.raceIdentity.localeCompare(b.raceIdentity);
    })) {
      const directory = checkpointDirectory({
        date: entry.date,
        venueCode: entry.venueCode,
        raceNo: entry.raceNo,
        checkpointLabel: entry.checkpointLabel,
      });
      const acceptedPath = `${directory}/accepted.json`;
      const acceptedAudit = auditAcceptedMarker({
        rootDir: input.dataRoot,
        relativePath: acceptedPath,
        directory,
        raceIdentity: entry.raceIdentity,
        checkpointLabel: entry.checkpointLabel,
      });
      if (acceptedAudit.blockers.length > 0) blockers.push(...acceptedAudit.blockers);
      const evidenceBlockers = acceptedAudit.accepted
        ? []
        : captureEvidence.blockersByCheckpoint.get(`${entry.raceIdentity}|${entry.checkpointLabel}`) ?? [];
      const checkpointBlockers = [...new Set([
        ...acceptedAudit.blockers,
        ...evidenceBlockers,
      ])].sort();
      const reservation = reservations.get(`${entry.raceIdentity}|${entry.checkpointLabel}`) ?? null;
      const targetMs = parseInstant(entry.targetCaptureAt);
      if (targetMs == null) {
        blockers.push("PLAN_TARGET_CAPTURE_AT_INVALID");
        continue;
      }
      let state: N2TrifectaCheckpointOperabilityState;
      if (acceptedAudit.accepted) state = "ACCEPTED";
      else if (checkpointBlockers.length > 0) state = "BLOCKED_EVIDENCE";
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
        blockerCodes: checkpointBlockers,
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
  for (const checkpoint of [...matured].sort((a, b) => {
    const target = b.targetCaptureAt.localeCompare(a.targetCaptureAt);
    if (target !== 0) return target;
    return b.raceIdentity.localeCompare(a.raceIdentity);
  })) {
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
