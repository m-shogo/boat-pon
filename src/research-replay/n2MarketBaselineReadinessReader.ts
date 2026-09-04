import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { readCurrentlyValidSourceDuplicateObservationIds } from "./n1SourceDuplicateResolutionValidation";
import { settlementCandidateSemanticHashValid } from "./n1SettlementCandidateSemanticHash";
import { readN2T5DecisionCutoffMetadata } from "./n2T5DecisionCutoffMetadata";
import { parseSettlementSelection } from "./settlement";

export const N2_MARKET_BASELINE_READINESS_READER_VERSION =
  "n2-market-baseline-readiness-reader-v1" as const;

export type N2MarketBaselineReadinessRead = {
  readerVersion: typeof N2_MARKET_BASELINE_READINESS_READER_VERSION;
  acceptedT5RaceKeys: string[];
  settledRaceKeys: string[];
  integrityBlockedRaceKeys: string[];
  sourceBlockers: string[];
  acceptedMarkerCount: number;
  invalidAcceptedMarkerCount: number;
  settlementEligibleRaceCount: number;
  settlementIneligibleRaceCount: number;
  databaseReadCount: 0 | 1;
  databaseWriteCount: 0;
  rawOddsValuesRead: false;
};

type AcceptedMarker = {
  markerVersion?: unknown;
  manifestDigest?: unknown;
  checkpointKey?: unknown;
  raceIdentity?: unknown;
  checkpointLabel?: unknown;
  rawDocumentId?: unknown;
  rawSha256?: unknown;
  rawRelativePath?: unknown;
  envelopeRelativePath?: unknown;
  acceptedAt?: unknown;
  databaseWriteAuthorized?: unknown;
  productionApplyExecuted?: unknown;
};

type SettlementRow = {
  raceKey: string;
  candidateId: string;
  observationId: string;
  candidateParseRunId: string;
  candidateRawDocumentId: string;
  observationRaceKey: string | null;
  observationType: string | null;
  observationPayloadType: string | null;
  observationParseRunId: string | null;
  observationRawDocumentId: string | null;
  parseRunRawDocumentId: string | null;
  parseRunStatus: string | null;
  rawIntegrityStatus: string | null;
  rawSecurityScanStatus: string | null;
  rawParserReplayEligible: number | null;
  settlementStatus: string;
  resultKind: string;
  resolutionStatus: string;
  payoutCount: number;
  specialPayoutCount: number;
  payoutBetMismatchCount: number;
  payoutSelectionInvalidCount: number;
  payoutSelectionRaw: string | null;
  payoutSelectionNormalized: string | null;
  payoutSelectionCanonical: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const VENUE_RE = /^(0[1-9]|1\d|2[0-4])$/u;
const RACE_DIR_RE = /^(0[1-9]|1[0-2])$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const REUSABLE_PARSE_STATUSES = new Set(["success", "warning"]);
const MAX_DATE_DIRS = 366;
const MAX_MARKER_BYTES = 128 * 1024;
const MAX_EVIDENCE_BYTES = 2_000_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function isValidCalendarDateDirectory(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function resolveInside(rootDir: string, relativePath: string): string {
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new Error("UNSAFE_PRIVATE_RELATIVE_PATH");
  }
  const root = resolve(rootDir);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("PRIVATE_PATH_ESCAPES_ROOT");
  }
  return target;
}

function resolveInsideExpectedDirectory(
  rootDir: string,
  relativePath: string,
  expectedRelativeDirectory: string,
): string | null {
  const target = resolveInside(rootDir, relativePath);
  const expectedDirectory = resolve(rootDir, expectedRelativeDirectory);
  return target.startsWith(`${expectedDirectory}${sep}`) ? target : null;
}

function verifyExistingDirectoryAncestors(rootDir: string, relativeDir: string): boolean {
  let current = resolve(rootDir);
  for (const component of relativeDir.split("/")) {
    if (!component || component === ".") continue;
    current = resolve(current, component);
    if (!existsSync(current)) return false;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("PRIVATE_DIRECTORY_TYPE_INVALID");
    }
  }
  return true;
}

function safeDirectoryNames(rootDir: string, relativeDir: string): string[] {
  if (!verifyExistingDirectoryAncestors(rootDir, relativeDir)) return [];
  const path = resolveInside(rootDir, relativeDir);
  return readdirSync(path).sort();
}

function regularBounded(path: string, maxBytes: number): boolean {
  if (!existsSync(path)) return false;
  const lstat = lstatSync(path);
  if (lstat.isSymbolicLink() || !lstat.isFile()) return false;
  const stat = statSync(path);
  return stat.nlink === 1 && stat.size > 0 && stat.size <= maxBytes;
}

function parseIso(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(value) || !/(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return false;
  const calendar = /^(\d{4})-(\d{2})-(\d{2})T/u.exec(value);
  if (calendar === null) return false;
  const year = Number(calendar[1]);
  const month = Number(calendar[2]);
  const day = Number(calendar[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) return false;
  const clock = /T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?/u.exec(value);
  if (clock === null) return false;
  if (Number(clock[1]) > 23 || Number(clock[2]) > 59 || Number(clock[3] ?? "0") > 59) return false;
  const offset = /([+-])(\d{2}):(\d{2})$/u.exec(value);
  if (offset !== null && (Number(offset[2]) > 23 || Number(offset[3]) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

function timestampWithinRaceDateJst(date: string, value: unknown): boolean {
  if (!parseIso(value) || typeof value !== "string" || !isValidCalendarDateDirectory(date)) return false;
  const instant = Date.parse(value);
  const start = Date.parse(`${date}T00:00:00+09:00`);
  return Number.isFinite(instant) && instant >= start && instant < start + DAY_MS;
}

function validateAcceptedMarker(input: {
  dataRoot: string;
  date: string;
  venue: string;
  raceDir: string;
}): { valid: boolean; raceKey: string; blockers: string[] } {
  const raceNo = Number(input.raceDir);
  const raceIdentity = `${input.date.replaceAll("-", "")}-${input.venue}-${input.raceDir}`;
  const raceKey = `${input.date}:${input.venue}:R${raceNo}`;
  const directory = [
    "data",
    "raw",
    "research",
    "trifecta-market",
    input.date,
    input.venue,
    input.raceDir,
    "T-5",
  ].join("/");
  try {
    if (!verifyExistingDirectoryAncestors(input.dataRoot, directory)) {
      return { valid: false, raceKey, blockers: [] };
    }
  } catch {
    return { valid: false, raceKey, blockers: ["ACCEPTED_MARKER_DIRECTORY_INVALID"] };
  }
  const markerRelativePath = `${directory}/accepted.json`;
  const markerPath = resolveInside(input.dataRoot, markerRelativePath);
  if (!existsSync(markerPath)) return { valid: false, raceKey, blockers: [] };
  if (!regularBounded(markerPath, MAX_MARKER_BYTES)) {
    return { valid: false, raceKey, blockers: ["ACCEPTED_MARKER_FILE_INVALID"] };
  }

  let marker: AcceptedMarker;
  try {
    marker = JSON.parse(readFileSync(markerPath, "utf8")) as AcceptedMarker;
  } catch {
    return { valid: false, raceKey, blockers: ["ACCEPTED_MARKER_JSON_INVALID"] };
  }
  const blockers: string[] = [];
  if (marker.markerVersion !== "n2-trifecta-private-capture-accepted-v1") blockers.push("ACCEPTED_MARKER_VERSION_INVALID");
  if (typeof marker.manifestDigest !== "string" || !SHA256_RE.test(marker.manifestDigest)) blockers.push("ACCEPTED_MARKER_MANIFEST_DIGEST_INVALID");
  if (typeof marker.checkpointKey !== "string" || !SHA256_RE.test(marker.checkpointKey)) blockers.push("ACCEPTED_MARKER_CHECKPOINT_KEY_INVALID");
  if (marker.raceIdentity !== raceIdentity) blockers.push("ACCEPTED_MARKER_RACE_IDENTITY_MISMATCH");
  if (marker.checkpointLabel !== "T-5") blockers.push("ACCEPTED_MARKER_CHECKPOINT_MISMATCH");
  if (typeof marker.rawDocumentId !== "string"
    || marker.rawDocumentId.length < 1
    || marker.rawDocumentId.trim() !== marker.rawDocumentId) blockers.push("ACCEPTED_MARKER_RAW_DOCUMENT_ID_INVALID");
  if (typeof marker.rawSha256 !== "string" || !SHA256_RE.test(marker.rawSha256)) blockers.push("ACCEPTED_MARKER_RAW_SHA256_INVALID");
  if (!timestampWithinRaceDateJst(input.date, marker.acceptedAt)) blockers.push("ACCEPTED_MARKER_ACCEPTED_AT_INVALID");
  if (marker.databaseWriteAuthorized !== false) blockers.push("ACCEPTED_MARKER_DATABASE_BOUNDARY_WIDENED");
  if (marker.productionApplyExecuted !== false) blockers.push("ACCEPTED_MARKER_PRODUCTION_BOUNDARY_WIDENED");

  const rawRelativePath = marker.rawRelativePath;
  if (typeof rawRelativePath !== "string"
    || !rawRelativePath.startsWith(`${directory}/`)
    || !rawRelativePath.endsWith(".html")) {
    blockers.push("ACCEPTED_MARKER_RAW_PATH_INVALID");
  } else {
    let rawPath: string | null = null;
    try {
      rawPath = resolveInsideExpectedDirectory(input.dataRoot, rawRelativePath, directory);
    } catch {
      rawPath = null;
    }
    if (!rawPath) blockers.push("ACCEPTED_MARKER_RAW_PATH_INVALID");
    else if (!regularBounded(rawPath, MAX_EVIDENCE_BYTES)) blockers.push("ACCEPTED_RAW_EVIDENCE_FILE_INVALID");
  }
  const envelopeRelativePath = marker.envelopeRelativePath;
  if (typeof envelopeRelativePath !== "string"
    || !envelopeRelativePath.startsWith(`${directory}/`)
    || !envelopeRelativePath.endsWith(".envelope.json")) {
    blockers.push("ACCEPTED_MARKER_ENVELOPE_PATH_INVALID");
  } else {
    let envelopePath: string | null = null;
    try {
      envelopePath = resolveInsideExpectedDirectory(input.dataRoot, envelopeRelativePath, directory);
    } catch {
      envelopePath = null;
    }
    if (!envelopePath) blockers.push("ACCEPTED_MARKER_ENVELOPE_PATH_INVALID");
    else if (!regularBounded(envelopePath, MAX_EVIDENCE_BYTES)) blockers.push("ACCEPTED_ENVELOPE_EVIDENCE_FILE_INVALID");
  }
  return { valid: blockers.length === 0, raceKey, blockers: unique(blockers) };
}

function discoverAcceptedT5(dataRoot: string): {
  acceptedRaceKeys: string[];
  blockedRaceKeys: string[];
  invalidAcceptedMarkerCount: number;
  sourceBlockers: string[];
} {
  const base = "data/raw/research/trifecta-market";
  const sourceBlockers: string[] = [];
  const acceptedRaceKeys: string[] = [];
  const blockedRaceKeys: string[] = [];
  let invalidAcceptedMarkerCount = 0;
  let dates: string[];
  try {
    dates = safeDirectoryNames(dataRoot, base).filter((name) => {
      if (!DATE_RE.test(name)) return false;
      if (!isValidCalendarDateDirectory(name)) {
        sourceBlockers.push(`PRIVATE_CAPTURE_DATE_INVALID:${name}`);
        return false;
      }
      return true;
    });
  } catch (error) {
    return {
      acceptedRaceKeys: [],
      blockedRaceKeys: [],
      invalidAcceptedMarkerCount: 0,
      sourceBlockers: [error instanceof Error ? error.message : "PRIVATE_CAPTURE_ROOT_INVALID"],
    };
  }
  if (dates.length > MAX_DATE_DIRS) {
    sourceBlockers.push(`PRIVATE_CAPTURE_DATE_COUNT_EXCEEDS_BOUND:${dates.length}`);
    return { acceptedRaceKeys: [], blockedRaceKeys: [], invalidAcceptedMarkerCount: 0, sourceBlockers };
  }

  for (const date of dates) {
    let venues: string[];
    try {
      venues = safeDirectoryNames(dataRoot, `${base}/${date}`).filter((name) => VENUE_RE.test(name));
    } catch {
      sourceBlockers.push(`PRIVATE_CAPTURE_DATE_DIRECTORY_INVALID:${date}`);
      continue;
    }
    for (const venue of venues) {
      let races: string[];
      try {
        races = safeDirectoryNames(dataRoot, `${base}/${date}/${venue}`).filter((name) => RACE_DIR_RE.test(name));
      } catch {
        sourceBlockers.push(`PRIVATE_CAPTURE_VENUE_DIRECTORY_INVALID:${date}:${venue}`);
        continue;
      }
      for (const raceDir of races) {
        const checked = validateAcceptedMarker({ dataRoot, date, venue, raceDir });
        if (checked.valid) {
          const metadata = readN2T5DecisionCutoffMetadata({
            dataRoot,
            raceKeys: [checked.raceKey],
          });
          if (metadata.status === "PASS") acceptedRaceKeys.push(checked.raceKey);
          else {
            blockedRaceKeys.push(checked.raceKey);
            invalidAcceptedMarkerCount += 1;
          }
        } else if (checked.blockers.length > 0) {
          blockedRaceKeys.push(checked.raceKey);
          invalidAcceptedMarkerCount += 1;
        }
      }
    }
  }
  return {
    acceptedRaceKeys: unique(acceptedRaceKeys),
    blockedRaceKeys: unique(blockedRaceKeys),
    invalidAcceptedMarkerCount,
    sourceBlockers: unique(sourceBlockers),
  };
}

function tableExists(db: DatabaseSync, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function tableHasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function readSettlements(sidecarDbPath: string, raceKeys: string[]): {
  settledRaceKeys: string[];
  integrityBlockedRaceKeys: string[];
  eligibleRaceCount: number;
  ineligibleRaceCount: number;
  blockers: string[];
} {
  if (raceKeys.length === 0) {
    return { settledRaceKeys: [], integrityBlockedRaceKeys: [], eligibleRaceCount: 0, ineligibleRaceCount: 0, blockers: [] };
  }
  if (!existsSync(sidecarDbPath)) {
    return { settledRaceKeys: [], integrityBlockedRaceKeys: [], eligibleRaceCount: 0, ineligibleRaceCount: 0, blockers: ["SIDECAR_NOT_FOUND"] };
  }
  const walPath = `${sidecarDbPath}-wal`;
  if (existsSync(walPath) && statSync(walPath).size > 0) {
    return { settledRaceKeys: [], integrityBlockedRaceKeys: [], eligibleRaceCount: 0, ineligibleRaceCount: 0, blockers: ["SIDECAR_ACTIVE_WAL"] };
  }

  const db = new DatabaseSync(`${pathToFileURL(sidecarDbPath).href}?immutable=1`, { readOnly: true } as never);
  try {
    db.exec("PRAGMA query_only=ON");
    for (const table of [
      "domain_observations",
      "parse_runs",
      "raw_documents",
      "settlement_candidates_v2",
      "race_payout_lines_v2",
      "settlement_source_duplicate_resolutions_v2",
    ]) {
      if (!tableExists(db, table)) {
        return { settledRaceKeys: [], integrityBlockedRaceKeys: [], eligibleRaceCount: 0, ineligibleRaceCount: 0, blockers: [`SIDECAR_TABLE_MISSING:${table}`] };
      }
    }
    let validResolvedObservationIds: Set<string>;
    try {
      validResolvedObservationIds = readCurrentlyValidSourceDuplicateObservationIds(db);
    } catch {
      return { settledRaceKeys: [], integrityBlockedRaceKeys: [], eligibleRaceCount: 0, ineligibleRaceCount: 0, blockers: ["SOURCE_DUPLICATE_RESOLUTION_EVIDENCE_INVALID"] };
    }
    const hasSemanticHashAuthority = tableHasColumn(db, "settlement_candidates_v2", "semantic_hash");
    const placeholders = raceKeys.map(() => "?").join(",");
    const invalidSuperseders = db.prepare(`
      SELECT newer.candidate_id AS candidateId
      FROM settlement_candidates_v2 newer
      JOIN settlement_candidates_v2 prior
        ON prior.candidate_id=newer.supersedes_candidate_id
      WHERE (prior.canonical_race_key IN (${placeholders}) OR newer.canonical_race_key IN (${placeholders}))
        AND (newer.canonical_race_key<>prior.canonical_race_key OR newer.bet_type<>prior.bet_type)
      ORDER BY newer.candidate_id
    `).all(...raceKeys, ...raceKeys) as unknown as Array<{ candidateId: string }>;
    if (invalidSuperseders.length > 0) {
      return {
        settledRaceKeys: [],
        integrityBlockedRaceKeys: [],
        eligibleRaceCount: 0,
        ineligibleRaceCount: 0,
        blockers: invalidSuperseders.map((row) => `SETTLEMENT_SUPERSESSION_IDENTITY_INVALID:${row.candidateId}`),
      };
    }
    const missingSupersessionPredecessors = db.prepare(`
      SELECT newer.candidate_id AS candidateId
      FROM settlement_candidates_v2 newer
      WHERE newer.canonical_race_key IN (${placeholders})
        AND newer.supersedes_candidate_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM settlement_candidates_v2 prior
          WHERE prior.candidate_id=newer.supersedes_candidate_id
        )
      ORDER BY newer.candidate_id
    `).all(...raceKeys) as unknown as Array<{ candidateId: string }>;
    if (missingSupersessionPredecessors.length > 0) {
      return {
        settledRaceKeys: [],
        integrityBlockedRaceKeys: [],
        eligibleRaceCount: 0,
        ineligibleRaceCount: 0,
        blockers: missingSupersessionPredecessors.map(
          (row) => `SETTLEMENT_SUPERSESSION_PREDECESSOR_MISSING:${row.candidateId}`,
        ),
      };
    }
    const supersessionCycle = db.prepare(`
      WITH RECURSIVE chain(rootCandidateId,currentCandidateId,nextCandidateId,depth) AS (
        SELECT candidate_id,candidate_id,supersedes_candidate_id,0
        FROM settlement_candidates_v2
        WHERE canonical_race_key IN (${placeholders})
        UNION ALL
        SELECT chain.rootCandidateId,prior.candidate_id,prior.supersedes_candidate_id,chain.depth+1
        FROM chain
        JOIN settlement_candidates_v2 prior ON prior.candidate_id=chain.nextCandidateId
        WHERE chain.nextCandidateId IS NOT NULL
          AND chain.depth < 1024
      )
      SELECT rootCandidateId AS candidateId
      FROM chain
      WHERE nextCandidateId=rootCandidateId
      ORDER BY candidateId
      LIMIT 1
    `).get(...raceKeys) as { candidateId: string } | undefined;
    if (supersessionCycle) {
      return {
        settledRaceKeys: [],
        integrityBlockedRaceKeys: [],
        eligibleRaceCount: 0,
        ineligibleRaceCount: 0,
        blockers: [`SETTLEMENT_SUPERSESSION_CYCLE_INVALID:${supersessionCycle.candidateId}`],
      };
    }
    const rows = db.prepare(`
      SELECT
        c.canonical_race_key AS raceKey,
        c.candidate_id AS candidateId,
        c.observation_id AS observationId,
        c.parse_run_id AS candidateParseRunId,
        c.raw_document_id AS candidateRawDocumentId,
        o.canonical_race_key AS observationRaceKey,
        o.observation_type AS observationType,
        o.payload_type AS observationPayloadType,
        o.parse_run_id AS observationParseRunId,
        o.raw_document_id AS observationRawDocumentId,
        pr.raw_document_id AS parseRunRawDocumentId,
        pr.status AS parseRunStatus,
        rd.integrity_status AS rawIntegrityStatus,
        rd.security_scan_status AS rawSecurityScanStatus,
        rd.parser_replay_eligible AS rawParserReplayEligible,
        c.settlement_status AS settlementStatus,
        c.result_kind AS resultKind,
        c.resolution_status AS resolutionStatus,
        SUM(CASE WHEN p.bet_type=c.bet_type AND p.line_kind='payout' AND p.selection_canonical IS NOT NULL THEN 1 ELSE 0 END) AS payoutCount,
        SUM(CASE WHEN p.bet_type=c.bet_type AND p.line_kind='special_payout' THEN 1 ELSE 0 END) AS specialPayoutCount,
        SUM(CASE WHEN p.bet_type<>c.bet_type THEN 1 ELSE 0 END) AS payoutBetMismatchCount,
        SUM(CASE WHEN p.bet_type=c.bet_type
          AND p.selection_canonical IS NOT NULL
          AND NOT (
            p.selection_canonical GLOB '[1-6]-[1-6]-[1-6]'
            AND substr(p.selection_canonical,1,1)<>substr(p.selection_canonical,3,1)
            AND substr(p.selection_canonical,1,1)<>substr(p.selection_canonical,5,1)
            AND substr(p.selection_canonical,3,1)<>substr(p.selection_canonical,5,1)
          ) THEN 1 ELSE 0 END) AS payoutSelectionInvalidCount,
        MAX(CASE WHEN p.bet_type=c.bet_type AND p.line_kind='payout' THEN p.selection_raw END) AS payoutSelectionRaw,
        MAX(CASE WHEN p.bet_type=c.bet_type AND p.line_kind='payout' THEN p.selection_normalized END) AS payoutSelectionNormalized,
        MAX(CASE WHEN p.bet_type=c.bet_type AND p.line_kind='payout' THEN p.selection_canonical END) AS payoutSelectionCanonical
      FROM settlement_candidates_v2 c
      LEFT JOIN domain_observations o
        ON o.observation_id=c.observation_id
      LEFT JOIN parse_runs pr
        ON pr.parse_run_id=c.parse_run_id
      LEFT JOIN raw_documents rd
        ON rd.raw_document_id=c.raw_document_id
      LEFT JOIN race_payout_lines_v2 p ON p.candidate_id=c.candidate_id
      WHERE c.bet_type='trifecta'
        AND c.canonical_race_key IN (${placeholders})
        AND NOT EXISTS (
          SELECT 1 FROM settlement_candidates_v2 newer
          WHERE newer.supersedes_candidate_id=c.candidate_id
            AND newer.canonical_race_key=c.canonical_race_key
            AND newer.bet_type=c.bet_type
        )
      GROUP BY c.canonical_race_key,c.candidate_id,c.observation_id,c.parse_run_id,c.raw_document_id,
        o.canonical_race_key,o.observation_type,o.payload_type,o.parse_run_id,o.raw_document_id,
        pr.raw_document_id,pr.status,rd.integrity_status,rd.security_scan_status,rd.parser_replay_eligible,
        c.settlement_status,c.result_kind,c.resolution_status
      ORDER BY c.canonical_race_key,c.candidate_id
    `).all(...raceKeys) as unknown as SettlementRow[];

    const byRace = new Map<string, SettlementRow[]>();
    const lineageBlockedRaceKeys = new Set<string>();
    for (const row of rows) {
      if (validResolvedObservationIds.has(row.observationId)) continue;
      if (hasSemanticHashAuthority && !settlementCandidateSemanticHashValid(db, row.candidateId)) {
        lineageBlockedRaceKeys.add(row.raceKey);
        continue;
      }
      const parsedSelection = row.payoutSelectionRaw === null
        ? null
        : parseSettlementSelection("trifecta", row.payoutSelectionRaw);
      const payoutSelectionSemanticsInvalid = parsedSelection !== null
        && (!parsedSelection.valid
          || parsedSelection.normalized !== row.payoutSelectionNormalized
          || parsedSelection.canonical !== row.payoutSelectionCanonical);
      if (row.observationRaceKey !== row.raceKey
        || row.observationType !== "settlement_result"
        || row.observationPayloadType !== "settlement_result"
        || row.observationParseRunId !== row.candidateParseRunId
        || row.observationRawDocumentId !== row.candidateRawDocumentId
        || row.parseRunRawDocumentId !== row.candidateRawDocumentId
        || row.parseRunStatus == null
        || !REUSABLE_PARSE_STATUSES.has(row.parseRunStatus)
        || row.rawIntegrityStatus !== "verified"
        || row.rawSecurityScanStatus !== "passed"
        || row.rawParserReplayEligible !== 1
        || Number(row.payoutBetMismatchCount) !== 0
        || Number(row.payoutSelectionInvalidCount) !== 0
        || payoutSelectionSemanticsInvalid) {
        lineageBlockedRaceKeys.add(row.raceKey);
        continue;
      }
      const current = byRace.get(row.raceKey) ?? [];
      current.push({
        ...row,
        payoutCount: Number(row.payoutCount),
        specialPayoutCount: Number(row.specialPayoutCount),
        payoutBetMismatchCount: Number(row.payoutBetMismatchCount),
        payoutSelectionInvalidCount: Number(row.payoutSelectionInvalidCount),
      });
      byRace.set(row.raceKey, current);
    }
    const settledRaceKeys: string[] = [];
    const integrityBlockedRaceKeys: string[] = [];
    let eligibleRaceCount = 0;
    let ineligibleRaceCount = 0;
    for (const raceKey of raceKeys) {
      if (lineageBlockedRaceKeys.has(raceKey)) {
        integrityBlockedRaceKeys.push(raceKey);
        continue;
      }
      const candidates = byRace.get(raceKey) ?? [];
      if (candidates.length > 1) {
        integrityBlockedRaceKeys.push(raceKey);
        continue;
      }
      const row = candidates[0];
      if (!row) {
        ineligibleRaceCount += 1;
        continue;
      }
      const clean = row.settlementStatus === "settled"
        && row.resultKind === "normal"
        && row.resolutionStatus === "resolved"
        && row.payoutCount === 1
        && row.specialPayoutCount === 0;
      if (clean) {
        eligibleRaceCount += 1;
        settledRaceKeys.push(raceKey);
      } else {
        ineligibleRaceCount += 1;
      }
    }
    return {
      settledRaceKeys: unique(settledRaceKeys),
      integrityBlockedRaceKeys: unique(integrityBlockedRaceKeys),
      eligibleRaceCount,
      ineligibleRaceCount,
      blockers: [],
    };
  } finally {
    db.close();
  }
}

export function readN2MarketBaselineReadiness(input: {
  dataRoot: string;
  sidecarDbPath?: string;
}): N2MarketBaselineReadinessRead {
  const dataRoot = resolve(input.dataRoot);
  const sidecarDbPath = resolve(input.sidecarDbPath ?? resolve(dataRoot, "data/research-replay.sqlite"));
  const captures = discoverAcceptedT5(dataRoot);
  const settlements = readSettlements(sidecarDbPath, captures.acceptedRaceKeys);
  return {
    readerVersion: N2_MARKET_BASELINE_READINESS_READER_VERSION,
    acceptedT5RaceKeys: captures.acceptedRaceKeys,
    settledRaceKeys: settlements.settledRaceKeys,
    integrityBlockedRaceKeys: unique([
      ...captures.blockedRaceKeys,
      ...settlements.integrityBlockedRaceKeys,
    ]),
    sourceBlockers: unique([
      ...captures.sourceBlockers,
      ...settlements.blockers,
    ]),
    acceptedMarkerCount: captures.acceptedRaceKeys.length,
    invalidAcceptedMarkerCount: captures.invalidAcceptedMarkerCount,
    settlementEligibleRaceCount: settlements.eligibleRaceCount,
    settlementIneligibleRaceCount: settlements.ineligibleRaceCount,
    databaseReadCount: captures.acceptedRaceKeys.length > 0 && settlements.blockers.length === 0 ? 1 : 0,
    databaseWriteCount: 0,
    rawOddsValuesRead: false,
  };
}
