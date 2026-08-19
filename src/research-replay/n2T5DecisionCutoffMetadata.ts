import { resolve, sep } from "node:path";
import { readGovernanceFileUtf8Bounded } from "../research/governance/safeFs";
import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import { buildBoatRaceOfficialSourceUrl } from "./n2ExternalSourceCaptureContract";
import {
  N2_TRIFECTA_PRIVATE_CAPTURE_EARLY_WINDOW_SECONDS,
  N2_TRIFECTA_PRIVATE_CAPTURE_LATE_WINDOW_SECONDS,
} from "./n2TrifectaPrivateCaptureExecutor";

export const N2_T5_DECISION_CUTOFF_METADATA_VERSION =
  "n2-t5-decision-cutoff-metadata-v1" as const;

export type N2T5DecisionCutoffMetadataRead = {
  readerVersion: typeof N2_T5_DECISION_CUTOFF_METADATA_VERSION;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  decisionCutoffByRaceKey: Record<string, string>;
  privateEnvelopeMetadataReadCount: number;
  rawOddsValuesRead: false;
  networkRequestCount: 0;
  databaseReadCount: 0;
  databaseWriteCount: 0;
  publicPublishAuthorized: false;
  productionApplyExecuted: false;
};

type AcceptedMarker = {
  markerVersion?: unknown;
  manifestDigest?: unknown;
  checkpointKey?: unknown;
  raceIdentity?: unknown;
  checkpointLabel?: unknown;
  envelopeRelativePath?: unknown;
  acceptedAt?: unknown;
  databaseWriteAuthorized?: unknown;
  productionApplyExecuted?: unknown;
};

type CaptureEnvelope = {
  envelopeVersion?: unknown;
  status?: unknown;
  blockers?: unknown;
  manifestDigest?: unknown;
  checkpointKey?: unknown;
  entry?: {
    raceIdentity?: unknown;
    checkpointLabel?: unknown;
    decisionCutoff?: unknown;
    targetCaptureAt?: unknown;
    sourceUrl?: unknown;
  };
  response?: {
    fetchedAt?: unknown;
  };
  sourceDisplayedUpdate?: {
    availableAt?: unknown;
  };
  databaseWriteAuthorized?: unknown;
  currentBuyConnectionAuthorized?: unknown;
  lineConnectionAuthorized?: unknown;
  publicPublishAuthorized?: unknown;
  productionApplyExecuted?: unknown;
};

type TimestampMode = "producer-canonical" | "canonicalizable-explicit-zone";

const RACE_KEY_RE = /^(\d{4}-\d{2}-\d{2}):(0[1-9]|1\d|2[0-4]):R([1-9]|1[0-2])$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const MAX_MARKER_BYTES = 128 * 1024;
const MAX_ENVELOPE_BYTES = 2_000_000;
const T5_CHECKPOINT_MINUTES = 5;

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

function readJsonBounded<T>(path: string, maxBytes: number, trustedRoot: string): T {
  try {
    const { text, bytes } = readGovernanceFileUtf8Bounded(path, maxBytes, trustedRoot);
    if (bytes <= 0) throw new Error("PRIVATE_METADATA_EMPTY");
    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("PRIVATE_METADATA_JSON_INVALID");
    if (error instanceof Error && error.message === "PRIVATE_METADATA_EMPTY") throw error;
    throw new Error("PRIVATE_METADATA_READ_INVALID");
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function isCanonicalCalendarDate(date: string): boolean {
  const value = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === date;
}

function isCanonicalIsoInstant(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function canonicalInstant(value: unknown, mode: TimestampMode): string | null {
  if (typeof value !== "string") return null;
  if (mode === "producer-canonical") return isCanonicalIsoInstant(value) ? value : null;
  try {
    return canonicalUtcTimestamp(value);
  } catch {
    return null;
  }
}

function expectedMetadataLocation(raceKey: string): {
  date: string;
  venue: string;
  raceDir: string;
  raceIdentity: string;
  directory: string;
} | null {
  const match = RACE_KEY_RE.exec(raceKey);
  if (!match || !isCanonicalCalendarDate(match[1])) return null;
  const raceDir = String(Number(match[3])).padStart(2, "0");
  return {
    date: match[1],
    venue: match[2],
    raceDir,
    raceIdentity: `${match[1].replaceAll("-", "")}-${match[2]}-${raceDir}`,
    directory: `data/raw/research/trifecta-market/${match[1]}/${match[2]}/${raceDir}/T-5`,
  };
}

function instantWithinRaceDate(date: string, instant: string): boolean {
  const value = Date.parse(instant);
  const start = Date.parse(`${date}T00:00:00+09:00`);
  const end = start + 24 * 60 * 60 * 1000;
  return Number.isFinite(value) && value >= start && value < end;
}

function expectedT5CheckpointIdentity(input: {
  manifestDigest: string;
  raceIdentity: string;
  date: string;
  venue: string;
  raceNo: number;
  decisionCutoff: string;
}): { checkpointKey: string; targetCaptureAt: string; sourceUrl: string } | null {
  const cutoffMs = Date.parse(input.decisionCutoff);
  if (!Number.isFinite(cutoffMs)) return null;
  const targetCaptureAt = new Date(cutoffMs - T5_CHECKPOINT_MINUTES * 60_000).toISOString();
  let sourceUrl: string;
  try {
    sourceUrl = buildBoatRaceOfficialSourceUrl(
      "boatrace_official_trifecta_odds_html",
      {
        date: input.date.replaceAll("-", ""),
        venueCode: input.venue,
        raceNo: input.raceNo,
      },
    );
  } catch {
    return null;
  }
  return {
    checkpointKey: canonicalHash({
      manifestDigest: input.manifestDigest,
      raceIdentity: input.raceIdentity,
      checkpointLabel: "T-5",
      targetCaptureAt,
      sourceUrl,
    }),
    targetCaptureAt,
    sourceUrl,
  };
}

function captureWithinT5Window(decisionCutoff: string, capturedAt: string): boolean {
  const cutoffMs = Date.parse(decisionCutoff);
  const capturedMs = Date.parse(capturedAt);
  if (!Number.isFinite(cutoffMs) || !Number.isFinite(capturedMs)) return false;
  const targetMs = cutoffMs - T5_CHECKPOINT_MINUTES * 60_000;
  return capturedMs >= targetMs - N2_TRIFECTA_PRIVATE_CAPTURE_EARLY_WINDOW_SECONDS * 1_000
    && capturedMs <= targetMs + N2_TRIFECTA_PRIVATE_CAPTURE_LATE_WINDOW_SECONDS * 1_000;
}

export function readN2T5DecisionCutoffMetadata(input: {
  dataRoot: string;
  raceKeys: readonly string[];
  timestampMode?: TimestampMode;
}): N2T5DecisionCutoffMetadataRead {
  const dataRoot = resolve(input.dataRoot);
  const timestampMode = input.timestampMode ?? "canonicalizable-explicit-zone";
  const blockers: string[] = [];
  const decisionCutoffByRaceKey: Record<string, string> = {};
  let privateEnvelopeMetadataReadCount = 0;
  for (const raceKey of [...new Set(input.raceKeys)].sort()) {
    const location = expectedMetadataLocation(raceKey);
    if (!location) {
      blockers.push(`${raceKey}:RACE_KEY_INVALID`);
      continue;
    }
    let marker: AcceptedMarker;
    try {
      marker = readJsonBounded<AcceptedMarker>(
        resolveInside(dataRoot, `${location.directory}/accepted.json`),
        MAX_MARKER_BYTES,
        dataRoot,
      );
    } catch (error) {
      blockers.push(`${raceKey}:ACCEPTED_MARKER_${error instanceof Error ? error.message : "INVALID"}`);
      continue;
    }
    if (marker.markerVersion !== "n2-trifecta-private-capture-accepted-v1") {
      blockers.push(`${raceKey}:ACCEPTED_MARKER_VERSION_INVALID`);
      continue;
    }
    if (typeof marker.manifestDigest !== "string" || !SHA256_RE.test(marker.manifestDigest)
      || typeof marker.checkpointKey !== "string" || !SHA256_RE.test(marker.checkpointKey)) {
      blockers.push(`${raceKey}:ACCEPTED_MARKER_LINEAGE_INVALID`);
      continue;
    }
    if (marker.raceIdentity !== location.raceIdentity || marker.checkpointLabel !== "T-5") {
      blockers.push(`${raceKey}:ACCEPTED_MARKER_IDENTITY_INVALID`);
      continue;
    }
    const acceptedAt = canonicalInstant(marker.acceptedAt, timestampMode);
    if (acceptedAt == null || !instantWithinRaceDate(location.date, acceptedAt)) {
      blockers.push(`${raceKey}:ACCEPTED_MARKER_ACCEPTED_AT_INVALID`);
      continue;
    }
    if (marker.databaseWriteAuthorized !== false || marker.productionApplyExecuted !== false) {
      blockers.push(`${raceKey}:ACCEPTED_MARKER_AUTHORITY_WIDENED`);
      continue;
    }
    if (typeof marker.envelopeRelativePath !== "string"
      || !marker.envelopeRelativePath.startsWith(`${location.directory}/`)
      || !marker.envelopeRelativePath.endsWith(".envelope.json")) {
      blockers.push(`${raceKey}:ENVELOPE_PATH_INVALID`);
      continue;
    }

    let envelopePath: string | null = null;
    try {
      envelopePath = resolveInsideExpectedDirectory(
        dataRoot,
        marker.envelopeRelativePath,
        location.directory,
      );
    } catch {
      envelopePath = null;
    }
    if (!envelopePath) {
      blockers.push(`${raceKey}:ENVELOPE_PATH_INVALID`);
      continue;
    }

    let envelope: CaptureEnvelope;
    try {
      privateEnvelopeMetadataReadCount += 1;
      envelope = readJsonBounded<CaptureEnvelope>(
        envelopePath,
        MAX_ENVELOPE_BYTES,
        dataRoot,
      );
    } catch (error) {
      blockers.push(`${raceKey}:ENVELOPE_${error instanceof Error ? error.message : "INVALID"}`);
      continue;
    }
    if (envelope.envelopeVersion !== "n2-trifecta-private-capture-envelope-v1") blockers.push(`${raceKey}:ENVELOPE_VERSION_INVALID`);
    if (envelope.status !== "PASS" || !Array.isArray(envelope.blockers) || envelope.blockers.length !== 0) {
      blockers.push(`${raceKey}:ENVELOPE_STATUS_INVALID`);
    }
    if (envelope.manifestDigest !== marker.manifestDigest || envelope.checkpointKey !== marker.checkpointKey) {
      blockers.push(`${raceKey}:ENVELOPE_LINEAGE_MISMATCH`);
    }
    if (envelope.entry?.raceIdentity !== location.raceIdentity || envelope.entry?.checkpointLabel !== "T-5") {
      blockers.push(`${raceKey}:ENVELOPE_IDENTITY_INVALID`);
    }
    const decisionCutoff = canonicalInstant(envelope.entry?.decisionCutoff, timestampMode);
    const capturedAt = canonicalInstant(envelope.response?.fetchedAt, timestampMode);
    const availableAt = canonicalInstant(envelope.sourceDisplayedUpdate?.availableAt, timestampMode);
    if (decisionCutoff == null || !instantWithinRaceDate(location.date, decisionCutoff)) {
      blockers.push(`${raceKey}:DECISION_CUTOFF_INVALID`);
    } else {
      const expectedCheckpointIdentity = expectedT5CheckpointIdentity({
        manifestDigest: marker.manifestDigest,
        raceIdentity: location.raceIdentity,
        date: location.date,
        venue: location.venue,
        raceNo: Number(location.raceDir),
        decisionCutoff,
      });
      if (expectedCheckpointIdentity == null
        || marker.checkpointKey !== expectedCheckpointIdentity.checkpointKey
        || envelope.checkpointKey !== expectedCheckpointIdentity.checkpointKey) {
        blockers.push(`${raceKey}:CHECKPOINT_KEY_INVALID`);
      }
      const envelopeTargetCaptureAt = canonicalInstant(envelope.entry?.targetCaptureAt, timestampMode);
      if (expectedCheckpointIdentity == null
        || envelopeTargetCaptureAt !== expectedCheckpointIdentity.targetCaptureAt) {
        blockers.push(`${raceKey}:ENVELOPE_TARGET_CAPTURE_AT_INVALID`);
      }
      if (expectedCheckpointIdentity == null
        || envelope.entry?.sourceUrl !== expectedCheckpointIdentity.sourceUrl) {
        blockers.push(`${raceKey}:ENVELOPE_SOURCE_URL_INVALID`);
      }
    }
    if (capturedAt == null) blockers.push(`${raceKey}:CAPTURED_AT_INVALID`);
    if (availableAt == null) blockers.push(`${raceKey}:AVAILABLE_AT_INVALID`);
    if (decisionCutoff != null && capturedAt != null && !captureWithinT5Window(decisionCutoff, capturedAt)) {
      blockers.push(`${raceKey}:CAPTURE_OUTSIDE_CHECKPOINT_WINDOW`);
    }
    if (decisionCutoff != null && capturedAt != null && Date.parse(capturedAt) > Date.parse(decisionCutoff)) {
      blockers.push(`${raceKey}:CAPTURE_AFTER_DECISION_CUTOFF`);
    }
    if (decisionCutoff != null && availableAt != null && Date.parse(availableAt) > Date.parse(decisionCutoff)) {
      blockers.push(`${raceKey}:AVAILABLE_AFTER_DECISION_CUTOFF`);
    }
    if (capturedAt != null && availableAt != null && Date.parse(availableAt) > Date.parse(capturedAt)) {
      blockers.push(`${raceKey}:AVAILABLE_AFTER_CAPTURE`);
    }
    if (envelope.databaseWriteAuthorized !== false
      || envelope.currentBuyConnectionAuthorized !== false
      || envelope.lineConnectionAuthorized !== false
      || envelope.publicPublishAuthorized !== false
      || envelope.productionApplyExecuted !== false) {
      blockers.push(`${raceKey}:ENVELOPE_AUTHORITY_WIDENED`);
    }
    const raceBlockerPrefix = `${raceKey}:`;
    if (!blockers.some((blocker) => blocker.startsWith(raceBlockerPrefix)) && decisionCutoff != null) {
      decisionCutoffByRaceKey[raceKey] = decisionCutoff;
    }
  }
  const normalizedBlockers = unique(blockers);
  return {
    readerVersion: N2_T5_DECISION_CUTOFF_METADATA_VERSION,
    status: normalizedBlockers.length === 0
      && Object.keys(decisionCutoffByRaceKey).length === new Set(input.raceKeys).size
      ? "PASS"
      : "BLOCKED",
    blockers: normalizedBlockers,
    decisionCutoffByRaceKey: normalizedBlockers.length === 0 ? decisionCutoffByRaceKey : {},
    privateEnvelopeMetadataReadCount,
    rawOddsValuesRead: false,
    networkRequestCount: 0,
    databaseReadCount: 0,
    databaseWriteCount: 0,
    publicPublishAuthorized: false,
    productionApplyExecuted: false,
  };
}
