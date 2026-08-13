import { existsSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { officialVenueCode } from "../domain/officialLinks";
import {
  buildN2TrifectaOddsCheckpointPlan,
  type N2TrifectaOddsCheckpointPlan,
  type N2TrifectaOddsRaceInput,
} from "./n2TrifectaOddsCheckpointCollection";

export const N2_TRIFECTA_PRIVATE_CAPTURE_PLAN_READER_VERSION =
  "n2-trifecta-private-capture-plan-reader-v1";

export type N2TrifectaPrivateCapturePlanReadResult = {
  readerVersion: typeof N2_TRIFECTA_PRIVATE_CAPTURE_PLAN_READER_VERSION;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  source: {
    primaryDbPath: string;
    readOnly: true;
    queryOnly: true;
    immutable: true;
    walBytes: number;
    bytesBefore: number;
    bytesAfter: number;
    modifiedMsBefore: number;
    modifiedMsAfter: number;
    metadataUnchanged: boolean;
  };
  requestedDate: string;
  requestedVenueCode: string;
  sourceRowCount: number;
  selectedRaceCount: number;
  selectedRaceIds: string[];
  plan: N2TrifectaOddsCheckpointPlan;
  databaseWriteCount: 0;
  approvalCreated: false;
  networkExecuted: false;
  productionApplyExecuted: false;
};

type ProgramRow = {
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
  closeAt: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VENUE_RE = /^(0[1-9]|1\d|2[0-4])$/;

function isCanonicalCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function dbMeta(path: string): {
  bytes: number;
  modifiedMs: number;
  walBytes: number;
} {
  if (!existsSync(path)) throw new Error("PRIMARY_DB_NOT_FOUND");
  const stat = statSync(path);
  const walPath = `${path}-wal`;
  return {
    bytes: stat.size,
    modifiedMs: stat.mtimeMs,
    walBytes: existsSync(walPath) ? statSync(walPath).size : 0,
  };
}

function openImmutable(path: string): DatabaseSync {
  const db = new DatabaseSync(`${pathToFileURL(path).href}?immutable=1`, {
    readOnly: true,
  } as never);
  db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000");
  return db;
}

function normalizeCloseAt(value: string): string | null {
  const trimmed = value.trim();
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(trimmed);
  if (!match) return null;
  if (match[3] && match[3] !== "00") return null;
  return `${match[1]}:${match[2]}`;
}

function emptyBlockedPlan(): N2TrifectaOddsCheckpointPlan {
  return buildN2TrifectaOddsCheckpointPlan({
    stage: "ONE_VENUE_REVIEW",
    races: [],
  });
}

export function readN2TrifectaPrivateCapturePlan(input: {
  primaryDbPath: string;
  date: string;
  venueCode: string;
}): N2TrifectaPrivateCapturePlanReadResult {
  const blockers: string[] = [];
  if (!isCanonicalCalendarDate(input.date)) blockers.push("INVALID_DATE");
  if (!VENUE_RE.test(input.venueCode)) blockers.push("INVALID_VENUE_CODE");

  const before = dbMeta(input.primaryDbPath);
  if (before.walBytes > 0) throw new Error("PRIMARY_DB_ACTIVE_WAL");
  if (blockers.length > 0) {
    return {
      readerVersion: N2_TRIFECTA_PRIVATE_CAPTURE_PLAN_READER_VERSION,
      status: "BLOCKED",
      blockers,
      source: {
        primaryDbPath: input.primaryDbPath,
        readOnly: true,
        queryOnly: true,
        immutable: true,
        walBytes: before.walBytes,
        bytesBefore: before.bytes,
        bytesAfter: before.bytes,
        modifiedMsBefore: before.modifiedMs,
        modifiedMsAfter: before.modifiedMs,
        metadataUnchanged: true,
      },
      requestedDate: input.date,
      requestedVenueCode: input.venueCode,
      sourceRowCount: 0,
      selectedRaceCount: 0,
      selectedRaceIds: [],
      plan: emptyBlockedPlan(),
      databaseWriteCount: 0,
      approvalCreated: false,
      networkExecuted: false,
      productionApplyExecuted: false,
    };
  }

  const db = openImmutable(input.primaryDbPath);
  let rows: ProgramRow[] = [];
  try {
    const table = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='official_programs'",
    ).get();
    if (!table) blockers.push("OFFICIAL_PROGRAMS_TABLE_MISSING");
    else {
      rows = db.prepare(`
        SELECT
          race_id AS raceId,
          date,
          venue,
          race_no AS raceNo,
          close_at AS closeAt
        FROM official_programs
        WHERE date = ?
        ORDER BY race_no, race_id
      `).all(input.date) as unknown as ProgramRow[];
    }
  } finally {
    db.close();
  }

  const selected = rows.filter((row) => officialVenueCode(row.venue) === input.venueCode);
  if (selected.length === 0) blockers.push("VENUE_PROGRAMS_EMPTY");
  if (selected.length > 12) blockers.push("RACE_LIMIT_EXCEEDED");

  const raceNumbers = new Set<number>();
  const races: N2TrifectaOddsRaceInput[] = [];
  for (const row of selected) {
    if (!Number.isInteger(row.raceNo) || row.raceNo < 1 || row.raceNo > 12) {
      blockers.push("INVALID_RACE_NO");
      continue;
    }
    if (raceNumbers.has(row.raceNo)) blockers.push("DUPLICATE_RACE_NO");
    raceNumbers.add(row.raceNo);
    const closeAt = normalizeCloseAt(row.closeAt);
    if (!closeAt) {
      blockers.push("INVALID_CLOSE_AT");
      continue;
    }
    const compactDate = input.date.replaceAll("-", "");
    const suffix = String(row.raceNo).padStart(2, "0");
    const acceptedIds = new Set([
      `${compactDate}-${input.venueCode}-${suffix}`,
      `${compactDate}-${row.venue.trim()}-${suffix}`,
    ]);
    if (!acceptedIds.has(row.raceId)) {
      blockers.push("RACE_IDENTITY_MISMATCH");
      continue;
    }
    races.push({
      date: input.date,
      venueCode: input.venueCode,
      raceNo: row.raceNo,
      closeAt,
    });
  }

  const normalizedBlockers = [...new Set(blockers)].sort();
  const plan = normalizedBlockers.length === 0
    ? buildN2TrifectaOddsCheckpointPlan({
        stage: "ONE_VENUE_REVIEW",
        races,
      })
    : emptyBlockedPlan();
  if (plan.status !== "READY_FOR_PRIVATE_REVIEW" && normalizedBlockers.length === 0) {
    normalizedBlockers.push(...plan.blockers.map((blocker) => `PLAN_${blocker}`));
  }

  const after = dbMeta(input.primaryDbPath);
  const metadataUnchanged = before.bytes === after.bytes
    && before.modifiedMs === after.modifiedMs
    && before.walBytes === after.walBytes;
  if (!metadataUnchanged) normalizedBlockers.push("PRIMARY_DB_METADATA_CHANGED");

  return {
    readerVersion: N2_TRIFECTA_PRIVATE_CAPTURE_PLAN_READER_VERSION,
    status: normalizedBlockers.length === 0 ? "PASS" : "BLOCKED",
    blockers: [...new Set(normalizedBlockers)].sort(),
    source: {
      primaryDbPath: input.primaryDbPath,
      readOnly: true,
      queryOnly: true,
      immutable: true,
      walBytes: after.walBytes,
      bytesBefore: before.bytes,
      bytesAfter: after.bytes,
      modifiedMsBefore: before.modifiedMs,
      modifiedMsAfter: after.modifiedMs,
      metadataUnchanged,
    },
    requestedDate: input.date,
    requestedVenueCode: input.venueCode,
    sourceRowCount: rows.length,
    selectedRaceCount: races.length,
    selectedRaceIds: selected.map((row) => row.raceId).sort(),
    plan,
    databaseWriteCount: 0,
    approvalCreated: false,
    networkExecuted: false,
    productionApplyExecuted: false,
  };
}
