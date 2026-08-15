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
  settlementStatus: string;
  resultKind: string;
  resolutionStatus: string;
  payoutCount: number;
  specialPayoutCount: number;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const VENUE_RE = /^(0[1-9]|1\d|2[0-4])$/u;
const RACE_DIR_RE = /^(0[1-9]|1[0-2])$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const MAX_DATE_DIRS = 366;
const MAX_MARKER_BYTES = 128 * 1024;
const MAX_EVIDENCE_BYTES = 2_000_000;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
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

function safeDirectoryNames(rootDir: string, relativeDir: string): string[] {
  const path = resolveInside(rootDir, relativeDir);
  if (!existsSync(path)) return [];
  const rootStat = lstatSync(path);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("PRIVATE_DIRECTORY_TYPE_INVALID");
  }
  return readdirSync(path).sort();
}

function regularBounded(path: string, maxBytes: number): boolean {
  if (!existsSync(path)) return false;
  const lstat = lstatSync(path);
  if (lstat.isSymbolicLink() || !lstat.isFile()) return false;
  const stat = statSync(path);
  return stat.size > 0 && stat.size <= maxBytes;
}

function parseIso(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const calendar = /^(\d{4})-(\d{2})-(\d{2})(?:T| )/u.exec(value);
  if (calendar === null) return false;
  const year = Number(calendar[1]);
  const month = Number(calendar[2]);
  const day = Number(calendar[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) return false;
  const clock = /(?:T| )(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?/u.exec(value);
  if (clock === null) return false;
  if (Number(clock[1]) > 23 || Number(clock[2]) > 59 || Number(clock[3] ?? "0") > 59) return false;
  const offset = /([+-])(\d{2}):(\d{2})$/u.exec(value);
  if (offset !== null && (Number(offset[2]) > 23 || Number(offset[3]) > 59)) return false;
  return Number.isFinite(Date.parse(value));
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
  if (marker.raceIdentity !== raceIdentity) blockers.push("ACCEPTED_MARKER_RACE_IDENTITY_MISMATCH");
  if (marker.checkpointLabel !== "T-5") blockers.push("ACCEPTED_MARKER_CHECKPOINT_MISMATCH");
  if (typeof marker.rawDocumentId !== "string" || marker.rawDocumentId.length < 1) blockers.push("ACCEPTED_MARKER_RAW_DOCUMENT_ID_INVALID");
  if (typeof marker.rawSha256 !== "string" || !SHA256_RE.test(marker.rawSha256)) blockers.push("ACCEPTED_MARKER_RAW_SHA256_INVALID");
  if (!parseIso(marker.acceptedAt)) blockers.push("ACCEPTED_MARKER_ACCEPTED_AT_INVALID");
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
    dates = safeDirectoryNames(dataRoot, base).filter((name) => DATE_RE.test(name));
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
        if (checked.valid) acceptedRaceKeys.push(checked.raceKey);
        else if (checked.blockers.length > 0) {
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
      "settlement_candidates_v2",
      "race_payout_lines_v2",
      "settlement_source_duplicate_resolutions_v2",
    ]) {
      if (!tableExists(db, table)) {
        return { settledRaceKeys: [], integrityBlockedRaceKeys: [], eligibleRaceCount: 0, ineligibleRaceCount: 0, blockers: [`SIDECAR_TABLE_MISSING:${table}`] };
      }
    }
    const placeholders = raceKeys.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT
        c.canonical_race_key AS raceKey,
        c.candidate_id AS candidateId,
        c.settlement_status AS settlementStatus,
        c.result_kind AS resultKind,
        c.resolution_status AS resolutionStatus,
        SUM(CASE WHEN p.line_kind='payout' AND p.selection_canonical IS NOT NULL THEN 1 ELSE 0 END) AS payoutCount,
        SUM(CASE WHEN p.line_kind='special_payout' THEN 1 ELSE 0 END) AS specialPayoutCount
      FROM settlement_candidates_v2 c
      LEFT JOIN race_payout_lines_v2 p ON p.candidate_id=c.candidate_id AND p.bet_type='trifecta'
      WHERE c.bet_type='trifecta'
        AND c.canonical_race_key IN (${placeholders})
        AND NOT EXISTS (
          SELECT 1 FROM settlement_source_duplicate_resolutions_v2 d
          WHERE d.duplicate_observation_id=c.observation_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM settlement_candidates_v2 newer
          WHERE newer.supersedes_candidate_id=c.candidate_id
        )
      GROUP BY c.canonical_race_key,c.candidate_id,c.settlement_status,c.result_kind,c.resolution_status
      ORDER BY c.canonical_race_key,c.candidate_id
    `).all(...raceKeys) as unknown as SettlementRow[];

    const byRace = new Map<string, SettlementRow[]>();
    for (const row of rows) {
      const current = byRace.get(row.raceKey) ?? [];
      current.push({
        ...row,
        payoutCount: Number(row.payoutCount),
        specialPayoutCount: Number(row.specialPayoutCount),
      });
      byRace.set(row.raceKey, current);
    }
    const settledRaceKeys: string[] = [];
    const integrityBlockedRaceKeys: string[] = [];
    let eligibleRaceCount = 0;
    let ineligibleRaceCount = 0;
    for (const raceKey of raceKeys) {
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
