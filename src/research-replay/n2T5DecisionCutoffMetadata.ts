import { resolve, sep } from "node:path";
import { readGovernanceFileUtf8Bounded } from "../research/governance/safeFs";

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
  raceIdentity?: unknown;
  checkpointLabel?: unknown;
  envelopeRelativePath?: unknown;
  acceptedAt?: unknown;
};

type CaptureEnvelope = {
  envelopeVersion?: unknown;
  status?: unknown;
  blockers?: unknown;
  entry?: {
    raceIdentity?: unknown;
    checkpointLabel?: unknown;
    decisionCutoff?: unknown;
  };
  databaseWriteAuthorized?: unknown;
  currentBuyConnectionAuthorized?: unknown;
  lineConnectionAuthorized?: unknown;
  publicPublishAuthorized?: unknown;
  productionApplyExecuted?: unknown;
};

const RACE_KEY_RE = /^(\d{4}-\d{2}-\d{2}):(0[1-9]|1\d|2[0-4]):R([1-9]|1[0-2])$/u;
const MAX_MARKER_BYTES = 128 * 1024;
const MAX_ENVELOPE_BYTES = 2_000_000;

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

function cutoffWithinRaceDate(date: string, cutoff: string): boolean {
  if (!isCanonicalIsoInstant(cutoff)) return false;
  const value = Date.parse(cutoff);
  const start = Date.parse(`${date}T00:00:00+09:00`);
  const end = start + 24 * 60 * 60 * 1000;
  return value >= start && value < end;
}

export function readN2T5DecisionCutoffMetadata(input: {
  dataRoot: string;
  raceKeys: readonly string[];
}): N2T5DecisionCutoffMetadataRead {
  const dataRoot = resolve(input.dataRoot);
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
    if (marker.raceIdentity !== location.raceIdentity || marker.checkpointLabel !== "T-5") {
      blockers.push(`${raceKey}:ACCEPTED_MARKER_IDENTITY_INVALID`);
      continue;
    }
    if (typeof marker.acceptedAt !== "string" || !isCanonicalIsoInstant(marker.acceptedAt)) {
      blockers.push(`${raceKey}:ACCEPTED_MARKER_ACCEPTED_AT_INVALID`);
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
      envelope = readJsonBounded<CaptureEnvelope>(
        envelopePath,
        MAX_ENVELOPE_BYTES,
        dataRoot,
      );
      privateEnvelopeMetadataReadCount += 1;
    } catch (error) {
      blockers.push(`${raceKey}:ENVELOPE_${error instanceof Error ? error.message : "INVALID"}`);
      continue;
    }
    if (envelope.envelopeVersion !== "n2-trifecta-private-capture-envelope-v1") blockers.push(`${raceKey}:ENVELOPE_VERSION_INVALID`);
    if (envelope.status !== "PASS" || !Array.isArray(envelope.blockers) || envelope.blockers.length !== 0) {
      blockers.push(`${raceKey}:ENVELOPE_STATUS_INVALID`);
    }
    if (envelope.entry?.raceIdentity !== location.raceIdentity || envelope.entry?.checkpointLabel !== "T-5") {
      blockers.push(`${raceKey}:ENVELOPE_IDENTITY_INVALID`);
    }
    const decisionCutoff = envelope.entry?.decisionCutoff;
    if (typeof decisionCutoff !== "string" || !cutoffWithinRaceDate(location.date, decisionCutoff)) {
      blockers.push(`${raceKey}:DECISION_CUTOFF_INVALID`);
    } else {
      decisionCutoffByRaceKey[raceKey] = decisionCutoff;
    }
    if (envelope.databaseWriteAuthorized !== false
      || envelope.currentBuyConnectionAuthorized !== false
      || envelope.lineConnectionAuthorized !== false
      || envelope.publicPublishAuthorized !== false
      || envelope.productionApplyExecuted !== false) {
      blockers.push(`${raceKey}:ENVELOPE_AUTHORITY_WIDENED`);
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
