import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";

import { canonicalHash, canonicalUtcTimestamp } from "./canonical";

export const N2_TRIFECTA_PRIVATE_HEARTBEAT_VERSION =
  "n2-trifecta-private-heartbeat-v1" as const;

export type N2TrifectaPrivateHeartbeatRecord = {
  heartbeatVersion: typeof N2_TRIFECTA_PRIVATE_HEARTBEAT_VERSION;
  recordedAt: string;
  dateJst: string | null;
  status: "PASS" | "NO_CHANGE" | "BLOCKED";
  blockers: string[];
  authoritySha: string | null;
  runtimeAuthorityStatus: "PASS" | "BLOCKED";
  selectedVenueCode: string | null;
  selectedRaceIdentity: string | null;
  selectedCheckpointLabel: string | null;
  dueEntryCount: number;
  networkRequestCount: number;
  capturedCount: number;
  blockedEvidenceCount: number;
  databaseWriteCount: 0;
  primaryDbWriteCount: 0;
  sidecarWriteCount: 0;
  rawOddsValuesRecorded: false;
  currentBuyChanged: false;
  lineChanged: false;
  publicPublished: false;
  automatedBettingChanged: false;
  productionApplyExecuted: false;
  recordDigest: string;
};

function parseInstant(value: string): number | null {
  try {
    return Date.parse(canonicalUtcTimestamp(value));
  } catch {
    return null;
  }
}

function jstDate(value: string): string | null {
  const parsed = parseInstant(value);
  if (parsed == null) return null;
  return new Date(parsed + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

function resolveInside(rootDir: string, relativePath: string): string {
  if (relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new Error("UNSAFE_RELATIVE_PATH");
  }
  const root = resolve(rootDir);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("PATH_ESCAPES_ROOT");
  }
  return target;
}

export function n2TrifectaPrivateHeartbeatRelativePath(recordedAt: string): string {
  const date = jstDate(recordedAt);
  if (!date) throw new Error("HEARTBEAT_RECORDED_AT_INVALID");
  return `data/private/trifecta-capture/heartbeats/${date}.jsonl`;
}

export function buildN2TrifectaPrivateHeartbeatRecord(input: {
  recordedAt: string;
  status: "PASS" | "NO_CHANGE" | "BLOCKED";
  blockers?: string[];
  authoritySha?: string | null;
  runtimeAuthorityStatus: "PASS" | "BLOCKED";
  selectedVenueCode?: string | null;
  selectedRaceIdentity?: string | null;
  selectedCheckpointLabel?: string | null;
  dueEntryCount?: number;
  networkRequestCount?: number;
  capturedCount?: number;
  blockedEvidenceCount?: number;
}): N2TrifectaPrivateHeartbeatRecord {
  const dateJst = jstDate(input.recordedAt);
  if (!dateJst) throw new Error("HEARTBEAT_RECORDED_AT_INVALID");
  const nonNegativeInteger = (value: number | undefined, code: string): number => {
    const normalized = value ?? 0;
    if (!Number.isSafeInteger(normalized) || normalized < 0) throw new Error(code);
    return normalized;
  };
  const core = {
    heartbeatVersion: N2_TRIFECTA_PRIVATE_HEARTBEAT_VERSION,
    recordedAt: input.recordedAt,
    dateJst,
    status: input.status,
    blockers: [...new Set(input.blockers ?? [])].sort(),
    authoritySha: input.authoritySha ?? null,
    runtimeAuthorityStatus: input.runtimeAuthorityStatus,
    selectedVenueCode: input.selectedVenueCode ?? null,
    selectedRaceIdentity: input.selectedRaceIdentity ?? null,
    selectedCheckpointLabel: input.selectedCheckpointLabel ?? null,
    dueEntryCount: nonNegativeInteger(input.dueEntryCount, "HEARTBEAT_DUE_COUNT_INVALID"),
    networkRequestCount: nonNegativeInteger(input.networkRequestCount, "HEARTBEAT_NETWORK_COUNT_INVALID"),
    capturedCount: nonNegativeInteger(input.capturedCount, "HEARTBEAT_CAPTURED_COUNT_INVALID"),
    blockedEvidenceCount: nonNegativeInteger(
      input.blockedEvidenceCount,
      "HEARTBEAT_BLOCKED_EVIDENCE_COUNT_INVALID",
    ),
    databaseWriteCount: 0 as const,
    primaryDbWriteCount: 0 as const,
    sidecarWriteCount: 0 as const,
    rawOddsValuesRecorded: false as const,
    currentBuyChanged: false as const,
    lineChanged: false as const,
    publicPublished: false as const,
    automatedBettingChanged: false as const,
    productionApplyExecuted: false as const,
  };
  return { ...core, recordDigest: canonicalHash(core) };
}

export function appendN2TrifectaPrivateHeartbeat(input: {
  dataRoot: string;
  record: N2TrifectaPrivateHeartbeatRecord;
}): string {
  const relativePath = n2TrifectaPrivateHeartbeatRelativePath(input.record.recordedAt);
  const path = resolveInside(input.dataRoot, relativePath);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error("HEARTBEAT_SYMLINK_NOT_ALLOWED");
  }
  const fd = openSync(path, "a", 0o600);
  try {
    appendFileSync(fd, `${JSON.stringify(input.record)}\n`, "utf8");
  } finally {
    closeSync(fd);
  }
  chmodSync(path, 0o600);
  return relativePath;
}
