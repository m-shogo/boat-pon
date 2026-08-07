import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";

import {
  auditN2TrifectaImmutableRuntimeAuthority,
  recordN2TrifectaImmutableRuntimeBlock,
  type N2TrifectaImmutableRuntimeAuthorityAudit,
  type N2TrifectaImmutableRuntimeAuthorityBinding,
  type N2TrifectaObservedRuntimeAuthority,
} from "../src/research-replay/n2TrifectaImmutableRuntimeAuthority";
import {
  runN2TrifectaLocalCaptureTick,
  type N2TrifectaLocalCaptureAuthorization,
} from "../src/research-replay/n2TrifectaLocalCaptureService";
import {
  appendN2TrifectaPrivateHeartbeat,
  buildN2TrifectaPrivateHeartbeatRecord,
} from "../src/research-replay/n2TrifectaPrivateHeartbeat";

const repoRoot = resolve(process.cwd());
const policy = JSON.parse(
  readFileSync(join(repoRoot, "config/research-automation-policy.json"), "utf8"),
) as Record<string, unknown>;
const dataRoot = resolve(
  process.env.BOAT_PON_DATA_ROOT?.trim()
    || String(policy.dataRoot ?? policy.repoPath ?? repoRoot),
);
const primaryDbPath = resolve(
  process.env.BOAT_PON_PRIMARY_DB_PATH?.trim()
    || join(dataRoot, "data/boat.sqlite"),
);
const authorizationPath = resolve(
  process.env.BOAT_PON_LOCAL_CAPTURE_AUTH_PATH?.trim()
    || join(dataRoot, "data/private/trifecta-capture/authorization.json"),
);
const runtimeAuthorityPath = resolve(
  process.env.BOAT_PON_LOCAL_CAPTURE_RUNTIME_AUTH_PATH?.trim()
    || join(dataRoot, "data/private/trifecta-capture/runtime-authority.json"),
);
const now = process.env.BOAT_PON_LOCAL_CAPTURE_NOW?.trim()
  || new Date().toISOString();
const forceJson = process.argv.includes("--json")
  || process.env.BOAT_PON_LOCAL_CAPTURE_VERBOSE === "1";

function readPrivateJson<T>(path: string, missingCode: string): T {
  if (!existsSync(path)) throw new Error(missingCode);
  if (lstatSync(path).isSymbolicLink()) {
    throw new Error("LOCAL_CAPTURE_PRIVATE_AUTHORITY_SYMLINK_NOT_ALLOWED");
  }
  const stat = statSync(path);
  if (!stat.isFile() || stat.size <= 0 || stat.size > 100_000) {
    throw new Error("LOCAL_CAPTURE_PRIVATE_AUTHORITY_SIZE_OR_TYPE_INVALID");
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    throw new Error("LOCAL_CAPTURE_PRIVATE_AUTHORITY_INVALID_JSON");
  }
}

function tryReadRuntimeAuthority(): N2TrifectaImmutableRuntimeAuthorityBinding | null {
  try {
    return readPrivateJson<N2TrifectaImmutableRuntimeAuthorityBinding>(
      runtimeAuthorityPath,
      "LOCAL_CAPTURE_RUNTIME_AUTHORITY_NOT_FOUND",
    );
  } catch (error) {
    if (error instanceof Error && error.message === "LOCAL_CAPTURE_RUNTIME_AUTHORITY_NOT_FOUND") {
      return null;
    }
    throw error;
  }
}

function git(args: string[]): { status: number | null; stdout: string } {
  const result = spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return { status: result.status, stdout: result.stdout.trim() };
}

function probeRuntimeAuthority(): N2TrifectaObservedRuntimeAuthority {
  const head = git(["rev-parse", "HEAD"]);
  const symbolic = git(["symbolic-ref", "-q", "HEAD"]);
  const trackedStatus = git(["status", "--porcelain", "--untracked-files=no"]);
  return {
    actualAuthoritySha: head.status === 0 ? head.stdout : null,
    actualRuntimeRoot: repoRoot,
    detachedHead: symbolic.status === 1,
    trackedWorktreeClean: trackedStatus.status === 0 && trackedStatus.stdout === "",
  };
}

function missingBindingAudit(): N2TrifectaImmutableRuntimeAuthorityAudit {
  return {
    status: "BLOCKED",
    blockers: ["RUNTIME_AUTHORITY_BINDING_NOT_FOUND"],
    authorizationMatched: false,
    authorityMatched: false,
    runtimeRootMatched: false,
    detachedHead: false,
    trackedWorktreeClean: false,
  };
}

function withLaunchdDeclarationChecks(
  audit: N2TrifectaImmutableRuntimeAuthorityAudit,
  binding: N2TrifectaImmutableRuntimeAuthorityBinding,
): N2TrifectaImmutableRuntimeAuthorityAudit {
  const blockers = [...audit.blockers];
  const declaredSha = process.env.BOAT_PON_LOCAL_CAPTURE_AUTHORITY_SHA?.trim();
  const declaredRoot = process.env.BOAT_PON_LOCAL_CAPTURE_RUNTIME_ROOT?.trim();
  if (declaredSha && declaredSha !== binding.authoritySha) {
    blockers.push("LAUNCHD_AUTHORITY_SHA_MISMATCH");
  }
  if (declaredRoot && resolve(declaredRoot) !== resolve(binding.runtimeRoot)) {
    blockers.push("LAUNCHD_RUNTIME_ROOT_MISMATCH");
  }
  const normalized = [...new Set(blockers)].sort();
  return { ...audit, status: normalized.length === 0 ? "PASS" : "BLOCKED", blockers: normalized };
}

function heartbeatErrorCode(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.trim().replaceAll(/[^A-Za-z0-9_]+/gu, "_").toUpperCase().slice(0, 120)
    || "UNKNOWN_ERROR";
}

function recordHeartbeatSafely(input: Parameters<typeof buildN2TrifectaPrivateHeartbeatRecord>[0]): void {
  try {
    const record = buildN2TrifectaPrivateHeartbeatRecord(input);
    appendN2TrifectaPrivateHeartbeat({ dataRoot, record });
  } catch (error) {
    // Heartbeat is observability only. Never trade away an otherwise-authorized
    // capture solely because diagnostic metadata could not be appended.
    console.error(JSON.stringify({
      status: "PRIVATE_HEARTBEAT_WRITE_FAILED",
      errorCode: heartbeatErrorCode(error),
      rawOddsValuesPublished: false,
      databaseWriteCount: 0,
      currentBuyChanged: false,
      lineChanged: false,
      publicPublished: false,
      automatedBettingChanged: false,
    }));
  }
}

const authorization = readPrivateJson<N2TrifectaLocalCaptureAuthorization>(
  authorizationPath,
  "LOCAL_CAPTURE_AUTHORIZATION_NOT_FOUND",
);
const binding = tryReadRuntimeAuthority();
const observed = probeRuntimeAuthority();
const runtimeAudit = binding
  ? withLaunchdDeclarationChecks(auditN2TrifectaImmutableRuntimeAuthority({
    authorization,
    binding,
    observed,
    now,
  }), binding)
  : missingBindingAudit();

if (runtimeAudit.status === "BLOCKED") {
  const blocked = recordN2TrifectaImmutableRuntimeBlock({
    dataRoot,
    now,
    audit: runtimeAudit,
    binding,
    observed,
  });
  recordHeartbeatSafely({
    recordedAt: now,
    status: "BLOCKED",
    blockers: runtimeAudit.blockers,
    authoritySha: binding?.authoritySha ?? null,
    runtimeAuthorityStatus: "BLOCKED",
  });
  if (forceJson || blocked.eventChanged) console.log(JSON.stringify(blocked, null, 2));
  process.exitCode = 3;
} else {
  const report = await runN2TrifectaLocalCaptureTick({
    dataRoot,
    primaryDbPath,
    authorization,
    now,
  });

  const summary = {
    reportVersion: report.reportVersion,
    status: report.status,
    blockers: report.blockers,
    now: report.now,
    dateJst: report.dateJst,
    selectedVenueCode: report.selectedVenueCode,
    selectedRaceCount: report.selectedRaceCount,
    dueEntryCount: report.dueEntryCount,
    selectedRaceIdentity: report.selectedEntry?.raceIdentity ?? null,
    selectedCheckpointLabel: report.selectedEntry?.checkpointLabel ?? null,
    networkRequestCount: report.executorReport?.networkRequestCount ?? 0,
    capturedCount: report.executorReport?.capturedCount ?? 0,
    blockedEvidenceCount: report.executorReport?.blockedEvidenceCount ?? 0,
    authoritySha: binding?.authoritySha ?? null,
    runtimeRoot: binding?.runtimeRoot ?? null,
    runtimeAuthorityStatus: runtimeAudit.status,
    eventDigest: report.eventDigest,
    eventChanged: report.eventChanged,
    reportRelativePath: report.reportRelativePath,
    latestStatusRelativePath: report.latestStatusRelativePath,
    databaseWriteCount: report.databaseWriteCount,
    primaryDbWriteCount: report.primaryDbWriteCount,
    sidecarWriteCount: report.sidecarWriteCount,
    currentBuyChanged: report.currentBuyChanged,
    lineChanged: report.lineChanged,
    publicPublished: report.publicPublished,
    automatedBettingChanged: report.automatedBettingChanged,
    productionApplyExecuted: report.productionApplyExecuted,
  };

  recordHeartbeatSafely({
    recordedAt: report.now,
    status: report.status,
    blockers: report.blockers,
    authoritySha: binding?.authoritySha ?? null,
    runtimeAuthorityStatus: "PASS",
    selectedVenueCode: report.selectedVenueCode,
    selectedRaceIdentity: report.selectedEntry?.raceIdentity ?? null,
    selectedCheckpointLabel: report.selectedEntry?.checkpointLabel ?? null,
    dueEntryCount: report.dueEntryCount,
    networkRequestCount: report.executorReport?.networkRequestCount ?? 0,
    capturedCount: report.executorReport?.capturedCount ?? 0,
    blockedEvidenceCount: report.executorReport?.blockedEvidenceCount ?? 0,
  });

  if (forceJson || report.eventChanged || report.executorReport != null) {
    console.log(JSON.stringify(summary, null, 2));
  }

  if (report.status === "BLOCKED") process.exitCode = 3;
}
