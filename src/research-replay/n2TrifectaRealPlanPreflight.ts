import { existsSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { officialVenueCode } from "../domain/officialLinks";
import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import {
  buildN2TrifectaOddsCheckpointPlan,
  type N2TrifectaOddsCheckpointPlan,
  type N2TrifectaOddsRaceInput,
} from "./n2TrifectaOddsCheckpointCollection";
import { readN2TrifectaPrivateCapturePlan } from "./n2TrifectaPrivateCapturePlanReader";

export const N2_TRIFECTA_REAL_PLAN_PREFLIGHT_VERSION =
  "n2-trifecta-real-plan-preflight-v1" as const;
export const N2_TRIFECTA_REAL_PLAN_MIN_LEAD_SECONDS = 120;
export const N2_TRIFECTA_REAL_PLAN_MAX_DATES = 3;

export type N2TrifectaRealPlanCandidate = {
  date: string;
  venueCode: string;
  sourcePlan: N2TrifectaOddsCheckpointPlan;
};

export type N2TrifectaFuturePlanSelection = {
  status: "PASS" | "BLOCKED";
  blockers: string[];
  now: string;
  minimumLeadSeconds: typeof N2_TRIFECTA_REAL_PLAN_MIN_LEAD_SECONDS;
  candidatePlanCount: number;
  candidateRaceCount: number;
  selectedDate: string | null;
  selectedVenueCode: string | null;
  selectedRaceCount: number;
  selectedRaceIds: string[];
  earliestCheckpointAt: string | null;
  plan: N2TrifectaOddsCheckpointPlan | null;
  planDigest: string | null;
  approvalCreated: false;
  networkExecuted: false;
  databaseWriteCount: 0;
  productionApplyExecuted: false;
};

export type N2TrifectaRealPlanPreflightReport = {
  reportVersion: typeof N2_TRIFECTA_REAL_PLAN_PREFLIGHT_VERSION;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  generatedAt: string;
  now: string;
  executionLocation: "Mac self-hosted" | "fixture";
  source: {
    primaryDbPath: string;
    exists: boolean;
    immutable: true;
    readOnly: true;
    queryOnly: true;
    walBytesBefore: number;
    walBytesAfter: number;
    bytesBefore: number | null;
    bytesAfter: number | null;
    modifiedMsBefore: number | null;
    modifiedMsAfter: number | null;
    metadataUnchanged: boolean;
  };
  inventory: {
    requestedDateFrom: string;
    discoveredDateCount: number;
    discoveredVenueDayCount: number;
    readableCandidatePlanCount: number;
    blockedCandidatePlanCount: number;
    candidateBlockerCounts: Record<string, number>;
  };
  selection: N2TrifectaFuturePlanSelection;
  approvalCreated: false;
  networkExecuted: false;
  rawPersisted: false;
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

type DbMeta = {
  exists: boolean;
  bytes: number | null;
  modifiedMs: number | null;
  walBytes: number;
};

type VenueDayRow = {
  date: string;
  venue: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseInstant(value: string): number | null {
  try {
    return Date.parse(canonicalUtcTimestamp(value));
  } catch {
    return null;
  }
}

function isCanonicalCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function dbMeta(path: string): DbMeta {
  const walPath = `${path}-wal`;
  return {
    exists: existsSync(path),
    bytes: existsSync(path) ? statSync(path).size : null,
    modifiedMs: existsSync(path) ? statSync(path).mtimeMs : null,
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

function jstDateFromInstant(value: string): string | null {
  const parsed = parseInstant(value);
  if (parsed == null) return null;
  return new Date(parsed + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function raceInputsWithFutureT30(
  candidate: N2TrifectaRealPlanCandidate,
  thresholdMs: number,
): N2TrifectaOddsRaceInput[] {
  const t30Entries = candidate.sourcePlan.entries.filter(
    (entry) => entry.checkpointLabel === "T-30",
  );
  return t30Entries
    .filter((entry) => {
      const target = parseInstant(entry.targetCaptureAt);
      return target != null && target >= thresholdMs;
    })
    .map((entry) => ({
      date: entry.date,
      venueCode: entry.venueCode,
      raceNo: entry.raceNo,
      closeAt: entry.closeAt,
    }))
    .sort((left, right) => left.raceNo - right.raceNo);
}

export function selectN2TrifectaFuturePlan(input: {
  now: string;
  candidates: N2TrifectaRealPlanCandidate[];
}): N2TrifectaFuturePlanSelection {
  const blockers: string[] = [];
  const nowMs = parseInstant(input.now);
  if (nowMs == null) blockers.push("INVALID_NOW");
  const thresholdMs = (nowMs ?? 0)
    + N2_TRIFECTA_REAL_PLAN_MIN_LEAD_SECONDS * 1_000;

  const eligible = input.candidates
    .filter((candidate) => candidate.sourcePlan.status === "READY_FOR_PRIVATE_REVIEW")
    .map((candidate) => {
      const races = raceInputsWithFutureT30(candidate, thresholdMs);
      const plan = races.length > 0
        ? buildN2TrifectaOddsCheckpointPlan({
            stage: "ONE_VENUE_REVIEW",
            races,
          })
        : null;
      const earliestCheckpointAt = plan?.entries[0]?.targetCaptureAt ?? null;
      return { candidate, races, plan, earliestCheckpointAt };
    })
    .filter((item) => item.plan?.status === "READY_FOR_PRIVATE_REVIEW")
    .sort((left, right) => {
      const count = right.races.length - left.races.length;
      if (count !== 0) return count;
      const earliest = String(left.earliestCheckpointAt).localeCompare(
        String(right.earliestCheckpointAt),
      );
      if (earliest !== 0) return earliest;
      const date = left.candidate.date.localeCompare(right.candidate.date);
      if (date !== 0) return date;
      return left.candidate.venueCode.localeCompare(right.candidate.venueCode);
    });

  if (eligible.length === 0) blockers.push("NO_RACES_WITH_ALL_CHECKPOINTS_FUTURE");
  const selected = eligible[0] ?? null;
  const selectedRaceIds = selected?.plan
    ? uniqueSorted(
        selected.plan.entries.map((entry) => entry.raceIdentity),
      )
    : [];
  const candidateRaceCount = input.candidates.reduce(
    (sum, candidate) => sum + new Set(
      candidate.sourcePlan.entries.map((entry) => entry.raceIdentity),
    ).size,
    0,
  );

  return {
    status: blockers.length === 0 ? "PASS" : "BLOCKED",
    blockers: uniqueSorted(blockers),
    now: input.now,
    minimumLeadSeconds: N2_TRIFECTA_REAL_PLAN_MIN_LEAD_SECONDS,
    candidatePlanCount: input.candidates.length,
    candidateRaceCount,
    selectedDate: selected?.candidate.date ?? null,
    selectedVenueCode: selected?.candidate.venueCode ?? null,
    selectedRaceCount: selected?.races.length ?? 0,
    selectedRaceIds,
    earliestCheckpointAt: selected?.earliestCheckpointAt ?? null,
    plan: selected?.plan ?? null,
    planDigest: selected?.plan?.manifestDigest ?? null,
    approvalCreated: false,
    networkExecuted: false,
    databaseWriteCount: 0,
    productionApplyExecuted: false,
  };
}

export function readN2TrifectaRealPlanPreflight(input: {
  primaryDbPath: string;
  now: string;
  executionLocation?: "Mac self-hosted" | "fixture";
}): N2TrifectaRealPlanPreflightReport {
  const generatedAt = new Date().toISOString();
  const blockers: string[] = [];
  const before = dbMeta(input.primaryDbPath);
  const requestedDateFrom = jstDateFromInstant(input.now) ?? "INVALID";
  if (!before.exists) blockers.push("PRIMARY_DB_NOT_FOUND");
  if (before.walBytes > 0) blockers.push("PRIMARY_DB_ACTIVE_WAL");
  if (!DATE_RE.test(requestedDateFrom)) blockers.push("INVALID_NOW");

  const discovered = new Map<string, { date: string; venueCode: string }>();
  if (blockers.length === 0) {
    const db = openImmutable(input.primaryDbPath);
    try {
      const table = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='official_programs'",
      ).get();
      if (!table) blockers.push("OFFICIAL_PROGRAMS_TABLE_MISSING");
      else {
        const rows = db.prepare(`
          SELECT DISTINCT date, venue
          FROM official_programs
          WHERE date >= ?
          ORDER BY date, venue
        `).all(requestedDateFrom) as unknown as VenueDayRow[];
        const allDates = uniqueSorted(rows.map((row) => row.date));
        const invalidDates = allDates.filter((date) => !isCanonicalCalendarDate(date));
        if (invalidDates.length > 0) {
          blockers.push(...invalidDates.map((date) => `OFFICIAL_PROGRAM_DATE_INVALID:${date}`));
        } else {
          const dates = allDates.slice(0, N2_TRIFECTA_REAL_PLAN_MAX_DATES);
          const dateSet = new Set(dates);
          for (const row of rows) {
            if (!dateSet.has(row.date)) continue;
            const venueCode = officialVenueCode(row.venue);
            if (!venueCode) continue;
            discovered.set(`${row.date}|${venueCode}`, {
              date: row.date,
              venueCode,
            });
          }
        }
      }
    } finally {
      db.close();
    }
  }

  const candidates: N2TrifectaRealPlanCandidate[] = [];
  const candidateBlockerCounts: Record<string, number> = {};
  let blockedCandidatePlanCount = 0;
  for (const item of [...discovered.values()].sort((left, right) => {
    const date = left.date.localeCompare(right.date);
    return date !== 0 ? date : left.venueCode.localeCompare(right.venueCode);
  })) {
    const read = readN2TrifectaPrivateCapturePlan({
      primaryDbPath: input.primaryDbPath,
      date: item.date,
      venueCode: item.venueCode,
    });
    if (read.status === "PASS") {
      candidates.push({
        date: item.date,
        venueCode: item.venueCode,
        sourcePlan: read.plan,
      });
    } else {
      blockedCandidatePlanCount += 1;
      for (const blocker of read.blockers) {
        candidateBlockerCounts[blocker] = (candidateBlockerCounts[blocker] ?? 0) + 1;
      }
    }
  }

  const selection = selectN2TrifectaFuturePlan({
    now: input.now,
    candidates,
  });
  blockers.push(...selection.blockers);

  const after = dbMeta(input.primaryDbPath);
  const metadataUnchanged = JSON.stringify(before) === JSON.stringify(after);
  if (!metadataUnchanged) blockers.push("PRIMARY_DB_METADATA_CHANGED");
  const normalizedBlockers = uniqueSorted(blockers);
  const core = {
    reportVersion: N2_TRIFECTA_REAL_PLAN_PREFLIGHT_VERSION,
    status: normalizedBlockers.length === 0 ? "PASS" as const : "BLOCKED" as const,
    blockers: normalizedBlockers,
    generatedAt,
    now: input.now,
    executionLocation: input.executionLocation ?? "Mac self-hosted" as const,
    source: {
      primaryDbPath: input.primaryDbPath,
      exists: before.exists,
      immutable: true as const,
      readOnly: true as const,
      queryOnly: true as const,
      walBytesBefore: before.walBytes,
      walBytesAfter: after.walBytes,
      bytesBefore: before.bytes,
      bytesAfter: after.bytes,
      modifiedMsBefore: before.modifiedMs,
      modifiedMsAfter: after.modifiedMs,
      metadataUnchanged,
    },
    inventory: {
      requestedDateFrom,
      discoveredDateCount: new Set(
        [...discovered.values()].map((item) => item.date),
      ).size,
      discoveredVenueDayCount: discovered.size,
      readableCandidatePlanCount: candidates.length,
      blockedCandidatePlanCount,
      candidateBlockerCounts: Object.fromEntries(
        Object.entries(candidateBlockerCounts).sort(([left], [right]) => left.localeCompare(right)),
      ),
    },
    selection,
    approvalCreated: false as const,
    networkExecuted: false as const,
    rawPersisted: false as const,
    databaseWriteCount: 0 as const,
    primaryDbWriteCount: 0 as const,
    sidecarWriteCount: 0 as const,
    currentBuyChanged: false as const,
    lineChanged: false as const,
    publicPublished: false as const,
    automatedBettingChanged: false as const,
    productionApplyExecuted: false as const,
  };
  return {
    ...core,
    outputDigest: canonicalHash(core),
  };
}
