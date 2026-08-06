import {
  existsSync,
  lstatSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";

import {
  runN2TrifectaLocalCaptureTick,
  type N2TrifectaLocalCaptureAuthorization,
} from "../src/research-replay/n2TrifectaLocalCaptureService";

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
const now = process.env.BOAT_PON_LOCAL_CAPTURE_NOW?.trim()
  || new Date().toISOString();

function readAuthorization(path: string): N2TrifectaLocalCaptureAuthorization {
  if (!existsSync(path)) throw new Error("LOCAL_CAPTURE_AUTHORIZATION_NOT_FOUND");
  if (lstatSync(path).isSymbolicLink()) {
    throw new Error("LOCAL_CAPTURE_AUTHORIZATION_SYMLINK_NOT_ALLOWED");
  }
  const stat = statSync(path);
  if (!stat.isFile() || stat.size <= 0 || stat.size > 100_000) {
    throw new Error("LOCAL_CAPTURE_AUTHORIZATION_SIZE_OR_TYPE_INVALID");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("LOCAL_CAPTURE_AUTHORIZATION_INVALID_JSON");
  }
  return parsed as N2TrifectaLocalCaptureAuthorization;
}

const report = await runN2TrifectaLocalCaptureTick({
  dataRoot,
  primaryDbPath,
  authorization: readAuthorization(authorizationPath),
  now,
});

console.log(JSON.stringify({
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
  reportRelativePath: report.reportRelativePath,
  databaseWriteCount: report.databaseWriteCount,
  primaryDbWriteCount: report.primaryDbWriteCount,
  sidecarWriteCount: report.sidecarWriteCount,
  currentBuyChanged: report.currentBuyChanged,
  lineChanged: report.lineChanged,
  publicPublished: report.publicPublished,
  automatedBettingChanged: report.automatedBettingChanged,
  productionApplyExecuted: report.productionApplyExecuted,
}, null, 2));

if (report.status === "BLOCKED") process.exitCode = 3;
