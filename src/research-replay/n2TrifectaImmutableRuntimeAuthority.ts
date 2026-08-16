import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";

import type { N2TrifectaLocalCaptureAuthorization } from "./n2TrifectaLocalCaptureService";
import { canonicalHash, canonicalUtcTimestamp } from "./canonical";

export const N2_TRIFECTA_IMMUTABLE_RUNTIME_AUTHORITY_VERSION =
  "n2-trifecta-immutable-runtime-authority-v1" as const;
export const N2_TRIFECTA_IMMUTABLE_RUNTIME_BLOCK_REPORT_VERSION =
  "n2-trifecta-immutable-runtime-block-report-v1" as const;

const SHA_RE = /^[0-9a-f]{40}$/u;
const AUTHORIZATION_ID_RE = /^AUTH-N2-TRI-LOCAL-[A-Za-z0-9._-]{8,96}$/u;

export type N2TrifectaImmutableRuntimeAuthorityBinding = {
  authorityVersion: typeof N2_TRIFECTA_IMMUTABLE_RUNTIME_AUTHORITY_VERSION;
  authorizationId: string;
  issuedAt: string;
  expiresAt: string;
  authoritySha: string;
  runtimeRoot: string;
  privateResearchOnly: true;
  databaseWriteAuthorized: false;
  currentBuyConnectionAuthorized: false;
  lineConnectionAuthorized: false;
  publicPublishAuthorized: false;
  automatedBettingAuthorized: false;
};

export type N2TrifectaObservedRuntimeAuthority = {
  actualAuthoritySha: string | null;
  actualRuntimeRoot: string;
  detachedHead: boolean;
  trackedWorktreeClean: boolean;
};

export type N2TrifectaImmutableRuntimeAuthorityAudit = {
  status: "PASS" | "BLOCKED";
  blockers: string[];
  authorizationMatched: boolean;
  authorityMatched: boolean;
  runtimeRootMatched: boolean;
  detachedHead: boolean;
  trackedWorktreeClean: boolean;
};

export type N2TrifectaImmutableRuntimeBlockReport = {
  reportVersion: typeof N2_TRIFECTA_IMMUTABLE_RUNTIME_BLOCK_REPORT_VERSION;
  status: "BLOCKED";
  blockers: string[];
  now: string;
  dateJst: string | null;
  authorizationId: string | null;
  expectedAuthoritySha: string | null;
  actualAuthoritySha: string | null;
  expectedRuntimeRoot: string | null;
  actualRuntimeRoot: string;
  detachedHead: boolean;
  trackedWorktreeClean: boolean;
  eventDigest: string;
  eventChanged: boolean;
  reportRelativePath: string | null;
  latestStatusRelativePath: string;
  networkRequestCount: 0;
  capturedCount: 0;
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

function parseInstant(value: string): number | null {
  try {
    return Date.parse(canonicalUtcTimestamp(value));
  } catch {
    return null;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
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

function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function exclusiveWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, content, "utf8");
  } finally {
    closeSync(fd);
  }
}

function readEventDigest(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size <= 0 || stat.size > 200_000) return null;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { eventDigest?: unknown };
    return typeof parsed.eventDigest === "string" ? parsed.eventDigest : null;
  } catch {
    return null;
  }
}

export function buildN2TrifectaImmutableRuntimeAuthorityBinding(input: {
  authorization: N2TrifectaLocalCaptureAuthorization;
  authoritySha: string;
  runtimeRoot: string;
}): N2TrifectaImmutableRuntimeAuthorityBinding {
  if (!SHA_RE.test(input.authoritySha)) throw new Error("AUTHORITY_SHA_INVALID");
  if (!input.runtimeRoot.trim()) throw new Error("RUNTIME_ROOT_REQUIRED");
  if (!AUTHORIZATION_ID_RE.test(input.authorization.authorizationId)) {
    throw new Error("AUTHORIZATION_ID_INVALID");
  }
  if (parseInstant(input.authorization.issuedAt) == null
    || parseInstant(input.authorization.expiresAt) == null) {
    throw new Error("AUTHORIZATION_TIME_INVALID");
  }
  return {
    authorityVersion: N2_TRIFECTA_IMMUTABLE_RUNTIME_AUTHORITY_VERSION,
    authorizationId: input.authorization.authorizationId,
    issuedAt: input.authorization.issuedAt,
    expiresAt: input.authorization.expiresAt,
    authoritySha: input.authoritySha,
    runtimeRoot: resolve(input.runtimeRoot),
    privateResearchOnly: true,
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    publicPublishAuthorized: false,
    automatedBettingAuthorized: false,
  };
}

export function auditN2TrifectaImmutableRuntimeAuthority(input: {
  authorization: N2TrifectaLocalCaptureAuthorization;
  binding: N2TrifectaImmutableRuntimeAuthorityBinding;
  observed: N2TrifectaObservedRuntimeAuthority;
  now: string;
}): N2TrifectaImmutableRuntimeAuthorityAudit {
  const blockers: string[] = [];
  const now = parseInstant(input.now);
  const issuedAt = parseInstant(input.binding.issuedAt);
  const expiresAt = parseInstant(input.binding.expiresAt);
  const expectedRoot = input.binding.runtimeRoot.trim();
  const actualRoot = input.observed.actualRuntimeRoot.trim();
  const actualSha = input.observed.actualAuthoritySha?.trim() ?? null;

  if (input.binding.authorityVersion !== N2_TRIFECTA_IMMUTABLE_RUNTIME_AUTHORITY_VERSION) {
    blockers.push("RUNTIME_AUTHORITY_VERSION_MISMATCH");
  }
  if (input.binding.authorizationId !== input.authorization.authorizationId) {
    blockers.push("AUTHORIZATION_ID_MISMATCH");
  }
  if (input.binding.issuedAt !== input.authorization.issuedAt
    || input.binding.expiresAt !== input.authorization.expiresAt) {
    blockers.push("AUTHORIZATION_INTERVAL_MISMATCH");
  }
  if (now == null) blockers.push("NOW_INVALID");
  if (issuedAt == null) blockers.push("BINDING_ISSUED_AT_INVALID");
  if (expiresAt == null) blockers.push("BINDING_EXPIRES_AT_INVALID");
  if (issuedAt != null && now != null && issuedAt > now) blockers.push("BINDING_NOT_YET_VALID");
  if (expiresAt != null && now != null && expiresAt <= now) blockers.push("BINDING_EXPIRED");
  if (!SHA_RE.test(input.binding.authoritySha)) blockers.push("EXPECTED_AUTHORITY_SHA_INVALID");
  if (actualSha == null || !SHA_RE.test(actualSha)) {
    blockers.push("ACTUAL_AUTHORITY_SHA_INVALID");
  } else if (actualSha !== input.binding.authoritySha) {
    blockers.push("AUTHORITY_SHA_MISMATCH");
  }
  if (!expectedRoot) blockers.push("EXPECTED_RUNTIME_ROOT_INVALID");
  if (!actualRoot) blockers.push("ACTUAL_RUNTIME_ROOT_INVALID");
  if (expectedRoot && actualRoot && resolve(expectedRoot) !== resolve(actualRoot)) {
    blockers.push("RUNTIME_ROOT_MISMATCH");
  }
  if (!input.observed.detachedHead) blockers.push("RUNTIME_HEAD_NOT_DETACHED");
  if (!input.observed.trackedWorktreeClean) blockers.push("RUNTIME_TRACKED_WORKTREE_DIRTY");
  if (input.binding.privateResearchOnly !== true) blockers.push("PRIVATE_RESEARCH_ONLY_REQUIRED");
  if (input.binding.databaseWriteAuthorized !== false) blockers.push("DATABASE_WRITE_MUST_BE_FALSE");
  if (input.binding.currentBuyConnectionAuthorized !== false) {
    blockers.push("CURRENT_BUY_CONNECTION_MUST_BE_FALSE");
  }
  if (input.binding.lineConnectionAuthorized !== false) blockers.push("LINE_CONNECTION_MUST_BE_FALSE");
  if (input.binding.publicPublishAuthorized !== false) blockers.push("PUBLIC_PUBLISH_MUST_BE_FALSE");
  if (input.binding.automatedBettingAuthorized !== false) blockers.push("AUTOMATED_BETTING_MUST_BE_FALSE");

  const normalized = unique(blockers);
  return {
    status: normalized.length === 0 ? "PASS" : "BLOCKED",
    blockers: normalized,
    authorizationMatched: input.binding.authorizationId === input.authorization.authorizationId
      && input.binding.issuedAt === input.authorization.issuedAt
      && input.binding.expiresAt === input.authorization.expiresAt,
    authorityMatched: actualSha != null && actualSha === input.binding.authoritySha,
    runtimeRootMatched: Boolean(expectedRoot && actualRoot)
      && resolve(expectedRoot) === resolve(actualRoot),
    detachedHead: input.observed.detachedHead,
    trackedWorktreeClean: input.observed.trackedWorktreeClean,
  };
}

export function recordN2TrifectaImmutableRuntimeBlock(input: {
  dataRoot: string;
  now: string;
  audit: N2TrifectaImmutableRuntimeAuthorityAudit;
  binding: N2TrifectaImmutableRuntimeAuthorityBinding | null;
  observed: N2TrifectaObservedRuntimeAuthority;
}): N2TrifectaImmutableRuntimeBlockReport {
  const date = jstDate(input.now);
  const latestStatusRelativePath =
    "data/private/trifecta-capture/status/runtime-authority-latest.json";
  const latestPath = resolveInside(input.dataRoot, latestStatusRelativePath);
  const eventCore = {
    reportVersion: N2_TRIFECTA_IMMUTABLE_RUNTIME_BLOCK_REPORT_VERSION,
    status: "BLOCKED" as const,
    blockers: unique(input.audit.blockers),
    dateJst: date,
    authorizationId: input.binding?.authorizationId ?? null,
    expectedAuthoritySha: input.binding?.authoritySha ?? null,
    actualAuthoritySha: input.observed.actualAuthoritySha,
    expectedRuntimeRoot: input.binding?.runtimeRoot ?? null,
    actualRuntimeRoot: input.observed.actualRuntimeRoot,
    detachedHead: input.observed.detachedHead,
    trackedWorktreeClean: input.observed.trackedWorktreeClean,
    networkRequestCount: 0 as const,
    capturedCount: 0 as const,
    databaseWriteCount: 0 as const,
    primaryDbWriteCount: 0 as const,
    sidecarWriteCount: 0 as const,
    currentBuyChanged: false as const,
    lineChanged: false as const,
    publicPublished: false as const,
    automatedBettingChanged: false as const,
    productionApplyExecuted: false as const,
  };
  const eventDigest = canonicalHash(eventCore);
  const previousDigest = readEventDigest(latestPath);
  const eventChanged = previousDigest !== eventDigest;
  const reportRelativePath = eventChanged
    ? `data/private/trifecta-capture/reports/runtime-authority/${date ?? "unknown"}/${eventDigest}.json`
    : null;
  const core = {
    ...eventCore,
    now: input.now,
    eventDigest,
    eventChanged,
    reportRelativePath,
    latestStatusRelativePath,
  };
  const report = { ...core, outputDigest: canonicalHash(core) };
  if (reportRelativePath) {
    const reportPath = resolveInside(input.dataRoot, reportRelativePath);
    try {
      exclusiveWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error
        && (error as { code?: unknown }).code === "EEXIST")) throw error;
    }
  }
  writeAtomic(latestPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}