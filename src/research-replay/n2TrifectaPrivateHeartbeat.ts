import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  statSync,
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

function canonicalInstant(value: string): string | null {
  try {
    return canonicalUtcTimestamp(value);
  } catch {
    return null;
  }
}

function parseInstant(value: string): number | null {
  const canonical = canonicalInstant(value);
  if (canonical == null) return null;
  const parsed = Date.parse(canonical);
  return Number.isFinite(parsed) ? parsed : null;
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
  const recordedAt = canonicalInstant(input.recordedAt);
  if (!recordedAt) throw new Error("HEARTBEAT_RECORDED_AT_INVALID");
  const dateJst = jstDate(recordedAt);
  if (!dateJst) throw new Error("HEARTBEAT_RECORDED_AT_INVALID");
  const nonNegativeInteger = (value: number | undefined, code: string): number => {
    const normalized = value ?? 0;
    if (!Number.isSafeInteger(normalized) || normalized < 0) throw new Error(code);
    return normalized;
  };
  const core = {
    heartbeatVersion: N2_TRIFECTA_PRIVATE_HEARTBEAT_VERSION,
    recordedAt,
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

function verifyHeartbeatRecord(record: N2TrifectaPrivateHeartbeatRecord): void {
  const recordedAt = canonicalInstant(record.recordedAt);
  if (!recordedAt || recordedAt !== record.recordedAt || jstDate(recordedAt) !== record.dateJst) {
    throw new Error("HEARTBEAT_APPEND_AUTHORITY_INVALID");
  }
  if (record.heartbeatVersion !== N2_TRIFECTA_PRIVATE_HEARTBEAT_VERSION
    || !(["PASS", "NO_CHANGE", "BLOCKED"] as unknown[]).includes(record.status)
    || !(["PASS", "BLOCKED"] as unknown[]).includes(record.runtimeAuthorityStatus)
    || !Array.isArray(record.blockers)
    || record.databaseWriteCount !== 0
    || record.primaryDbWriteCount !== 0
    || record.sidecarWriteCount !== 0
    || record.rawOddsValuesRecorded !== false
    || record.currentBuyChanged !== false
    || record.lineChanged !== false
    || record.publicPublished !== false
    || record.automatedBettingChanged !== false
    || record.productionApplyExecuted !== false) {
    throw new Error("HEARTBEAT_APPEND_AUTHORITY_INVALID");
  }
  for (const count of [
    record.dueEntryCount,
    record.networkRequestCount,
    record.capturedCount,
    record.blockedEvidenceCount,
  ]) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("HEARTBEAT_APPEND_AUTHORITY_INVALID");
    }
  }
  const { recordDigest, ...core } = record;
  if (typeof recordDigest !== "string" || recordDigest !== canonicalHash(core)) {
    throw new Error("HEARTBEAT_APPEND_AUTHORITY_INVALID");
  }
}

export function appendN2TrifectaPrivateHeartbeat(input: {
  dataRoot: string;
  record: N2TrifectaPrivateHeartbeatRecord;
}): string {
  verifyHeartbeatRecord(input.record);
  const relativePath = n2TrifectaPrivateHeartbeatRelativePath(input.record.recordedAt);
  const path = resolveInside(input.dataRoot, relativePath);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error("HEARTBEAT_SYMLINK_NOT_ALLOWED");
    if (!stat.isFile()) throw new Error("HEARTBEAT_FILE_TYPE_INVALID");
    if ((statSync(path).mode & 0o777) !== 0o600) {
      throw new Error("HEARTBEAT_FILE_MODE_INVALID");
    }
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
