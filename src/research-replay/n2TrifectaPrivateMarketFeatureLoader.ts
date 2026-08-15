import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  statSync,
} from "node:fs";
import { resolve, sep } from "node:path";

import { parseAllTrifectaOdds } from "../domain/oddsParser";
import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import type { N2TrifectaPrivateCaptureEnvelope } from "./n2TrifectaPrivateCaptureExecutor";
import {
  N2_TRIFECTA_MARKET_CHECKPOINTS,
  buildN2TrifectaMarketRaceFeatureSequence,
  type N2TrifectaMarketCheckpointLabel,
  type N2TrifectaMarketRaceFeatureSequence,
  type N2TrifectaMarketSnapshotInput,
} from "./n2TrifectaMarketFeatureEngineering";

export const N2_TRIFECTA_PRIVATE_MARKET_FEATURE_LOADER_VERSION =
  "n2-trifecta-private-market-feature-loader-v1" as const;

export type N2TrifectaPrivateMarketFeatureLoaderInput = {
  rootDir: string;
  date: string;
  venueCode: string;
  raceNo: number;
};

export type N2TrifectaPrivateMarketFeatureLoadReport = {
  loaderVersion: typeof N2_TRIFECTA_PRIVATE_MARKET_FEATURE_LOADER_VERSION;
  status: "PASS" | "PARTIAL" | "NO_DATA" | "BLOCKED";
  blockers: string[];
  date: string;
  venueCode: string;
  raceNo: number;
  raceIdentity: string;
  acceptedMarkerCount: number;
  loadedSnapshotCount: number;
  sequence: N2TrifectaMarketRaceFeatureSequence;
  networkRequestCount: 0;
  databaseReadCount: 0;
  databaseWriteCount: 0;
  rawValuesReadPrivately: boolean;
  rawValuesPublished: false;
  privateResearchOnly: true;
  publicPublishAuthorized: false;
  outputDigest: string;
};

type AcceptedMarker = {
  markerVersion: "n2-trifecta-private-capture-accepted-v1";
  manifestDigest: string;
  checkpointKey: string;
  raceIdentity: string;
  checkpointLabel: N2TrifectaMarketCheckpointLabel;
  rawDocumentId: string;
  rawSha256: string;
  rawRelativePath: string;
  envelopeRelativePath: string;
  acceptedAt: string;
  databaseWriteAuthorized: false;
  productionApplyExecuted: false;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const VENUE_RE = /^(0[1-9]|1\d|2[0-4])$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const MAX_PRIVATE_JSON_BYTES = 2_000_000;
const MAX_PRIVATE_RAW_BYTES = 2_000_000;

function unique(values: string[]): string[] {
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

function readJsonBounded<T>(path: string): T {
  const lstat = lstatSync(path);
  if (lstat.isSymbolicLink() || !lstat.isFile()) {
    throw new Error("PRIVATE_JSON_FILE_TYPE_INVALID");
  }
  const stat = statSync(path);
  if (stat.size <= 0 || stat.size > MAX_PRIVATE_JSON_BYTES) {
    throw new Error("PRIVATE_JSON_SIZE_INVALID");
  }
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isCanonicalIsoInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return canonicalUtcTimestamp(value) === value;
  } catch {
    return false;
  }
}

function isCanonicalCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function raceIdentity(input: N2TrifectaPrivateMarketFeatureLoaderInput): string {
  return `${input.date.replaceAll("-", "")}-${input.venueCode}-${String(input.raceNo).padStart(2, "0")}`;
}

function checkpointDirectory(
  input: N2TrifectaPrivateMarketFeatureLoaderInput,
  checkpointLabel: N2TrifectaMarketCheckpointLabel,
): string {
  return [
    "data",
    "raw",
    "research",
    "trifecta-market",
    input.date,
    input.venueCode,
    String(input.raceNo).padStart(2, "0"),
    checkpointLabel,
  ].join("/");
}

function validateInput(input: N2TrifectaPrivateMarketFeatureLoaderInput): string[] {
  const blockers: string[] = [];
  if (!isCanonicalCalendarDate(input.date)) blockers.push("DATE_INVALID");
  if (!VENUE_RE.test(input.venueCode)) blockers.push("VENUE_CODE_INVALID");
  if (!Number.isSafeInteger(input.raceNo) || input.raceNo < 1 || input.raceNo > 12) {
    blockers.push("RACE_NO_INVALID");
  }
  return blockers;
}

function loadCheckpoint(
  input: N2TrifectaPrivateMarketFeatureLoaderInput,
  checkpointLabel: N2TrifectaMarketCheckpointLabel,
): { status: "MISSING" | "PASS" | "BLOCKED"; blockers: string[]; snapshot: N2TrifectaMarketSnapshotInput | null } {
  const blockers: string[] = [];
  const expectedRaceIdentity = raceIdentity(input);
  const directory = checkpointDirectory(input, checkpointLabel);
  const markerRelativePath = `${directory}/accepted.json`;
  const markerPath = resolveInside(input.rootDir, markerRelativePath);
  if (!existsSync(markerPath)) return { status: "MISSING", blockers: [], snapshot: null };

  let marker: AcceptedMarker;
  try {
    marker = readJsonBounded<AcceptedMarker>(markerPath);
  } catch (error) {
    return {
      status: "BLOCKED",
      blockers: [`ACCEPTED_MARKER_${error instanceof Error ? error.message : "INVALID"}`],
      snapshot: null,
    };
  }
  if (marker.markerVersion !== "n2-trifecta-private-capture-accepted-v1") {
    blockers.push("ACCEPTED_MARKER_VERSION_MISMATCH");
  }
  if (marker.raceIdentity !== expectedRaceIdentity) blockers.push("ACCEPTED_RACE_IDENTITY_MISMATCH");
  if (marker.checkpointLabel !== checkpointLabel) blockers.push("ACCEPTED_CHECKPOINT_MISMATCH");
  if (!SHA256_RE.test(marker.rawSha256)) blockers.push("ACCEPTED_RAW_SHA256_INVALID");
  if (!isCanonicalIsoInstant(marker.acceptedAt)) blockers.push("ACCEPTED_AT_INVALID");
  if (marker.databaseWriteAuthorized !== false) blockers.push("ACCEPTED_DATABASE_BOUNDARY_WIDENED");
  if (marker.productionApplyExecuted !== false) blockers.push("ACCEPTED_PRODUCTION_APPLY_CHANGED");
  if (typeof marker.rawRelativePath !== "string" || !marker.rawRelativePath.startsWith(`${directory}/`)
    || !marker.rawRelativePath.endsWith(".html")) {
    blockers.push("ACCEPTED_RAW_PATH_INVALID");
  }
  if (typeof marker.envelopeRelativePath !== "string"
    || !marker.envelopeRelativePath.startsWith(`${directory}/`)
    || !marker.envelopeRelativePath.endsWith(".envelope.json")) {
    blockers.push("ACCEPTED_ENVELOPE_PATH_INVALID");
  }
  if (blockers.length > 0) return { status: "BLOCKED", blockers: unique(blockers), snapshot: null };

  let rawPath: string;
  let envelopePath: string;
  try {
    rawPath = resolveInside(input.rootDir, marker.rawRelativePath);
    envelopePath = resolveInside(input.rootDir, marker.envelopeRelativePath);
  } catch (error) {
    return {
      status: "BLOCKED",
      blockers: [error instanceof Error ? error.message : "PRIVATE_PATH_INVALID"],
      snapshot: null,
    };
  }
  if (!existsSync(rawPath)) blockers.push("PRIVATE_RAW_FILE_MISSING");
  if (!existsSync(envelopePath)) blockers.push("PRIVATE_ENVELOPE_FILE_MISSING");
  if (blockers.length > 0) return { status: "BLOCKED", blockers: unique(blockers), snapshot: null };

  const rawStat = lstatSync(rawPath);
  if (rawStat.isSymbolicLink() || !rawStat.isFile()) blockers.push("PRIVATE_RAW_FILE_TYPE_INVALID");
  if (rawStat.size <= 0 || rawStat.size > MAX_PRIVATE_RAW_BYTES) blockers.push("PRIVATE_RAW_SIZE_INVALID");
  if (blockers.length > 0) return { status: "BLOCKED", blockers: unique(blockers), snapshot: null };

  const rawBytes = readFileSync(rawPath);
  const actualSha256 = sha256(rawBytes);
  if (actualSha256 !== marker.rawSha256) blockers.push("PRIVATE_RAW_SHA256_MISMATCH");

  let envelope: N2TrifectaPrivateCaptureEnvelope;
  try {
    envelope = readJsonBounded<N2TrifectaPrivateCaptureEnvelope>(envelopePath);
  } catch (error) {
    blockers.push(`PRIVATE_ENVELOPE_${error instanceof Error ? error.message : "INVALID"}`);
    return { status: "BLOCKED", blockers: unique(blockers), snapshot: null };
  }
  if (envelope.envelopeVersion !== "n2-trifecta-private-capture-envelope-v1") {
    blockers.push("PRIVATE_ENVELOPE_VERSION_MISMATCH");
  }
  if (envelope.status !== "PASS" || envelope.blockers.length > 0) blockers.push("PRIVATE_ENVELOPE_NOT_PASS");
  if (envelope.entry.raceIdentity !== expectedRaceIdentity) blockers.push("PRIVATE_ENVELOPE_RACE_MISMATCH");
  if (envelope.entry.checkpointLabel !== checkpointLabel) blockers.push("PRIVATE_ENVELOPE_CHECKPOINT_MISMATCH");
  if (envelope.response.rawSha256 !== marker.rawSha256) blockers.push("PRIVATE_ENVELOPE_SHA_MISMATCH");
  if (envelope.rawRelativePath !== marker.rawRelativePath) blockers.push("PRIVATE_ENVELOPE_RAW_PATH_MISMATCH");
  if (envelope.envelopeRelativePath !== marker.envelopeRelativePath) blockers.push("PRIVATE_ENVELOPE_PATH_MISMATCH");
  if (envelope.parsedSelectionCount !== 120 || envelope.unavailableSelectionCount !== 0) {
    blockers.push("PRIVATE_ENVELOPE_SELECTION_AUDIT_INVALID");
  }
  if (envelope.snapshotAudit?.status !== "PASS") blockers.push("PRIVATE_SNAPSHOT_AUDIT_NOT_PASS");
  if (envelope.databaseWriteAuthorized !== false
    || envelope.currentBuyConnectionAuthorized !== false
    || envelope.lineConnectionAuthorized !== false
    || envelope.publicPublishAuthorized !== false
    || envelope.productionApplyExecuted !== false) {
    blockers.push("PRIVATE_ENVELOPE_BOUNDARY_WIDENED");
  }
  const availableAt = envelope.sourceDisplayedUpdate.availableAt;
  if (typeof availableAt !== "string") blockers.push("PRIVATE_AVAILABLE_AT_MISSING");
  if (blockers.length > 0) return { status: "BLOCKED", blockers: unique(blockers), snapshot: null };

  const odds = parseAllTrifectaOdds(rawBytes.toString("utf8"));
  if (odds.size !== 120) {
    return { status: "BLOCKED", blockers: ["PRIVATE_REPARSE_SELECTION_COUNT_NOT_120"], snapshot: null };
  }
  return {
    status: "PASS",
    blockers: [],
    snapshot: {
      raceIdentity: expectedRaceIdentity,
      checkpointLabel,
      capturedAt: envelope.response.fetchedAt,
      availableAt: availableAt!,
      odds,
    },
  };
}

export function loadN2TrifectaPrivateMarketFeatures(
  input: N2TrifectaPrivateMarketFeatureLoaderInput,
): N2TrifectaPrivateMarketFeatureLoadReport {
  const inputBlockers = validateInput(input);
  const identity = raceIdentity(input);
  if (inputBlockers.length > 0) {
    const sequence = buildN2TrifectaMarketRaceFeatureSequence([]);
    const core = {
      loaderVersion: N2_TRIFECTA_PRIVATE_MARKET_FEATURE_LOADER_VERSION,
      status: "BLOCKED" as const,
      blockers: unique(inputBlockers),
      date: input.date,
      venueCode: input.venueCode,
      raceNo: input.raceNo,
      raceIdentity: identity,
      acceptedMarkerCount: 0,
      loadedSnapshotCount: 0,
      sequence,
      networkRequestCount: 0 as const,
      databaseReadCount: 0 as const,
      databaseWriteCount: 0 as const,
      rawValuesReadPrivately: false,
      rawValuesPublished: false as const,
      privateResearchOnly: true as const,
      publicPublishAuthorized: false as const,
    };
    return { ...core, outputDigest: canonicalHash(core) };
  }

  const blockers: string[] = [];
  const snapshots: N2TrifectaMarketSnapshotInput[] = [];
  let acceptedMarkerCount = 0;
  for (const checkpointLabel of N2_TRIFECTA_MARKET_CHECKPOINTS) {
    const markerPath = resolveInside(
      input.rootDir,
      `${checkpointDirectory(input, checkpointLabel)}/accepted.json`,
    );
    if (existsSync(markerPath)) acceptedMarkerCount += 1;
    const loaded = loadCheckpoint(input, checkpointLabel);
    if (loaded.status === "BLOCKED") {
      blockers.push(...loaded.blockers.map((blocker) => `${checkpointLabel}_${blocker}`));
    } else if (loaded.status === "PASS" && loaded.snapshot) {
      snapshots.push(loaded.snapshot);
    }
  }
  const normalizedBlockers = unique(blockers);
  const sequence = buildN2TrifectaMarketRaceFeatureSequence(snapshots);
  if (sequence.status === "BLOCKED") {
    normalizedBlockers.push(...sequence.blockers.map((blocker) => `FEATURE_${blocker}`));
  }
  const finalBlockers = unique(normalizedBlockers);
  const status = finalBlockers.length > 0
    ? "BLOCKED" as const
    : sequence.status;
  const core = {
    loaderVersion: N2_TRIFECTA_PRIVATE_MARKET_FEATURE_LOADER_VERSION,
    status,
    blockers: finalBlockers,
    date: input.date,
    venueCode: input.venueCode,
    raceNo: input.raceNo,
    raceIdentity: identity,
    acceptedMarkerCount,
    loadedSnapshotCount: snapshots.length,
    sequence,
    networkRequestCount: 0 as const,
    databaseReadCount: 0 as const,
    databaseWriteCount: 0 as const,
    rawValuesReadPrivately: snapshots.length > 0,
    rawValuesPublished: false as const,
    privateResearchOnly: true as const,
    publicPublishAuthorized: false as const,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}
