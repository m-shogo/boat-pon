import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { officialVenueCode } from "../domain/officialLinks";
import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import {
  N2_TRIFECTA_ODDS_CAPTURE_APPROVAL_SCOPE,
  N2_TRIFECTA_ODDS_CHECKPOINT_COLLECTION_VERSION,
  type N2TrifectaOddsCaptureApproval,
  type N2TrifectaOddsCheckpointEntry,
  type N2TrifectaOddsCheckpointPlan,
} from "./n2TrifectaOddsCheckpointCollection";
import {
  N2_TRIFECTA_PRIVATE_CAPTURE_EARLY_WINDOW_SECONDS,
  N2_TRIFECTA_PRIVATE_CAPTURE_LATE_WINDOW_SECONDS,
  executeN2TrifectaPrivateCapture,
  type N2TrifectaPrivateCaptureRunReport,
  type N2TrifectaPrivateFetcher,
} from "./n2TrifectaPrivateCaptureExecutor";
import { readN2TrifectaPrivateCapturePlan } from "./n2TrifectaPrivateCapturePlanReader";
import { readN2TrifectaPrivateDailyPlanCache } from "./n2TrifectaPrivateDailyPlanCache";

export const N2_TRIFECTA_LOCAL_CAPTURE_SERVICE_VERSION =
  "n2-trifecta-local-capture-service-v1.1" as const;
export const N2_TRIFECTA_LOCAL_CAPTURE_AUTHORIZATION_VERSION =
  "n2-trifecta-local-capture-authorization-v1" as const;
export const N2_TRIFECTA_LOCAL_CAPTURE_SELECTION_VERSION =
  "n2-trifecta-local-capture-selection-v1" as const;
export const N2_TRIFECTA_LOCAL_CAPTURE_RESERVATION_VERSION =
  "n2-trifecta-local-capture-reservation-v1" as const;
export const N2_TRIFECTA_LOCAL_CAPTURE_REPORT_VERSION =
  "n2-trifecta-local-capture-report-v1.1" as const;

export type N2TrifectaLocalCaptureAuthorization = {
  authorizationVersion: typeof N2_TRIFECTA_LOCAL_CAPTURE_AUTHORIZATION_VERSION;
  authorizationId: string;
  issuedAt: string;
  expiresAt: string;
  stage: "ONE_VENUE_REVIEW";
  maxRequestsPerDay: 48;
  checkpointLabels: ["T-30", "T-20", "T-10", "T-5"];
  minInterRequestMs: 10_000;
  privateResearchOnly: true;
  publicRedistributionAuthorized: false;
  databaseWriteAuthorized: false;
  currentBuyConnectionAuthorized: false;
  lineConnectionAuthorized: false;
  automatedBettingAuthorized: false;
};

export type N2TrifectaLocalCaptureAuthorizationAudit = {
  status: "PASS" | "BLOCKED";
  blockers: string[];
  localServiceAuthorized: boolean;
  networkExecutionAuthorized: boolean;
  databaseWriteAuthorized: false;
  publicPublishAuthorized: false;
  automatedBettingAuthorized: false;
};

export type N2TrifectaLocalCaptureSelection = {
  selectionVersion: typeof N2_TRIFECTA_LOCAL_CAPTURE_SELECTION_VERSION;
  date: string;
  venueCode: string;
  sourcePlanDigest: string;
  selectedAt: string;
  raceCount: number;
  requestBudget: number;
};

export type N2TrifectaLocalCaptureReservation = {
  reservationVersion: typeof N2_TRIFECTA_LOCAL_CAPTURE_RESERVATION_VERSION;
  authorizationId: string;
  date: string;
  venueCode: string;
  raceIdentity: string;
  checkpointLabel: string;
  targetCaptureAt: string;
  reservationKey: string;
  reservedAt: string;
  networkRequestCeiling: 1;
};

export type N2TrifectaLocalCaptureTickReport = {
  reportVersion: typeof N2_TRIFECTA_LOCAL_CAPTURE_REPORT_VERSION;
  serviceVersion: typeof N2_TRIFECTA_LOCAL_CAPTURE_SERVICE_VERSION;
  status: "PASS" | "NO_CHANGE" | "BLOCKED";
  blockers: string[];
  startedAt: string;
  completedAt: string;
  now: string;
  dateJst: string | null;
  authorizationAudit: N2TrifectaLocalCaptureAuthorizationAudit;
  selectedVenueCode: string | null;
  selectedSourcePlanDigest: string | null;
  selectedRaceCount: number;
  dailyReservationCountBefore: number;
  dailyReservationCountAfter: number;
  dueEntryCount: number;
  selectedEntry: N2TrifectaOddsCheckpointEntry | null;
  singleEntryPlanDigest: string | null;
  ephemeralApprovalId: string | null;
  executorReport: N2TrifectaPrivateCaptureRunReport | null;
  selectionRelativePath: string | null;
  reservationRelativePath: string | null;
  reportRelativePath: string | null;
  latestStatusRelativePath: string;
  eventDigest: string;
  eventChanged: boolean;
  primaryDbMetadataUnchanged: boolean;
  databaseWriteCount: 0;
  primaryDbWriteCount: 0;
  sidecarWriteCount: 0;
  currentBuyChanged: false;
  lineChanged: false;
  publicPublished: false;
  automatedBettingChanged: false;
  productionApplyExecuted: false;
  outputDigest: string;
};

export type N2TrifectaLocalCaptureTickInput = {
  dataRoot: string;
  primaryDbPath: string;
  authorization: N2TrifectaLocalCaptureAuthorization;
  now: string;
  fetcher?: N2TrifectaPrivateFetcher;
};

type DbMeta = {
  bytes: number;
  modifiedMs: number;
  walBytes: number;
};

type VenueRow = {
  venue: string;
};

const AUTHORIZATION_ID_RE = /^AUTH-N2-TRI-LOCAL-[A-Za-z0-9._-]{8,96}$/;
const VENUE_RE = /^(0[1-9]|1\d|2[0-4])$/;
const EXPECTED_CHECKPOINTS = ["T-30", "T-20", "T-10", "T-5"] as const;

function parseInstant(value: string): number | null {
  try {
    return Date.parse(canonicalUtcTimestamp(value));
  } catch {
    return null;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function jstDate(value: string): string | null {
  const parsed = parseInstant(value);
  if (parsed == null) return null;
  return new Date(parsed + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

function dbMeta(path: string): DbMeta {
  if (!existsSync(path)) throw new Error("PRIMARY_DB_NOT_FOUND");
  const stat = statSync(path);
  const walPath = `${path}-wal`;
  return {
    bytes: stat.size,
    modifiedMs: stat.mtimeMs,
    walBytes: existsSync(walPath) ? statSync(walPath).size : 0,
  };
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

function exclusiveWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, content, "utf8");
  } finally {
    closeSync(fd);
  }
}

function readJsonFile<T>(path: string): T {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size <= 0 || stat.size > 2_000_000) {
    throw new Error("PRIVATE_JSON_SIZE_OR_TYPE_INVALID");
  }
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function openImmutable(path: string): DatabaseSync {
  const db = new DatabaseSync(`${pathToFileURL(path).href}?immutable=1`, {
    readOnly: true,
  } as never);
  db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000");
  return db;
}

function discoverVenueCodes(primaryDbPath: string, date: string): string[] {
  const db = openImmutable(primaryDbPath);
  try {
    const table = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='official_programs'",
    ).get();
    if (!table) throw new Error("OFFICIAL_PROGRAMS_TABLE_MISSING");
    const rows = db.prepare(`
      SELECT DISTINCT venue
      FROM official_programs
      WHERE date = ?
      ORDER BY venue
    `).all(date) as unknown as VenueRow[];
    return unique(
      rows
        .map((row) => officialVenueCode(row.venue))
        .filter((value): value is string => value != null && VENUE_RE.test(value)),
    );
  } finally {
    db.close();
  }
}

function isDue(entry: N2TrifectaOddsCheckpointEntry, nowMs: number): boolean {
  const targetMs = parseInstant(entry.targetCaptureAt);
  if (targetMs == null) return false;
  return nowMs >= targetMs - N2_TRIFECTA_PRIVATE_CAPTURE_EARLY_WINDOW_SECONDS * 1_000
    && nowMs <= targetMs + N2_TRIFECTA_PRIVATE_CAPTURE_LATE_WINDOW_SECONDS * 1_000;
}

function selectionRelativePath(date: string): string {
  return `data/private/trifecta-capture/selections/${date}.json`;
}

function budgetDirectoryRelativePath(date: string): string {
  return `data/private/trifecta-capture/reservations/${date}`;
}

function reportRelativePath(date: string | null, digest: string): string {
  return `data/private/trifecta-capture/reports/${date ?? "unknown"}/${digest}.json`;
}

function latestStatusRelativePath(): string {
  return "data/private/trifecta-capture/status/latest.json";
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "EEXIST";
}

function errorCode(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw.trim().replaceAll(/[^A-Za-z0-9_]+/gu, "_").toUpperCase();
  return normalized.slice(0, 120) || "UNKNOWN_ERROR";
}

function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function readLatestEventDigest(dataRoot: string): string | null {
  const path = resolveInside(dataRoot, latestStatusRelativePath());
  if (!existsSync(path)) return null;
  try {
    const latest = readJsonFile<{ eventDigest?: unknown }>(path);
    return typeof latest.eventDigest === "string" ? latest.eventDigest : null;
  } catch {
    return null;
  }
}

function validateSelection(
  selection: N2TrifectaLocalCaptureSelection,
  input: { date: string; plans: N2TrifectaOddsCheckpointPlan[] },
): void {
  if (selection.selectionVersion !== N2_TRIFECTA_LOCAL_CAPTURE_SELECTION_VERSION) {
    throw new Error("SELECTION_VERSION_MISMATCH");
  }
  if (selection.date !== input.date || !VENUE_RE.test(selection.venueCode)) {
    throw new Error("SELECTION_IDENTITY_INVALID");
  }
  const current = input.plans.find(
    (plan) => plan.entries[0]?.venueCode === selection.venueCode,
  );
  if (!current || current.status !== "READY_FOR_PRIVATE_REVIEW") {
    throw new Error("SELECTED_VENUE_PLAN_UNAVAILABLE");
  }
}

function loadOrCreateSelection(input: {
  dataRoot: string;
  date: string;
  now: string;
  plans: N2TrifectaOddsCheckpointPlan[];
}): {
  selection: N2TrifectaLocalCaptureSelection;
  relativePath: string;
  created: boolean;
} | null {
  const relativePath = selectionRelativePath(input.date);
  const path = resolveInside(input.dataRoot, relativePath);
  if (existsSync(path)) {
    const selection = readJsonFile<N2TrifectaLocalCaptureSelection>(path);
    validateSelection(selection, input);
    return { selection, relativePath, created: false };
  }

  const eligible = input.plans
    .filter((plan) => plan.status === "READY_FOR_PRIVATE_REVIEW" && plan.entries.length > 0)
    .sort((left, right) => {
      const raceCount = right.raceCount - left.raceCount;
      if (raceCount !== 0) return raceCount;
      const firstAt = String(left.entries[0]?.targetCaptureAt).localeCompare(
        String(right.entries[0]?.targetCaptureAt),
      );
      if (firstAt !== 0) return firstAt;
      return String(left.entries[0]?.venueCode).localeCompare(
        String(right.entries[0]?.venueCode),
      );
    });
  const selected = eligible[0];
  if (!selected?.entries[0]) return null;
  const selection: N2TrifectaLocalCaptureSelection = {
    selectionVersion: N2_TRIFECTA_LOCAL_CAPTURE_SELECTION_VERSION,
    date: input.date,
    venueCode: selected.entries[0].venueCode,
    sourcePlanDigest: selected.manifestDigest,
    selectedAt: input.now,
    raceCount: selected.raceCount,
    requestBudget: selected.requestBudget,
  };
  try {
    exclusiveWrite(path, `${JSON.stringify(selection, null, 2)}\n`);
    return { selection, relativePath, created: true };
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
    const existing = readJsonFile<N2TrifectaLocalCaptureSelection>(path);
    validateSelection(existing, input);
    return { selection: existing, relativePath, created: false };
  }
}

export function auditN2TrifectaLocalCaptureAuthorization(input: {
  authorization: N2TrifectaLocalCaptureAuthorization;
  now: string;
}): N2TrifectaLocalCaptureAuthorizationAudit {
  const blockers: string[] = [];
  const { authorization } = input;
  const now = parseInstant(input.now);
  const issuedAt = parseInstant(authorization.issuedAt);
  const expiresAt = parseInstant(authorization.expiresAt);
  if (authorization.authorizationVersion !== N2_TRIFECTA_LOCAL_CAPTURE_AUTHORIZATION_VERSION) {
    blockers.push("AUTHORIZATION_VERSION_MISMATCH");
  }
  if (!AUTHORIZATION_ID_RE.test(authorization.authorizationId)) {
    blockers.push("AUTHORIZATION_ID_INVALID");
  }
  if (now == null) blockers.push("NOW_INVALID");
  if (issuedAt == null) blockers.push("ISSUED_AT_INVALID");
  if (expiresAt == null) blockers.push("EXPIRES_AT_INVALID");
  if (issuedAt != null && expiresAt != null && issuedAt >= expiresAt) {
    blockers.push("AUTHORIZATION_INTERVAL_INVALID");
  }
  if (issuedAt != null && now != null && issuedAt > now) blockers.push("AUTHORIZATION_NOT_YET_VALID");
  if (expiresAt != null && now != null && expiresAt <= now) blockers.push("AUTHORIZATION_EXPIRED");
  if (authorization.stage !== "ONE_VENUE_REVIEW") blockers.push("STAGE_NOT_ALLOWED");
  if (authorization.maxRequestsPerDay !== 48) blockers.push("DAILY_REQUEST_LIMIT_MISMATCH");
  if (authorization.minInterRequestMs !== 10_000) blockers.push("REQUEST_INTERVAL_MISMATCH");
  if (JSON.stringify(authorization.checkpointLabels) !== JSON.stringify(EXPECTED_CHECKPOINTS)) {
    blockers.push("CHECKPOINT_POLICY_MISMATCH");
  }
  if (authorization.privateResearchOnly !== true) blockers.push("PRIVATE_RESEARCH_ONLY_REQUIRED");
  if (authorization.publicRedistributionAuthorized !== false) {
    blockers.push("PUBLIC_REDISTRIBUTION_MUST_BE_FALSE");
  }
  if (authorization.databaseWriteAuthorized !== false) blockers.push("DATABASE_WRITE_MUST_BE_FALSE");
  if (authorization.currentBuyConnectionAuthorized !== false) {
    blockers.push("CURRENT_BUY_CONNECTION_MUST_BE_FALSE");
  }
  if (authorization.lineConnectionAuthorized !== false) blockers.push("LINE_CONNECTION_MUST_BE_FALSE");
  if (authorization.automatedBettingAuthorized !== false) {
    blockers.push("AUTOMATED_BETTING_MUST_BE_FALSE");
  }
  const normalized = unique(blockers);
  return {
    status: normalized.length === 0 ? "PASS" : "BLOCKED",
    blockers: normalized,
    localServiceAuthorized: normalized.length === 0,
    networkExecutionAuthorized: normalized.length === 0,
    databaseWriteAuthorized: false,
    publicPublishAuthorized: false,
    automatedBettingAuthorized: false,
  };
}

export function buildN2TrifectaSingleEntryPlan(input: {
  sourcePlan: N2TrifectaOddsCheckpointPlan;
  entry: N2TrifectaOddsCheckpointEntry;
}): N2TrifectaOddsCheckpointPlan {
  const core = {
    planVersion: N2_TRIFECTA_ODDS_CHECKPOINT_COLLECTION_VERSION as typeof N2_TRIFECTA_ODDS_CHECKPOINT_COLLECTION_VERSION,
    stage: "ONE_VENUE_REVIEW" as const,
    raceCount: 1,
    venueDayCount: 1,
    checkpointCountPerRace: 4 as const,
    requestBudget: 1,
    concurrency: 1 as const,
    minInterRequestMs: 10_000 as const,
    immediateRetryAuthorized: false as const,
    blindFiveMinutePollingAuthorized: false as const,
    allSelectionsPerRequest: 120 as const,
    rawRetention: "APPEND_ONLY_LOCAL_PRIVATE" as const,
    databaseWriteAuthorized: false as const,
    currentBuyConnectionAuthorized: false as const,
    lineConnectionAuthorized: false as const,
    publicPublishAuthorized: false as const,
    entries: [input.entry],
    parentManifestDigest: input.sourcePlan.manifestDigest,
  };
  return {
    planVersion: core.planVersion,
    stage: core.stage,
    status: "READY_FOR_PRIVATE_REVIEW",
    blockers: [],
    raceCount: core.raceCount,
    venueDayCount: core.venueDayCount,
    checkpointCountPerRace: core.checkpointCountPerRace,
    requestBudget: core.requestBudget,
    concurrency: core.concurrency,
    minInterRequestMs: core.minInterRequestMs,
    immediateRetryAuthorized: core.immediateRetryAuthorized,
    blindFiveMinutePollingAuthorized: core.blindFiveMinutePollingAuthorized,
    allSelectionsPerRequest: core.allSelectionsPerRequest,
    rawRetention: core.rawRetention,
    databaseWriteAuthorized: core.databaseWriteAuthorized,
    currentBuyConnectionAuthorized: core.currentBuyConnectionAuthorized,
    lineConnectionAuthorized: core.lineConnectionAuthorized,
    publicPublishAuthorized: core.publicPublishAuthorized,
    entries: core.entries,
    manifestDigest: canonicalHash(core),
  };
}

export function buildN2TrifectaEphemeralApproval(input: {
  authorization: N2TrifectaLocalCaptureAuthorization;
  plan: N2TrifectaOddsCheckpointPlan;
  entry: N2TrifectaOddsCheckpointEntry;
}): N2TrifectaOddsCaptureApproval {
  const target = parseInstant(input.entry.targetCaptureAt);
  const authExpiry = parseInstant(input.authorization.expiresAt);
  if (target == null || authExpiry == null) throw new Error("EPHEMERAL_APPROVAL_TIME_INVALID");
  const expiresAt = new Date(Math.min(
    authExpiry,
    target + (N2_TRIFECTA_PRIVATE_CAPTURE_LATE_WINDOW_SECONDS + 30) * 1_000,
  )).toISOString();
  const label = input.entry.checkpointLabel.replace("-", "");
  return {
    approvalVersion: "n2-trifecta-odds-capture-approval-v1",
    approvalId: `APR-N2-TRI-ODDS-local-${input.entry.date.replaceAll("-", "")}-${input.entry.venueCode}-${String(input.entry.raceNo).padStart(2, "0")}-${label}`,
    scope: N2_TRIFECTA_ODDS_CAPTURE_APPROVAL_SCOPE,
    stage: "ONE_VENUE_REVIEW",
    manifestDigest: input.plan.manifestDigest,
    issuedAt: input.authorization.issuedAt,
    expiresAt,
    maxRequests: 1,
    privateResearchOnly: true,
    publicRedistributionAuthorized: false,
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
  };
}

function finalizeReport(
  core: Omit<N2TrifectaLocalCaptureTickReport, "outputDigest">,
): N2TrifectaLocalCaptureTickReport {
  return { ...core, outputDigest: canonicalHash(core) };
}

export async function runN2TrifectaLocalCaptureTick(
  input: N2TrifectaLocalCaptureTickInput,
): Promise<N2TrifectaLocalCaptureTickReport> {
  const startedAt = new Date().toISOString();
  const blockers: string[] = [];
  const authorizationAudit = auditN2TrifectaLocalCaptureAuthorization({
    authorization: input.authorization,
    now: input.now,
  });
  blockers.push(...authorizationAudit.blockers.map((blocker) => `AUTH_${blocker}`));
  const date = jstDate(input.now);
  const nowMs = parseInstant(input.now);
  if (date == null || nowMs == null) blockers.push("INVALID_NOW");

  let before: DbMeta | null = null;
  let primaryDbAccessed = false;
  let cachedSourcePlan: N2TrifectaOddsCheckpointPlan | null = null;
  if (blockers.length === 0 && date != null) {
    const cached = readN2TrifectaPrivateDailyPlanCache({
      dataRoot: input.dataRoot,
      expectedDate: date,
      now: input.now,
    });
    if (cached.status === "PASS" && cached.plan) {
      cachedSourcePlan = cached.plan;
    } else if (cached.status === "BLOCKED") {
      blockers.push(...cached.blockers.map((blocker) => `DAILY_PLAN_${blocker}`));
    } else if (cached.fallbackToPrimaryDbAllowed) {
      before = dbMeta(input.primaryDbPath);
      primaryDbAccessed = true;
      if (before.walBytes > 0) blockers.push("PRIMARY_DB_ACTIVE_WAL");
    }
  }

  let selectedVenueCode: string | null = null;
  let selectedSourcePlanDigest: string | null = null;
  let selectedRaceCount = 0;
  let dailyReservationCountBefore = 0;
  let dailyReservationCountAfter = 0;
  let dueEntryCount = 0;
  let selectedEntry: N2TrifectaOddsCheckpointEntry | null = null;
  let singleEntryPlanDigest: string | null = null;
  let ephemeralApprovalId: string | null = null;
  let executorReport: N2TrifectaPrivateCaptureRunReport | null = null;
  let selectionPath: string | null = null;
  let reservationPath: string | null = null;

  if (blockers.length === 0 && date != null && nowMs != null) {
    try {
      const plans = cachedSourcePlan
        ? [cachedSourcePlan]
        : discoverVenueCodes(input.primaryDbPath, date)
          .map((venueCode) => readN2TrifectaPrivateCapturePlan({
            primaryDbPath: input.primaryDbPath,
            date,
            venueCode,
          }))
          .filter((result) => result.status === "PASS")
          .map((result) => result.plan);
      const selected = loadOrCreateSelection({
        dataRoot: input.dataRoot,
        date,
        now: input.now,
        plans,
      });
      if (selected) {
        selectionPath = selected.relativePath;
        selectedVenueCode = selected.selection.venueCode;
        const sourcePlan = plans.find(
          (plan) => plan.entries[0]?.venueCode === selected.selection.venueCode,
        );
        if (!sourcePlan) {
          blockers.push("SELECTED_SOURCE_PLAN_MISSING");
        } else {
          selectedSourcePlanDigest = sourcePlan.manifestDigest;
          selectedRaceCount = sourcePlan.raceCount;
          const dueEntries = sourcePlan.entries
            .filter((entry) => isDue(entry, nowMs))
            .sort((left, right) => {
              const target = left.targetCaptureAt.localeCompare(right.targetCaptureAt);
              if (target !== 0) return target;
              return left.raceNo - right.raceNo;
            });
          dueEntryCount = dueEntries.length;

          const budgetRelative = budgetDirectoryRelativePath(date);
          const budgetPath = resolveInside(input.dataRoot, budgetRelative);
          mkdirSync(budgetPath, { recursive: true, mode: 0o700 });
          dailyReservationCountBefore = readdirSync(budgetPath)
            .filter((name) => name.endsWith(".json"))
            .length;
          dailyReservationCountAfter = dailyReservationCountBefore;

          let reservationCreated = false;
          for (const candidate of dueEntries) {
            const reservationKey = canonicalHash({
              authorizationId: input.authorization.authorizationId,
              raceIdentity: candidate.raceIdentity,
              checkpointLabel: candidate.checkpointLabel,
              targetCaptureAt: candidate.targetCaptureAt,
            });
            const candidateReservationPath = `${budgetRelative}/${reservationKey}.json`;
            const reservationAbsolute = resolveInside(input.dataRoot, candidateReservationPath);
            if (existsSync(reservationAbsolute)) continue;
            if (dailyReservationCountBefore >= input.authorization.maxRequestsPerDay) {
              blockers.push("DAILY_REQUEST_BUDGET_EXHAUSTED");
              break;
            }
            const reservation: N2TrifectaLocalCaptureReservation = {
              reservationVersion: N2_TRIFECTA_LOCAL_CAPTURE_RESERVATION_VERSION,
              authorizationId: input.authorization.authorizationId,
              date,
              venueCode: candidate.venueCode,
              raceIdentity: candidate.raceIdentity,
              checkpointLabel: candidate.checkpointLabel,
              targetCaptureAt: candidate.targetCaptureAt,
              reservationKey,
              reservedAt: input.now,
              networkRequestCeiling: 1,
            };
            try {
              exclusiveWrite(
                reservationAbsolute,
                `${JSON.stringify(reservation, null, 2)}\n`,
              );
              selectedEntry = candidate;
              reservationPath = candidateReservationPath;
              reservationCreated = true;
              dailyReservationCountAfter += 1;
              break;
            } catch (error) {
              if (!isAlreadyExistsError(error)) throw error;
            }
          }

          if (selectedEntry) {
            if (reservationCreated) {
              const singlePlan = buildN2TrifectaSingleEntryPlan({
                sourcePlan,
                entry: selectedEntry,
              });
              singleEntryPlanDigest = singlePlan.manifestDigest;
              const approval = buildN2TrifectaEphemeralApproval({
                authorization: input.authorization,
                plan: singlePlan,
                entry: selectedEntry,
              });
              ephemeralApprovalId = approval.approvalId;
              executorReport = await executeN2TrifectaPrivateCapture({
                plan: singlePlan,
                approval,
                rootDir: input.dataRoot,
                now: input.now,
                executionMode: "execute",
                fetcher: input.fetcher,
                sleep: async () => undefined,
              });
              blockers.push(
                ...executorReport.blockers.map((blocker) => `EXECUTOR_${blocker}`),
              );
            }
          }
        }
      }
    } catch (error) {
      blockers.push(`SERVICE_${errorCode(error)}`);
    }
  }

  let metadataUnchanged = true;
  if (primaryDbAccessed && before) {
    const after = dbMeta(input.primaryDbPath);
    metadataUnchanged = before.bytes === after.bytes
      && before.modifiedMs === after.modifiedMs
      && before.walBytes === after.walBytes;
    if (!metadataUnchanged) blockers.push("PRIMARY_DB_METADATA_CHANGED");
  }
  const normalized = unique(blockers);
  const status = normalized.length > 0
    ? "BLOCKED" as const
    : executorReport?.status === "PASS"
      ? "PASS" as const
      : "NO_CHANGE" as const;
  const eventDigest = canonicalHash({
    status,
    blockers: normalized,
    dateJst: date,
    authorizationStatus: authorizationAudit.status,
    selectedVenueCode,
    selectedRaceIdentity: selectedEntry?.raceIdentity ?? null,
    selectedCheckpointLabel: selectedEntry?.checkpointLabel ?? null,
    executorStatus: executorReport?.status ?? null,
    executorOutputDigest: executorReport?.outputDigest ?? null,
    primaryDbMetadataUnchanged: metadataUnchanged,
  });
  const previousEventDigest = readLatestEventDigest(input.dataRoot);
  const eventChanged = previousEventDigest !== eventDigest;
  const latestPath = latestStatusRelativePath();
  const eventReportPath = eventChanged || executorReport != null
    ? reportRelativePath(date, eventDigest)
    : null;
  const preliminary = {
    reportVersion: N2_TRIFECTA_LOCAL_CAPTURE_REPORT_VERSION,
    serviceVersion: N2_TRIFECTA_LOCAL_CAPTURE_SERVICE_VERSION,
    status,
    blockers: normalized,
    startedAt,
    completedAt: new Date().toISOString(),
    now: input.now,
    dateJst: date,
    authorizationAudit,
    selectedVenueCode,
    selectedSourcePlanDigest,
    selectedRaceCount,
    dailyReservationCountBefore,
    dailyReservationCountAfter,
    dueEntryCount,
    selectedEntry,
    singleEntryPlanDigest,
    ephemeralApprovalId,
    executorReport,
    selectionRelativePath: selectionPath,
    reservationRelativePath: reservationPath,
    reportRelativePath: eventReportPath,
    latestStatusRelativePath: latestPath,
    eventDigest,
    eventChanged,
    primaryDbMetadataUnchanged: metadataUnchanged,
    databaseWriteCount: 0 as const,
    primaryDbWriteCount: 0 as const,
    sidecarWriteCount: 0 as const,
    currentBuyChanged: false as const,
    lineChanged: false as const,
    publicPublished: false as const,
    automatedBettingChanged: false as const,
    productionApplyExecuted: false as const,
  };
  const final = finalizeReport(preliminary);
  if (eventReportPath) {
    try {
      exclusiveWrite(
        resolveInside(input.dataRoot, eventReportPath),
        `${JSON.stringify(final, null, 2)}\n`,
      );
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }
  }
  writeAtomic(
    resolveInside(input.dataRoot, latestPath),
    `${JSON.stringify({
      latestStatusVersion: "n2-trifecta-local-capture-latest-v1",
      eventDigest,
      checkedAt: input.now,
      report: final,
    }, null, 2)}\n`,
  );
  return final;
}
