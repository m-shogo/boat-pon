import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  statSync,
} from "node:fs";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { parseAllTrifectaOdds } from "../domain/oddsParser";
import type { N2TrifectaPrivateCaptureEnvelope } from "./n2TrifectaPrivateCaptureExecutor";
import {
  N2_MARKET_ONLY_BASELINE_COHORT_RACE_COUNT,
  compareN2RaceKeysByRaceTime,
  type N2MarketOnlyBaselineRaceSource,
} from "./n2MarketOnlyBaselineDataset";
import {
  buildN2MarketBaselineReadinessReport,
} from "./n2MarketBaselineReadiness";
import {
  readN2MarketBaselineReadiness,
} from "./n2MarketBaselineReadinessReader";

export const N2_MARKET_ONLY_BASELINE_PRIVATE_SOURCE_VERSION =
  "n2-market-only-baseline-private-source-v1" as const;

export type N2MarketOnlyBaselinePrivateSourceRead = {
  readerVersion: typeof N2_MARKET_ONLY_BASELINE_PRIVATE_SOURCE_VERSION;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  readinessStatus: string;
  readinessDigest: string;
  acceptedT5RaceCount: number;
  settledAcceptedT5RaceCount: number;
  selectedCohortRaceCount: number;
  sources: N2MarketOnlyBaselineRaceSource[];
  privateRawFileReadCount: number;
  privateEnvelopeReadCount: number;
  databaseReadCount: number;
  databaseWriteCount: 0;
  networkRequestCount: 0;
  rawValuesReadPrivately: boolean;
  rawValuesPublished: false;
  publicPublishAuthorized: false;
  productionApplyExecuted: false;
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

type WinnerRow = {
  raceKey: string;
  winningSelection: string | null;
};

type ParsedRaceKey = {
  date: string;
  venueCode: string;
  raceNo: number;
  raceDir: string;
  raceIdentity: string;
};

const RACE_KEY_RE = /^(\d{4}-\d{2}-\d{2}):(0[1-9]|1\d|2[0-4]):R([1-9]|1[0-2])$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const MAX_JSON_BYTES = 2_000_000;
const MAX_RAW_BYTES = 2_000_000;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function parseRaceKey(raceKey: string): ParsedRaceKey | null {
  const match = RACE_KEY_RE.exec(raceKey);
  if (!match) return null;
  const raceNo = Number(match[3]);
  const raceDir = String(raceNo).padStart(2, "0");
  return {
    date: match[1],
    venueCode: match[2],
    raceNo,
    raceDir,
    raceIdentity: `${match[1].replaceAll("-", "")}-${match[2]}-${raceDir}`,
  };
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

function readJsonBounded<T>(path: string): T {
  const lstat = lstatSync(path);
  if (lstat.isSymbolicLink() || !lstat.isFile()) throw new Error("PRIVATE_JSON_FILE_TYPE_INVALID");
  const stat = statSync(path);
  if (stat.size <= 0 || stat.size > MAX_JSON_BYTES) throw new Error("PRIVATE_JSON_SIZE_INVALID");
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function hasValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T| )/u.exec(value);
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

function parseInstant(value: unknown): number | null {
  if (typeof value !== "string" || !hasValidCalendarDate(value)) return null;
  const clock = /(?:T| )(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?/u.exec(value);
  if (clock === null) return null;
  const hour = Number(clock[1]);
  const minute = Number(clock[2]);
  const second = Number(clock[3] ?? "0");
  if (hour > 23 || minute > 59 || second > 59) return null;
  const offset = /([+-])(\d{2}):(\d{2})$/u.exec(value);
  if (offset !== null && (Number(offset[2]) > 23 || Number(offset[3]) > 59)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function instantWithinRaceDateJst(date: string, value: unknown): boolean {
  const instant = parseInstant(value);
  if (instant == null) return false;
  const start = Date.parse(`${date}T00:00:00+09:00`);
  return Number.isFinite(start) && instant >= start && instant < start + 24 * 60 * 60 * 1000;
}

function loadT5Source(input: {
  dataRoot: string;
  canonicalRaceKey: string;
  winningSelection: string;
}): { source: N2MarketOnlyBaselineRaceSource | null; blockers: string[] } {
  const parsed = parseRaceKey(input.canonicalRaceKey);
  if (!parsed) return { source: null, blockers: ["RACE_KEY_INVALID"] };
  const directory = [
    "data", "raw", "research", "trifecta-market",
    parsed.date, parsed.venueCode, parsed.raceDir, "T-5",
  ].join("/");
  const markerPath = resolveInside(input.dataRoot, `${directory}/accepted.json`);
  if (!existsSync(markerPath)) return { source: null, blockers: ["T5_ACCEPTED_MARKER_MISSING"] };

  let marker: AcceptedMarker;
  try {
    marker = readJsonBounded<AcceptedMarker>(markerPath);
  } catch (error) {
    return { source: null, blockers: [`T5_ACCEPTED_MARKER_${error instanceof Error ? error.message : "INVALID"}`] };
  }
  const blockers: string[] = [];
  if (marker.markerVersion !== "n2-trifecta-private-capture-accepted-v1") blockers.push("T5_MARKER_VERSION_INVALID");
  if (typeof marker.manifestDigest !== "string" || !SHA256_RE.test(marker.manifestDigest)) blockers.push("T5_MANIFEST_DIGEST_INVALID");
  if (typeof marker.checkpointKey !== "string" || !SHA256_RE.test(marker.checkpointKey)) blockers.push("T5_CHECKPOINT_KEY_INVALID");
  if (marker.raceIdentity !== parsed.raceIdentity) blockers.push("T5_RACE_IDENTITY_MISMATCH");
  if (marker.checkpointLabel !== "T-5") blockers.push("T5_CHECKPOINT_LABEL_INVALID");
  if (typeof marker.rawDocumentId !== "string" || !marker.rawDocumentId.trim()) blockers.push("T5_RAW_DOCUMENT_ID_INVALID");
  if (typeof marker.rawSha256 !== "string" || !SHA256_RE.test(marker.rawSha256)) blockers.push("T5_RAW_SHA256_INVALID");
  if (parseInstant(marker.acceptedAt) == null) blockers.push("T5_ACCEPTED_AT_INVALID");
  if (marker.databaseWriteAuthorized !== false) blockers.push("T5_MARKER_DATABASE_BOUNDARY_WIDENED");
  if (marker.productionApplyExecuted !== false) blockers.push("T5_MARKER_PRODUCTION_BOUNDARY_WIDENED");
  if (typeof marker.rawRelativePath !== "string"
    || !marker.rawRelativePath.startsWith(`${directory}/`)
    || !marker.rawRelativePath.endsWith(".html")) blockers.push("T5_RAW_PATH_INVALID");
  if (typeof marker.envelopeRelativePath !== "string"
    || !marker.envelopeRelativePath.startsWith(`${directory}/`)
    || !marker.envelopeRelativePath.endsWith(".envelope.json")) blockers.push("T5_ENVELOPE_PATH_INVALID");
  if (blockers.length > 0) return { source: null, blockers: unique(blockers) };

  let rawPath: string | null = null;
  let envelopePath: string | null = null;
  try {
    rawPath = resolveInsideExpectedDirectory(input.dataRoot, marker.rawRelativePath as string, directory);
  } catch {
    rawPath = null;
  }
  try {
    envelopePath = resolveInsideExpectedDirectory(input.dataRoot, marker.envelopeRelativePath as string, directory);
  } catch {
    envelopePath = null;
  }
  if (!rawPath) blockers.push("T5_RAW_PATH_INVALID");
  if (!envelopePath) blockers.push("T5_ENVELOPE_PATH_INVALID");
  if (blockers.length > 0) return { source: null, blockers: unique(blockers) };

  if (!existsSync(rawPath!)) blockers.push("T5_RAW_FILE_MISSING");
  if (!existsSync(envelopePath!)) blockers.push("T5_ENVELOPE_FILE_MISSING");
  if (blockers.length > 0) return { source: null, blockers: unique(blockers) };

  const rawStat = lstatSync(rawPath!);
  if (rawStat.isSymbolicLink() || !rawStat.isFile()) blockers.push("T5_RAW_FILE_TYPE_INVALID");
  if (rawStat.size <= 0 || rawStat.size > MAX_RAW_BYTES) blockers.push("T5_RAW_SIZE_INVALID");
  if (blockers.length > 0) return { source: null, blockers: unique(blockers) };

  let envelope: N2TrifectaPrivateCaptureEnvelope;
  try {
    envelope = readJsonBounded<N2TrifectaPrivateCaptureEnvelope>(envelopePath!);
  } catch (error) {
    blockers.push(`T5_ENVELOPE_${error instanceof Error ? error.message : "INVALID"}`);
    return { source: null, blockers: unique(blockers) };
  }
  if (envelope.envelopeVersion !== "n2-trifecta-private-capture-envelope-v1") blockers.push("T5_ENVELOPE_VERSION_INVALID");
  if (envelope.status !== "PASS" || envelope.blockers.length > 0) blockers.push("T5_ENVELOPE_NOT_PASS");
  if (envelope.manifestDigest !== marker.manifestDigest) blockers.push("T5_ENVELOPE_MANIFEST_MISMATCH");
  if (envelope.checkpointKey !== marker.checkpointKey) blockers.push("T5_ENVELOPE_CHECKPOINT_KEY_MISMATCH");
  if (envelope.entry.raceIdentity !== parsed.raceIdentity) blockers.push("T5_ENVELOPE_RACE_MISMATCH");
  if (envelope.entry.checkpointLabel !== "T-5") blockers.push("T5_ENVELOPE_CHECKPOINT_MISMATCH");
  if (envelope.response.rawSha256 !== marker.rawSha256) blockers.push("T5_ENVELOPE_RAW_SHA_MISMATCH");
  if (envelope.rawDocumentId !== marker.rawDocumentId) blockers.push("T5_ENVELOPE_RAW_DOCUMENT_MISMATCH");
  if (envelope.rawRelativePath !== marker.rawRelativePath) blockers.push("T5_ENVELOPE_RAW_PATH_MISMATCH");
  if (envelope.envelopeRelativePath !== marker.envelopeRelativePath) blockers.push("T5_ENVELOPE_PATH_MISMATCH");
  if (envelope.parsedSelectionCount !== 120 || envelope.unavailableSelectionCount !== 0) blockers.push("T5_SELECTION_AUDIT_INVALID");
  if (envelope.snapshotAudit?.status !== "PASS") blockers.push("T5_SNAPSHOT_AUDIT_NOT_PASS");
  if (envelope.databaseWriteAuthorized !== false
    || envelope.currentBuyConnectionAuthorized !== false
    || envelope.lineConnectionAuthorized !== false
    || envelope.publicPublishAuthorized !== false
    || envelope.productionApplyExecuted !== false) blockers.push("T5_ENVELOPE_BOUNDARY_WIDENED");

  const decisionCutoff = envelope.entry.decisionCutoff;
  const capturedAt = envelope.response.fetchedAt;
  const availableAt = envelope.sourceDisplayedUpdate.availableAt;
  const decisionMs = parseInstant(decisionCutoff);
  const capturedMs = parseInstant(capturedAt);
  const availableMs = parseInstant(availableAt);
  if (decisionMs == null) blockers.push("T5_DECISION_CUTOFF_INVALID");
  else if (!instantWithinRaceDateJst(parsed.date, decisionCutoff)) blockers.push("T5_DECISION_CUTOFF_OUTSIDE_RACE_DATE");
  if (capturedMs == null) blockers.push("T5_CAPTURED_AT_INVALID");
  if (availableMs == null) blockers.push("T5_AVAILABLE_AT_INVALID");
  if (decisionMs != null && capturedMs != null && capturedMs > decisionMs) blockers.push("T5_CAPTURE_AFTER_DECISION_CUTOFF");
  if (decisionMs != null && availableMs != null && availableMs > decisionMs) blockers.push("T5_AVAILABLE_AFTER_DECISION_CUTOFF");
  if (capturedMs != null && availableMs != null && availableMs > capturedMs) blockers.push("T5_AVAILABLE_AFTER_CAPTURE");
  if (typeof envelope.proposedObservationId !== "string" || !envelope.proposedObservationId.trim()) blockers.push("T5_OBSERVATION_ID_INVALID");
  if (blockers.length > 0) return { source: null, blockers: unique(blockers) };

  const rawBytes = readFileSync(rawPath!);
  if (sha256(rawBytes) !== marker.rawSha256) return { source: null, blockers: ["T5_RAW_SHA256_MISMATCH"] };
  const odds = parseAllTrifectaOdds(rawBytes.toString("utf8"));
  if (odds.size !== 120) return { source: null, blockers: ["T5_REPARSE_SELECTION_COUNT_NOT_120"] };
  const selections = [...odds.entries()]
    .map(([selection, value]) => ({ selection, odds: value }))
    .sort((left, right) => left.selection.localeCompare(right.selection));
  return {
    source: {
      canonicalRaceKey: input.canonicalRaceKey,
      decisionCutoff: decisionCutoff!,
      capturedAt,
      availableAt: availableAt!,
      observationId: envelope.proposedObservationId!,
      rawDocumentId: marker.rawDocumentId as string,
      winningSelection: input.winningSelection,
      selections,
    },
    blockers: [],
  };
}

function openReadOnly(path: string): DatabaseSync {
  const db = new DatabaseSync(`${pathToFileURL(path).href}?immutable=1`, { readOnly: true } as never);
  db.exec("PRAGMA query_only=ON");
  return db;
}

function readWinners(sidecarDbPath: string, raceKeys: string[]): {
  winners: Map<string, string>;
  blockers: string[];
} {
  if (raceKeys.length === 0) return { winners: new Map(), blockers: [] };
  const db = openReadOnly(sidecarDbPath);
  try {
    const placeholders = raceKeys.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT c.canonical_race_key AS raceKey, p.selection_canonical AS winningSelection
      FROM settlement_candidates_v2 c
      JOIN race_payout_lines_v2 p
        ON p.candidate_id=c.candidate_id
       AND p.bet_type='trifecta'
       AND p.line_kind='payout'
       AND p.selection_canonical IS NOT NULL
      WHERE c.bet_type='trifecta'
        AND c.settlement_status='settled'
        AND c.result_kind='normal'
        AND c.resolution_status='resolved'
        AND c.canonical_race_key IN (${placeholders})
        AND NOT EXISTS (
          SELECT 1 FROM settlement_source_duplicate_resolutions_v2 d
          WHERE d.duplicate_observation_id=c.observation_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM settlement_candidates_v2 newer
          WHERE newer.supersedes_candidate_id=c.candidate_id
        )
      ORDER BY c.canonical_race_key,p.line_no
    `).all(...raceKeys) as unknown as WinnerRow[];
    const grouped = new Map<string, string[]>();
    for (const row of rows) {
      const current = grouped.get(row.raceKey) ?? [];
      if (row.winningSelection) current.push(row.winningSelection);
      grouped.set(row.raceKey, current);
    }
    const blockers: string[] = [];
    const winners = new Map<string, string>();
    for (const raceKey of raceKeys) {
      const values = grouped.get(raceKey) ?? [];
      if (values.length !== 1) {
        blockers.push(`${raceKey}:WINNER_ROW_COUNT_${values.length}`);
        continue;
      }
      winners.set(raceKey, values[0]);
    }
    return { winners, blockers: unique(blockers) };
  } finally {
    db.close();
  }
}

export function readN2MarketOnlyBaselinePrivateSources(input: {
  dataRoot: string;
  sidecarDbPath?: string;
}): N2MarketOnlyBaselinePrivateSourceRead {
  const dataRoot = resolve(input.dataRoot);
  const sidecarDbPath = resolve(input.sidecarDbPath ?? resolve(dataRoot, "data/research-replay.sqlite"));
  const readinessRead = readN2MarketBaselineReadiness({ dataRoot, sidecarDbPath });
  const readiness = buildN2MarketBaselineReadinessReport({
    acceptedT5RaceKeys: readinessRead.acceptedT5RaceKeys,
    settledRaceKeys: readinessRead.settledRaceKeys,
    integrityBlockedRaceKeys: readinessRead.integrityBlockedRaceKeys,
    sourceBlockers: readinessRead.sourceBlockers,
  });
  if (!readiness.n2TaskReady) {
    return {
      readerVersion: N2_MARKET_ONLY_BASELINE_PRIVATE_SOURCE_VERSION,
      status: "BLOCKED",
      blockers: [`READINESS_${readiness.status}`, ...readiness.blockers],
      readinessStatus: readiness.status,
      readinessDigest: readiness.outputDigest,
      acceptedT5RaceCount: readiness.acceptedT5RaceCount,
      settledAcceptedT5RaceCount: readiness.settledAcceptedT5RaceCount,
      selectedCohortRaceCount: 0,
      sources: [],
      privateRawFileReadCount: 0,
      privateEnvelopeReadCount: 0,
      databaseReadCount: readinessRead.databaseReadCount,
      databaseWriteCount: 0,
      networkRequestCount: 0,
      rawValuesReadPrivately: false,
      rawValuesPublished: false,
      publicPublishAuthorized: false,
      productionApplyExecuted: false,
    };
  }

  const raceKeys = [...readinessRead.settledRaceKeys]
    .sort(compareN2RaceKeysByRaceTime)
    .slice(0, N2_MARKET_ONLY_BASELINE_COHORT_RACE_COUNT);
  const winnerRead = readWinners(sidecarDbPath, raceKeys);
  if (winnerRead.blockers.length > 0) {
    return {
      readerVersion: N2_MARKET_ONLY_BASELINE_PRIVATE_SOURCE_VERSION,
      status: "BLOCKED",
      blockers: winnerRead.blockers,
      readinessStatus: readiness.status,
      readinessDigest: readiness.outputDigest,
      acceptedT5RaceCount: readiness.acceptedT5RaceCount,
      settledAcceptedT5RaceCount: readiness.settledAcceptedT5RaceCount,
      selectedCohortRaceCount: raceKeys.length,
      sources: [],
      privateRawFileReadCount: 0,
      privateEnvelopeReadCount: 0,
      databaseReadCount: readinessRead.databaseReadCount + 1,
      databaseWriteCount: 0,
      networkRequestCount: 0,
      rawValuesReadPrivately: false,
      rawValuesPublished: false,
      publicPublishAuthorized: false,
      productionApplyExecuted: false,
    };
  }

  const sources: N2MarketOnlyBaselineRaceSource[] = [];
  const blockers: string[] = [];
  for (const raceKey of raceKeys) {
    const winningSelection = winnerRead.winners.get(raceKey);
    if (!winningSelection) {
      blockers.push(`${raceKey}:WINNER_MISSING`);
      continue;
    }
    const loaded = loadT5Source({ dataRoot, canonicalRaceKey: raceKey, winningSelection });
    if (loaded.source) sources.push(loaded.source);
    else blockers.push(...loaded.blockers.map((blocker) => `${raceKey}:${blocker}`));
  }
  const normalizedBlockers = unique(blockers);
  return {
    readerVersion: N2_MARKET_ONLY_BASELINE_PRIVATE_SOURCE_VERSION,
    status: normalizedBlockers.length === 0 && sources.length === N2_MARKET_ONLY_BASELINE_COHORT_RACE_COUNT
      ? "PASS"
      : "BLOCKED",
    blockers: normalizedBlockers.length > 0
      ? normalizedBlockers
      : sources.length === N2_MARKET_ONLY_BASELINE_COHORT_RACE_COUNT
        ? []
        : [`PRIVATE_SOURCE_COUNT_${sources.length}/${N2_MARKET_ONLY_BASELINE_COHORT_RACE_COUNT}`],
    readinessStatus: readiness.status,
    readinessDigest: readiness.outputDigest,
    acceptedT5RaceCount: readiness.acceptedT5RaceCount,
    settledAcceptedT5RaceCount: readiness.settledAcceptedT5RaceCount,
    selectedCohortRaceCount: raceKeys.length,
    sources: normalizedBlockers.length === 0 ? sources : [],
    privateRawFileReadCount: sources.length,
    privateEnvelopeReadCount: sources.length,
    databaseReadCount: readinessRead.databaseReadCount + 1,
    databaseWriteCount: 0,
    networkRequestCount: 0,
    rawValuesReadPrivately: sources.length > 0,
    rawValuesPublished: false,
    publicPublishAuthorized: false,
    productionApplyExecuted: false,
  };
}
