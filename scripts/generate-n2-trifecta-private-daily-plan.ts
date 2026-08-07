import {
  existsSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { officialVenueCode } from "../src/domain/officialLinks";
import {
  buildN2TrifectaPrivateDailyPlanCache,
  buildN2TrifectaPrivateDailyPlanSourceEvidence,
  writeN2TrifectaPrivateDailyPlanCache,
} from "../src/research-replay/n2TrifectaPrivateDailyPlanCache";
import { readN2TrifectaPrivateCapturePlan } from "../src/research-replay/n2TrifectaPrivateCapturePlanReader";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VENUE_RE = /^(0[1-9]|1\d|2[0-4])$/;

type DbMeta = {
  bytes: number;
  modifiedMs: number;
  walBytes: number;
};

type VenueRow = { venue: string };

function jstDate(value: Date): string {
  return new Date(value.getTime() + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
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
    return [...new Set(
      rows
        .map((row) => officialVenueCode(row.venue))
        .filter((venueCode): venueCode is string => venueCode != null && VENUE_RE.test(venueCode)),
    )].sort();
  } finally {
    db.close();
  }
}

function errorCode(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.trim().replaceAll(/[^A-Za-z0-9_]+/gu, "_").toUpperCase().slice(0, 160)
    || "UNKNOWN_ERROR";
}

const repoRoot = resolve(process.cwd());
const dataRoot = resolve(process.env.BOAT_PON_DATA_ROOT?.trim() || repoRoot);
const primaryDbPath = resolve(
  process.env.BOAT_PON_PRIMARY_DB_PATH?.trim() || `${dataRoot}/data/boat.sqlite`,
);
const now = new Date();
const today = jstDate(now);
const requestedDate = process.argv[2]?.trim() || today;

const boundary = {
  databaseWriteCount: 0 as const,
  primaryDbWriteCount: 0 as const,
  sidecarWriteCount: 0 as const,
  currentBuyChanged: false as const,
  lineChanged: false as const,
  publicPublished: false as const,
  automatedBettingChanged: false as const,
  productionApplyExecuted: false as const,
  rawOddsPublished: false as const,
};

try {
  if (!DATE_RE.test(requestedDate)) throw new Error("INVALID_DATE");
  if (requestedDate !== today) throw new Error("ONLY_CURRENT_JST_DATE_ALLOWED");

  const before = dbMeta(primaryDbPath);
  const source = buildN2TrifectaPrivateDailyPlanSourceEvidence({
    primaryDbBytes: before.bytes,
    primaryDbModifiedMs: before.modifiedMs,
    primaryDbWalBytes: before.walBytes,
  });
  const venueCodes = discoverVenueCodes(primaryDbPath, requestedDate);
  if (venueCodes.length === 0) throw new Error("CURRENT_DAY_VENUE_INVENTORY_EMPTY");

  const planResults = venueCodes.map((venueCode) => readN2TrifectaPrivateCapturePlan({
    primaryDbPath,
    date: requestedDate,
    venueCode,
  }));
  const plans = planResults
    .filter((result) => result.status === "PASS")
    .map((result) => result.plan);
  const incompleteVenueCount = planResults.length - plans.length;

  const cache = buildN2TrifectaPrivateDailyPlanCache({
    date: requestedDate,
    generatedAt: now.toISOString(),
    plans,
    source,
  });
  const relativePath = writeN2TrifectaPrivateDailyPlanCache({ dataRoot, cache });

  const after = dbMeta(primaryDbPath);
  const primaryDbMetadataUnchanged = before.bytes === after.bytes
    && before.modifiedMs === after.modifiedMs
    && before.walBytes === after.walBytes;
  if (!primaryDbMetadataUnchanged) throw new Error("PRIMARY_DB_METADATA_CHANGED");

  console.log(JSON.stringify({
    reportVersion: "n2-trifecta-private-daily-plan-generation-v1",
    status: "PASS",
    date: requestedDate,
    venueInventoryCount: venueCodes.length,
    completeVenuePlanCount: plans.length,
    incompleteVenueCount,
    selectedVenueCode: cache.venueCode,
    selectedRaceCount: cache.plan.raceCount,
    selectedCheckpointCount: cache.plan.entries.length,
    requestBudget: cache.plan.requestBudget,
    sourcePlanDigest: cache.sourcePlanDigest,
    sourceDbFingerprintDigest: cache.source.metadataFingerprintDigest,
    cacheDigest: cache.cacheDigest,
    relativePath,
    primaryDbMetadataUnchanged,
    ...boundary,
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    reportVersion: "n2-trifecta-private-daily-plan-generation-v1",
    status: "BLOCKED",
    date: requestedDate,
    blocker: errorCode(error),
    ...boundary,
  }, null, 2));
  process.exitCode = 3;
}
