import { canonicalHash } from "./canonical";
import { buildBoatRaceOfficialSourceUrl } from "./n2ExternalSourceCaptureContract";

export const N2_TRIFECTA_ODDS_CHECKPOINT_COLLECTION_VERSION =
  "n2-trifecta-odds-checkpoint-collection-v1";
export const N2_TRIFECTA_ODDS_CAPTURE_APPROVAL_SCOPE =
  "N2_TRIFECTA_ODDS_PRIVATE_CHECKPOINT_CAPTURE";

export const N2_TRIFECTA_ODDS_BASE_CHECKPOINTS = Object.freeze([
  30,
  20,
  10,
  5,
] as const);

export type N2TrifectaOddsCheckpointMinute =
  (typeof N2_TRIFECTA_ODDS_BASE_CHECKPOINTS)[number];
export type N2TrifectaOddsCheckpointLabel =
  `T-${N2TrifectaOddsCheckpointMinute}`;
export type N2TrifectaOddsCollectionStage =
  | "ONE_VENUE_REVIEW"
  | "ALL_ACTIVE_VENUES_REVIEW";

export type N2TrifectaOddsRaceInput = {
  date: string;
  venueCode: string;
  raceNo: number;
  closeAt: string;
};

export type N2TrifectaOddsCheckpointEntry = {
  raceIdentity: string;
  date: string;
  venueCode: string;
  raceNo: number;
  closeAt: string;
  checkpointMinutes: N2TrifectaOddsCheckpointMinute;
  checkpointLabel: N2TrifectaOddsCheckpointLabel;
  targetCaptureAt: string;
  decisionCutoff: string;
  sourceUrl: string;
  maxAttempts: 1;
};

export type N2TrifectaOddsCheckpointPlan = {
  planVersion: typeof N2_TRIFECTA_ODDS_CHECKPOINT_COLLECTION_VERSION;
  stage: N2TrifectaOddsCollectionStage;
  status: "READY_FOR_PRIVATE_REVIEW" | "BLOCKED";
  blockers: string[];
  raceCount: number;
  venueDayCount: number;
  checkpointCountPerRace: 4;
  requestBudget: number;
  concurrency: 1;
  minInterRequestMs: 10_000;
  immediateRetryAuthorized: false;
  blindFiveMinutePollingAuthorized: false;
  allSelectionsPerRequest: 120;
  rawRetention: "APPEND_ONLY_LOCAL_PRIVATE";
  databaseWriteAuthorized: false;
  currentBuyConnectionAuthorized: false;
  lineConnectionAuthorized: false;
  publicPublishAuthorized: false;
  entries: N2TrifectaOddsCheckpointEntry[];
  manifestDigest: string;
};

export type N2TrifectaOddsCaptureApproval = {
  approvalVersion: "n2-trifecta-odds-capture-approval-v1";
  approvalId: string;
  scope: typeof N2_TRIFECTA_ODDS_CAPTURE_APPROVAL_SCOPE;
  stage: N2TrifectaOddsCollectionStage;
  manifestDigest: string;
  issuedAt: string;
  expiresAt: string;
  maxRequests: number;
  privateResearchOnly: true;
  publicRedistributionAuthorized: false;
  databaseWriteAuthorized: false;
  currentBuyConnectionAuthorized: false;
  lineConnectionAuthorized: false;
};

export type N2TrifectaOddsCaptureApprovalAudit = {
  status: "PASS" | "BLOCKED";
  blockers: string[];
  networkExecutionAuthorized: boolean;
  rawPersistenceAuthorized: boolean;
  databaseWriteAuthorized: false;
  currentBuyConnectionAuthorized: false;
  lineConnectionAuthorized: false;
  publicPublishAuthorized: false;
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const VENUE_RE = /^(0[1-9]|1\d|2[0-4])$/;
const CLOSE_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const APPROVAL_ID_RE = /^APR-N2-TRI-ODDS-[A-Za-z0-9._-]{8,96}$/;

const STAGE_LIMITS: Readonly<
  Record<
    N2TrifectaOddsCollectionStage,
    { maxVenueDays: number; maxRaces: number; maxRequests: number }
  >
> = Object.freeze({
  ONE_VENUE_REVIEW: Object.freeze({
    maxVenueDays: 1,
    maxRaces: 12,
    maxRequests: 48,
  }),
  ALL_ACTIVE_VENUES_REVIEW: Object.freeze({
    maxVenueDays: 12,
    maxRaces: 144,
    maxRequests: 576,
  }),
});

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function parseInstant(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compactDate(date: string): string {
  return date.replaceAll("-", "");
}

function closeAtUtc(date: string, closeAt: string): string | null {
  const dateMatch = DATE_RE.exec(date);
  const closeMatch = CLOSE_RE.exec(closeAt);
  if (!dateMatch || !closeMatch) return null;
  const utcMs = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(closeMatch[1]) - 9,
    Number(closeMatch[2]),
    0,
    0,
  );
  const value = new Date(utcMs);
  return Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

function buildRaceIdentity(race: N2TrifectaOddsRaceInput): string {
  return `${compactDate(race.date)}-${race.venueCode}-${String(race.raceNo).padStart(2, "0")}`;
}

function entryFor(
  race: N2TrifectaOddsRaceInput,
  checkpointMinutes: N2TrifectaOddsCheckpointMinute,
): N2TrifectaOddsCheckpointEntry | null {
  const decisionCutoff = closeAtUtc(race.date, race.closeAt);
  if (!decisionCutoff) return null;
  const targetMs = Date.parse(decisionCutoff) - checkpointMinutes * 60_000;
  return {
    raceIdentity: buildRaceIdentity(race),
    date: race.date,
    venueCode: race.venueCode,
    raceNo: race.raceNo,
    closeAt: race.closeAt,
    checkpointMinutes,
    checkpointLabel: `T-${checkpointMinutes}`,
    targetCaptureAt: new Date(targetMs).toISOString(),
    decisionCutoff,
    sourceUrl: buildBoatRaceOfficialSourceUrl(
      "boatrace_official_trifecta_odds_html",
      {
        date: compactDate(race.date),
        venueCode: race.venueCode,
        raceNo: race.raceNo,
      },
    ),
    maxAttempts: 1,
  };
}

export function buildN2TrifectaOddsCheckpointPlan(input: {
  stage: N2TrifectaOddsCollectionStage;
  races: N2TrifectaOddsRaceInput[];
}): N2TrifectaOddsCheckpointPlan {
  const limits = STAGE_LIMITS[input.stage];
  const blockers: string[] = [];
  if (!limits) blockers.push("UNKNOWN_STAGE");
  if (input.races.length === 0) blockers.push("RACE_SELECTION_EMPTY");
  if (input.races.length > limits.maxRaces) blockers.push("RACE_LIMIT_EXCEEDED");

  const venueDays = new Set<string>();
  const raceIdentities = new Set<string>();
  const entries: N2TrifectaOddsCheckpointEntry[] = [];

  for (const race of input.races) {
    if (!DATE_RE.test(race.date)) blockers.push("INVALID_RACE_DATE");
    if (!VENUE_RE.test(race.venueCode)) blockers.push("INVALID_VENUE_CODE");
    if (!Number.isInteger(race.raceNo) || race.raceNo < 1 || race.raceNo > 12) {
      blockers.push("INVALID_RACE_NO");
    }
    if (!CLOSE_RE.test(race.closeAt)) blockers.push("INVALID_CLOSE_AT");

    const venueDay = `${race.date}|${race.venueCode}`;
    venueDays.add(venueDay);
    const raceIdentity = `${venueDay}|${race.raceNo}`;
    if (raceIdentities.has(raceIdentity)) blockers.push("DUPLICATE_RACE_IDENTITY");
    raceIdentities.add(raceIdentity);

    for (const checkpoint of N2_TRIFECTA_ODDS_BASE_CHECKPOINTS) {
      try {
        const entry = entryFor(race, checkpoint);
        if (entry) entries.push(entry);
        else blockers.push("CHECKPOINT_TIME_UNRESOLVED");
      } catch {
        blockers.push("SOURCE_URL_BUILD_FAILED");
      }
    }
  }

  if (venueDays.size > limits.maxVenueDays) blockers.push("VENUE_DAY_LIMIT_EXCEEDED");
  if (entries.length > limits.maxRequests) blockers.push("REQUEST_BUDGET_EXCEEDED");

  const normalizedBlockers = unique(blockers);
  const sortedEntries = normalizedBlockers.length === 0
    ? entries.sort((left, right) => {
        const at = left.targetCaptureAt.localeCompare(right.targetCaptureAt);
        if (at !== 0) return at;
        const venue = left.venueCode.localeCompare(right.venueCode);
        if (venue !== 0) return venue;
        return left.raceNo - right.raceNo;
      })
    : [];

  const core = {
    planVersion: N2_TRIFECTA_ODDS_CHECKPOINT_COLLECTION_VERSION,
    stage: input.stage,
    raceCount: normalizedBlockers.length === 0 ? input.races.length : 0,
    venueDayCount: normalizedBlockers.length === 0 ? venueDays.size : 0,
    checkpointCountPerRace: 4 as const,
    requestBudget: sortedEntries.length,
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
    entries: sortedEntries,
  };

  return {
    ...core,
    status: normalizedBlockers.length === 0
      ? "READY_FOR_PRIVATE_REVIEW"
      : "BLOCKED",
    blockers: normalizedBlockers,
    manifestDigest: canonicalHash(core),
  };
}

export function buildN2TrifectaRawRelativePath(input: {
  entry: N2TrifectaOddsCheckpointEntry;
  fetchedAt: string;
  rawSha256: string;
}): string {
  const fetchedAt = parseInstant(input.fetchedAt);
  if (fetchedAt == null) throw new Error("INVALID_FETCHED_AT");
  if (!SHA256_RE.test(input.rawSha256)) throw new Error("INVALID_RAW_SHA256");
  const timestamp = new Date(fetchedAt).toISOString().replaceAll(":", "-");
  return [
    "data",
    "raw",
    "research",
    "trifecta-market",
    input.entry.date,
    input.entry.venueCode,
    String(input.entry.raceNo).padStart(2, "0"),
    input.entry.checkpointLabel,
    `${timestamp}-${input.rawSha256}.html`,
  ].join("/");
}

export function auditN2TrifectaOddsCaptureApproval(input: {
  plan: N2TrifectaOddsCheckpointPlan;
  approval: N2TrifectaOddsCaptureApproval | null;
  now: string;
}): N2TrifectaOddsCaptureApprovalAudit {
  const blockers: string[] = [];
  const now = parseInstant(input.now);
  if (now == null) blockers.push("INVALID_AUDIT_TIME");
  if (input.plan.status !== "READY_FOR_PRIVATE_REVIEW") {
    blockers.push("PLAN_NOT_REVIEW_READY");
  }

  const approval = input.approval;
  if (!approval) {
    blockers.push("SOURCE_SPECIFIC_APPROVAL_MISSING");
  } else {
    if (approval.approvalVersion !== "n2-trifecta-odds-capture-approval-v1") {
      blockers.push("APPROVAL_VERSION_MISMATCH");
    }
    if (!APPROVAL_ID_RE.test(approval.approvalId)) blockers.push("APPROVAL_ID_INVALID");
    if (approval.scope !== N2_TRIFECTA_ODDS_CAPTURE_APPROVAL_SCOPE) {
      blockers.push("APPROVAL_SCOPE_MISMATCH");
    }
    if (approval.stage !== input.plan.stage) blockers.push("APPROVAL_STAGE_MISMATCH");
    if (approval.manifestDigest !== input.plan.manifestDigest) {
      blockers.push("APPROVAL_MANIFEST_MISMATCH");
    }
    if (approval.maxRequests !== input.plan.requestBudget) {
      blockers.push("APPROVAL_REQUEST_BUDGET_MISMATCH");
    }
    const issuedAt = parseInstant(approval.issuedAt);
    const expiresAt = parseInstant(approval.expiresAt);
    if (issuedAt == null) blockers.push("APPROVAL_ISSUED_AT_INVALID");
    if (expiresAt == null) blockers.push("APPROVAL_EXPIRES_AT_INVALID");
    if (issuedAt != null && expiresAt != null && issuedAt >= expiresAt) {
      blockers.push("APPROVAL_INTERVAL_INVALID");
    }
    if (issuedAt != null && now != null && issuedAt > now) blockers.push("APPROVAL_NOT_YET_VALID");
    if (expiresAt != null && now != null && expiresAt <= now) blockers.push("APPROVAL_EXPIRED");
    if (approval.privateResearchOnly !== true) blockers.push("PRIVATE_RESEARCH_ONLY_REQUIRED");
    if (approval.publicRedistributionAuthorized !== false) {
      blockers.push("PUBLIC_REDISTRIBUTION_MUST_BE_FALSE");
    }
    if (approval.databaseWriteAuthorized !== false) {
      blockers.push("DATABASE_WRITE_MUST_BE_FALSE");
    }
    if (approval.currentBuyConnectionAuthorized !== false) {
      blockers.push("CURRENT_BUY_CONNECTION_MUST_BE_FALSE");
    }
    if (approval.lineConnectionAuthorized !== false) {
      blockers.push("LINE_CONNECTION_MUST_BE_FALSE");
    }
  }

  const normalized = unique(blockers);
  return {
    status: normalized.length === 0 ? "PASS" : "BLOCKED",
    blockers: normalized,
    networkExecutionAuthorized: normalized.length === 0,
    rawPersistenceAuthorized: normalized.length === 0,
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    publicPublishAuthorized: false,
  };
}

export function estimateBlindFiveMinutePollingRequests(input: {
  raceCount: number;
  pollingWindowMinutes: number;
}): number {
  if (!Number.isSafeInteger(input.raceCount) || input.raceCount < 0) {
    throw new Error("raceCount must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(input.pollingWindowMinutes) || input.pollingWindowMinutes < 0) {
    throw new Error("pollingWindowMinutes must be a non-negative safe integer");
  }
  return input.raceCount * (Math.floor(input.pollingWindowMinutes / 5) + 1);
}
