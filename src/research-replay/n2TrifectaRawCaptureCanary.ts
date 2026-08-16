import { createHash } from "node:crypto";
import * as cheerio from "cheerio";

import {
  countUnavailableTrifectaSelections,
  countZeroTrifectaSelections,
  parseAllTrifectaOdds,
} from "../domain/oddsParser";
import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import { buildBoatRaceOfficialSourceUrl } from "./n2ExternalSourceCaptureContract";
import {
  auditN2TrifectaMarketSnapshot,
  type N2TrifectaMarketSnapshotCandidate,
  type N2TrifectaSnapshotAudit,
} from "./n2TrifectaMarketFoundation";

export const N2_TRIFECTA_RAW_CAPTURE_CANARY_VERSION =
  "n2-trifecta-raw-capture-canary-v1";
export const N2_TRIFECTA_RAW_PARSER_VERSION =
  "boatrace-official-odds3t-raw-review-v1";
export const N2_TRIFECTA_RAW_CAPTURE_APPROVAL_SCOPE =
  "N2_TRIFECTA_RAW_CAPTURE_PRIVATE_REVIEW_CANARY";

export const N2_TRIFECTA_SITE_POLICY_REVIEW = Object.freeze({
  reviewVersion: "boatrace-site-policy-review-v1",
  reviewedAt: "2026-08-06",
  sourcePolicyUrl: "https://www.boatrace.jp/owsp/sp/extra/policy.html",
  sourceInformationUrl: "https://www.boatrace.jp/owpc/pc/extra/about.html",
  status: "REVIEWED_RESTRICTIVE_PRIVATE_RESEARCH_BOUNDARY" as const,
  findings: Object.freeze([
    "content remains copyright-protected and no broad reuse right is granted",
    "private use is not treated as permission for publication or redistribution",
    "bulk transmission and access that interferes with site operation are prohibited",
    "site policy and page structure can change without notice",
    "odds availability must use the page-displayed odds update time",
  ]),
  privateResearchCandidate: true,
  highFrequencyAutomationAuthorized: false,
  publicReuseAuthorized: false,
  redistributionAuthorized: false,
  commercialReuseAuthorized: false,
  legalAdvice: false,
});

export const N2_TRIFECTA_RAW_CAPTURE_POLICY = Object.freeze({
  policyVersion: "n2-trifecta-raw-capture-policy-v1",
  venueDayLimit: 1,
  venueLimit: 1,
  maxRaces: 12,
  checkpointLabels: Object.freeze(["T-10"] as const),
  maxRequests: 12,
  maxAttemptsPerRequest: 1,
  concurrency: 1,
  minInterRequestMs: 10_000,
  requestWindowSeconds: 120,
  rawMaxBytes: 2_000_000,
  serviceBlackoutJst: Object.freeze({ start: "04:00", end: "04:30" }),
  rawRetention: "LOCAL_PRIVATE_REVIEW_ONLY" as const,
  networkExecutionAuthorized: false,
  rawPersistenceAuthorized: false,
  databaseWriteAuthorized: false,
  gitCommitRawAuthorized: false,
  publicPublishAuthorized: false,
  approvalAutoCreateAuthorized: false,
  currentBuyConnectionAuthorized: false,
  lineConnectionAuthorized: false,
  productionApplyAuthorized: false,
});

export type N2TrifectaRawCaptureRaceInput = {
  date: string;
  venueCode: string;
  raceNo: number;
  closeAt: string;
};

export type N2TrifectaRawCapturePlanEntry = {
  canonicalRaceId: string;
  observationRaceId: string;
  date: string;
  venueCode: string;
  raceNo: number;
  closeAt: string;
  sourceUrl: string;
  checkpointLabel: "T-10";
  targetCaptureAt: string;
  requestWindowStart: string;
  requestWindowEnd: string;
  decisionCutoff: string;
  maxAttempts: 1;
};

export type N2TrifectaRawCapturePlan = {
  planVersion: typeof N2_TRIFECTA_RAW_CAPTURE_CANARY_VERSION;
  status: "REVIEW_BUNDLE_READY_NOT_AUTHORIZED" | "BLOCKED";
  approvalScope: typeof N2_TRIFECTA_RAW_CAPTURE_APPROVAL_SCOPE;
  structuralBlockers: string[];
  authorizationBlockers: readonly [
    "SOURCE_SPECIFIC_APPROVAL_MISSING",
    "NETWORK_EXECUTION_NOT_AUTHORIZED",
    "RAW_PERSISTENCE_EXECUTOR_NOT_IMPLEMENTED",
  ];
  entries: N2TrifectaRawCapturePlanEntry[];
  raceCount: number;
  requestBudget: number;
  concurrency: 1;
  minInterRequestMs: number;
  networkExecutionAuthorized: false;
  rawPersistenceAuthorized: false;
  databaseWriteAuthorized: false;
  approvalCreated: false;
  productionApplyExecuted: false;
  manifestDigest: string;
};

export type DisplayedOddsUpdateTimeResult = {
  status: "PASS" | "MISSING" | "AMBIGUOUS" | "INVALID_RACE_DATE";
  displayedTimes: string[];
  availableAt: string | null;
};

export type N2TrifectaRawReviewEnvelope = {
  envelopeVersion: "n2-trifecta-raw-review-envelope-v1";
  status: "REVIEW_EVIDENCE_READY" | "BLOCKED";
  blockers: string[];
  entry: N2TrifectaRawCapturePlanEntry;
  response: {
    statusCode: number;
    contentType: string;
    fetchedAt: string;
    headers: Record<string, string>;
    rawByteLength: number;
    rawSha256: string;
  };
  sourceDisplayedUpdate: DisplayedOddsUpdateTimeResult;
  parserVersion: typeof N2_TRIFECTA_RAW_PARSER_VERSION;
  parsedSelectionCount: number;
  unavailableSelectionCount: number;
  zeroOddsPlaceholderCount: number;
  rawDocumentId: string | null;
  parseRunId: string | null;
  proposedObservationId: string | null;
  localRawRelativePath: string | null;
  snapshotCandidate: N2TrifectaMarketSnapshotCandidate | null;
  snapshotAudit: N2TrifectaSnapshotAudit | null;
  networkExecutionAuthorized: false;
  rawPersistenceAuthorized: false;
  databaseWriteAuthorized: false;
  gitCommitRawAuthorized: false;
  publicPublishAuthorized: false;
  currentBuyConnectionAuthorized: false;
  lineConnectionAuthorized: false;
  productionApplyExecuted: false;
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const VENUE_CODE_RE = /^(0[1-9]|1\d|2[0-4])$/;
const CLOSE_AT_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ALLOWED_RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-length",
  "content-type",
  "date",
  "etag",
  "last-modified",
]);

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isCanonicalCalendarDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function parseInstant(value: string): number | null {
  try {
    const canonical = canonicalUtcTimestamp(value);
    const parsed = Date.parse(canonical);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function compactDate(date: string): string {
  return date.replaceAll("-", "");
}

function jstInstant(date: string, time: string): string | null {
  if (!isCanonicalCalendarDate(date)) return null;
  const dateMatch = DATE_RE.exec(date);
  const timeMatch = CLOSE_AT_RE.exec(time);
  if (!dateMatch || !timeMatch) return null;
  const instant = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]) - 9,
    Number(timeMatch[2]),
    0,
    0,
  );
  const normalized = new Date(instant);
  if (!Number.isFinite(normalized.getTime())) return null;
  return normalized.toISOString();
}

function safeRaceIdentity(input: N2TrifectaRawCaptureRaceInput): {
  canonicalRaceId: string;
  observationRaceId: string;
} {
  const race = String(input.raceNo).padStart(2, "0");
  return {
    canonicalRaceId: `${compactDate(input.date)}-${input.venueCode}-R${race}`,
    observationRaceId: `${compactDate(input.date)}-${input.venueCode}-${race}`,
  };
}

function sanitizeHeaders(
  headers: Record<string, string | undefined> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const normalized = name.toLowerCase().trim();
    if (!ALLOWED_RESPONSE_HEADERS.has(normalized) || value == null) continue;
    result[normalized] = value.slice(0, 1_000);
  }
  return Object.fromEntries(
    Object.entries(result).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function entryFromRace(
  input: N2TrifectaRawCaptureRaceInput,
): N2TrifectaRawCapturePlanEntry | null {
  const decisionCutoff = jstInstant(input.date, input.closeAt);
  if (!decisionCutoff) return null;
  const cutoffMs = Date.parse(decisionCutoff);
  const targetMs = cutoffMs - 10 * 60_000;
  const windowMs = N2_TRIFECTA_RAW_CAPTURE_POLICY.requestWindowSeconds * 1_000;
  const identity = safeRaceIdentity(input);
  return {
    ...identity,
    date: input.date,
    venueCode: input.venueCode,
    raceNo: input.raceNo,
    closeAt: input.closeAt,
    sourceUrl: buildBoatRaceOfficialSourceUrl(
      "boatrace_official_trifecta_odds_html",
      {
        date: compactDate(input.date),
        venueCode: input.venueCode,
        raceNo: input.raceNo,
      },
    ),
    checkpointLabel: "T-10",
    targetCaptureAt: new Date(targetMs).toISOString(),
    requestWindowStart: new Date(targetMs - windowMs).toISOString(),
    requestWindowEnd: new Date(targetMs + windowMs).toISOString(),
    decisionCutoff,
    maxAttempts: 1,
  };
}

export function buildN2TrifectaRawCapturePlan(
  races: N2TrifectaRawCaptureRaceInput[],
): N2TrifectaRawCapturePlan {
  const structuralBlockers: string[] = [];
  if (races.length === 0) structuralBlockers.push("RACE_SELECTION_EMPTY");
  if (races.length > N2_TRIFECTA_RAW_CAPTURE_POLICY.maxRaces) {
    structuralBlockers.push("RACE_LIMIT_EXCEEDED");
  }

  const dateVenue = new Set<string>();
  const identities = new Set<string>();
  const built: N2TrifectaRawCapturePlanEntry[] = [];
  for (const race of races) {
    if (!isCanonicalCalendarDate(race.date)) structuralBlockers.push("INVALID_RACE_DATE");
    if (!VENUE_CODE_RE.test(race.venueCode)) {
      structuralBlockers.push("INVALID_VENUE_CODE");
    }
    if (!Number.isInteger(race.raceNo) || race.raceNo < 1 || race.raceNo > 12) {
      structuralBlockers.push("INVALID_RACE_NO");
    }
    if (!CLOSE_AT_RE.test(race.closeAt)) structuralBlockers.push("INVALID_CLOSE_AT");
    dateVenue.add(`${race.date}|${race.venueCode}`);
    const identity = `${race.date}|${race.venueCode}|${race.raceNo}`;
    if (identities.has(identity)) structuralBlockers.push("DUPLICATE_RACE_IDENTITY");
    identities.add(identity);
    try {
      const entry = entryFromRace(race);
      if (entry) built.push(entry);
    } catch {
      structuralBlockers.push("SOURCE_URL_BUILD_FAILED");
    }
  }
  if (dateVenue.size > 1) structuralBlockers.push("ONE_VENUE_DAY_ONLY");
  if (built.length > N2_TRIFECTA_RAW_CAPTURE_POLICY.maxRequests) {
    structuralBlockers.push("REQUEST_BUDGET_EXCEEDED");
  }

  const blockers = unique(structuralBlockers).sort();
  const entries = blockers.length === 0
    ? [...built].sort((left, right) => left.raceNo - right.raceNo)
    : [];
  const manifestCore = {
    planVersion: N2_TRIFECTA_RAW_CAPTURE_CANARY_VERSION,
    approvalScope: N2_TRIFECTA_RAW_CAPTURE_APPROVAL_SCOPE,
    policyVersion: N2_TRIFECTA_RAW_CAPTURE_POLICY.policyVersion,
    entries,
    raceCount: entries.length,
    requestBudget: entries.length,
    concurrency: N2_TRIFECTA_RAW_CAPTURE_POLICY.concurrency,
    minInterRequestMs: N2_TRIFECTA_RAW_CAPTURE_POLICY.minInterRequestMs,
    networkExecutionAuthorized: false as const,
    rawPersistenceAuthorized: false as const,
    databaseWriteAuthorized: false as const,
  };

  return {
    planVersion: N2_TRIFECTA_RAW_CAPTURE_CANARY_VERSION,
    status: blockers.length === 0
      ? "REVIEW_BUNDLE_READY_NOT_AUTHORIZED"
      : "BLOCKED",
    approvalScope: N2_TRIFECTA_RAW_CAPTURE_APPROVAL_SCOPE,
    structuralBlockers: blockers,
    authorizationBlockers: [
      "SOURCE_SPECIFIC_APPROVAL_MISSING",
      "NETWORK_EXECUTION_NOT_AUTHORIZED",
      "RAW_PERSISTENCE_EXECUTOR_NOT_IMPLEMENTED",
    ],
    entries,
    raceCount: entries.length,
    requestBudget: entries.length,
    concurrency: 1,
    minInterRequestMs: N2_TRIFECTA_RAW_CAPTURE_POLICY.minInterRequestMs,
    networkExecutionAuthorized: false,
    rawPersistenceAuthorized: false,
    databaseWriteAuthorized: false,
    approvalCreated: false,
    productionApplyExecuted: false,
    manifestDigest: canonicalHash(manifestCore),
  };
}

export function parseBoatRaceDisplayedOddsUpdateTime(
  html: string,
  raceDate: string,
): DisplayedOddsUpdateTimeResult {
  if (!isCanonicalCalendarDate(raceDate)) {
    return {
      status: "INVALID_RACE_DATE",
      displayedTimes: [],
      availableAt: null,
    };
  }
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  const text = $.root().text().replace(/[\s　]+/gu, " ");
  const matches = [...text.matchAll(
    /オッズ更新(?:時間|時刻)\s*[:：]?\s*([01]?\d|2[0-3])[:：]([0-5]\d)/gu,
  )].map((match) => `${match[1].padStart(2, "0")}:${match[2]}`);
  const displayedTimes = unique(matches).sort();
  if (displayedTimes.length === 0) {
    return { status: "MISSING", displayedTimes, availableAt: null };
  }
  if (displayedTimes.length > 1) {
    return { status: "AMBIGUOUS", displayedTimes, availableAt: null };
  }
  return {
    status: "PASS",
    displayedTimes,
    availableAt: jstInstant(raceDate, displayedTimes[0]),
  };
}

export function buildN2TrifectaRawReviewEnvelope(input: {
  entry: N2TrifectaRawCapturePlanEntry;
  sourceUrl: string;
  statusCode: number;
  contentType: string;
  fetchedAt: string;
  rawBytes: Uint8Array;
  responseHeaders?: Record<string, string | undefined>;
}): N2TrifectaRawReviewEnvelope {
  const blockers: string[] = [];
  if (input.sourceUrl !== input.entry.sourceUrl) {
    blockers.push("ENTRY_SOURCE_URL_MISMATCH");
  }
  if (input.statusCode !== 200) blockers.push("HTTP_STATUS_NOT_200");
  if (!input.contentType.toLowerCase().includes("text/html")) {
    blockers.push("CONTENT_TYPE_NOT_HTML");
  }
  if (input.rawBytes.byteLength === 0) blockers.push("RAW_BYTES_EMPTY");
  if (input.rawBytes.byteLength > N2_TRIFECTA_RAW_CAPTURE_POLICY.rawMaxBytes) {
    blockers.push("RAW_BYTES_TOO_LARGE");
  }

  const fetchedAtMs = parseInstant(input.fetchedAt);
  const requestWindowStartMs = parseInstant(input.entry.requestWindowStart);
  const requestWindowEndMs = parseInstant(input.entry.requestWindowEnd);
  const decisionCutoffMs = parseInstant(input.entry.decisionCutoff);
  if (fetchedAtMs == null) blockers.push("FETCHED_AT_INVALID");
  if (
    fetchedAtMs != null &&
    requestWindowStartMs != null &&
    fetchedAtMs < requestWindowStartMs
  ) {
    blockers.push("FETCH_BEFORE_REQUEST_WINDOW");
  }
  if (
    fetchedAtMs != null &&
    requestWindowEndMs != null &&
    fetchedAtMs > requestWindowEndMs
  ) {
    blockers.push("FETCH_AFTER_REQUEST_WINDOW");
  }
  if (
    fetchedAtMs != null &&
    decisionCutoffMs != null &&
    fetchedAtMs > decisionCutoffMs
  ) {
    blockers.push("FETCH_AFTER_DECISION_CUTOFF");
  }

  let html = "";
  try {
    html = Buffer.from(input.rawBytes).toString("utf8");
  } catch {
    blockers.push("RAW_UTF8_DECODE_FAILED");
  }
  const normalizedText = html.replace(/[\s　]+/gu, " ");
  if (normalizedText.includes("締切時オッズ")) {
    blockers.push("CLOSING_ODDS_NOT_PREDECISION");
  }

  const sourceDisplayedUpdate = parseBoatRaceDisplayedOddsUpdateTime(
    html,
    input.entry.date,
  );
  if (sourceDisplayedUpdate.status === "MISSING") {
    blockers.push("DISPLAYED_ODDS_UPDATE_TIME_MISSING");
  } else if (sourceDisplayedUpdate.status === "AMBIGUOUS") {
    blockers.push("DISPLAYED_ODDS_UPDATE_TIME_AMBIGUOUS");
  } else if (sourceDisplayedUpdate.status !== "PASS") {
    blockers.push("DISPLAYED_ODDS_UPDATE_TIME_INVALID");
  }
  const availableAtMs = sourceDisplayedUpdate.availableAt
    ? parseInstant(sourceDisplayedUpdate.availableAt)
    : null;
  if (availableAtMs != null && fetchedAtMs != null && availableAtMs > fetchedAtMs) {
    blockers.push("DISPLAYED_UPDATE_AFTER_FETCH");
  }
  if (
    availableAtMs != null &&
    decisionCutoffMs != null &&
    availableAtMs > decisionCutoffMs
  ) {
    blockers.push("DISPLAYED_UPDATE_AFTER_DECISION_CUTOFF");
  }

  const parsedOdds = parseAllTrifectaOdds(html);
  const unavailableSelectionCount = countUnavailableTrifectaSelections(html);
  const zeroOddsPlaceholderCount = countZeroTrifectaSelections(html);
  if (parsedOdds.size !== 120) blockers.push("PARSED_SELECTION_COUNT_NOT_120");
  if (zeroOddsPlaceholderCount > 0) blockers.push("ZERO_ODDS_PLACEHOLDERS_PRESENT");
  if (unavailableSelectionCount !== 0) {
    blockers.push("UNAVAILABLE_SELECTIONS_PRESENT");
  }

  const rawSha256 = sha256(input.rawBytes);
  const rawDocumentId = blockers.includes("RAW_BYTES_EMPTY")
    ? null
    : `raw-${canonicalHash({
        sourceUrl: input.sourceUrl,
        rawSha256,
        fetchedAt: input.fetchedAt,
      }).slice(0, 40)}`;
  const parseRunId = rawDocumentId
    ? `parse-${canonicalHash({
        rawDocumentId,
        parserVersion: N2_TRIFECTA_RAW_PARSER_VERSION,
      }).slice(0, 40)}`
    : null;
  const proposedObservationId = parseRunId
    ? `obs-${canonicalHash({
        canonicalRaceId: input.entry.canonicalRaceId,
        checkpointLabel: input.entry.checkpointLabel,
        rawDocumentId,
        parseRunId,
      }).slice(0, 40)}`
    : null;

  let snapshotCandidate: N2TrifectaMarketSnapshotCandidate | null = null;
  let snapshotAudit: N2TrifectaSnapshotAudit | null = null;
  if (
    sourceDisplayedUpdate.availableAt &&
    rawDocumentId &&
    parseRunId &&
    proposedObservationId
  ) {
    snapshotCandidate = {
      raceId: input.entry.observationRaceId,
      checkpointLabel: input.entry.checkpointLabel,
      capturedAt: input.fetchedAt,
      availableAt: sourceDisplayedUpdate.availableAt,
      decisionCutoff: input.entry.decisionCutoff,
      rawDocumentId,
      rawPayloadDigest: rawSha256,
      parseRunId,
      sourceUrl: input.sourceUrl,
      proposedObservationId,
      odds: [...parsedOdds.entries()]
        .map(([selection, odds]) => ({
          selection: selection.replaceAll("-", ""),
          odds,
        }))
        .sort((left, right) => left.selection.localeCompare(right.selection)),
    };
    snapshotAudit = auditN2TrifectaMarketSnapshot(snapshotCandidate);
    for (const blocker of snapshotAudit.blockers) {
      blockers.push(`SNAPSHOT_${blocker}`);
    }
  } else {
    blockers.push("SNAPSHOT_CANDIDATE_UNRESOLVED");
  }

  const uniqueBlockers = unique(blockers).sort();
  const localRawRelativePath = rawDocumentId
    ? `data/raw/research-review/n2-trifecta/${input.entry.date}/${input.entry.venueCode}/${String(input.entry.raceNo).padStart(2, "0")}-${input.entry.checkpointLabel}-${rawSha256.slice(0, 16)}.html`
    : null;

  return {
    envelopeVersion: "n2-trifecta-raw-review-envelope-v1",
    status: uniqueBlockers.length === 0
      ? "REVIEW_EVIDENCE_READY"
      : "BLOCKED",
    blockers: uniqueBlockers,
    entry: input.entry,
    response: {
      statusCode: input.statusCode,
      contentType: input.contentType,
      fetchedAt: input.fetchedAt,
      headers: sanitizeHeaders(input.responseHeaders),
      rawByteLength: input.rawBytes.byteLength,
      rawSha256,
    },
    sourceDisplayedUpdate,
    parserVersion: N2_TRIFECTA_RAW_PARSER_VERSION,
    parsedSelectionCount: parsedOdds.size,
    unavailableSelectionCount,
    zeroOddsPlaceholderCount,
    rawDocumentId,
    parseRunId,
    proposedObservationId,
    localRawRelativePath,
    snapshotCandidate,
    snapshotAudit,
    networkExecutionAuthorized: false,
    rawPersistenceAuthorized: false,
    databaseWriteAuthorized: false,
    gitCommitRawAuthorized: false,
    publicPublishAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    productionApplyExecuted: false,
  };
}
