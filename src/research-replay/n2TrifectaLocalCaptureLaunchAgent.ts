import { resolve, sep } from "node:path";

import {
  N2_TRIFECTA_LOCAL_CAPTURE_AUTHORIZATION_VERSION,
  type N2TrifectaLocalCaptureAuthorization,
} from "./n2TrifectaLocalCaptureService";

export const N2_TRIFECTA_LOCAL_CAPTURE_LAUNCH_AGENT_VERSION =
  "n2-trifecta-local-capture-launch-agent-v2" as const;
export const N2_TRIFECTA_LOCAL_CAPTURE_LAUNCH_AGENT_LABEL =
  "com.boatpon.trifecta-private-capture" as const;
export const N2_TRIFECTA_LOCAL_CAPTURE_START_INTERVAL_SECONDS = 30 as const;
export const N2_TRIFECTA_LOCAL_CAPTURE_MAX_AUTHORIZATION_DAYS = 90 as const;

const SHA_RE = /^[0-9a-f]{40}$/u;

export type N2TrifectaLocalCaptureLaunchAgentInput = {
  nodePath: string;
  tsxCliPath: string;
  tickScriptPath: string;
  workingDirectory: string;
  authoritySha: string;
  runtimeRoot: string;
  dataRoot: string;
  authorizationPath: string;
  runtimeAuthorityPath: string;
  stdoutPath: string;
  stderrPath: string;
};

function parseInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("INVALID_INSTANT");
  return parsed;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function plistString(value: string): string {
  return `<string>${xmlEscape(value)}</string>`;
}

export function assertN2TrifectaCanonicalInstallRoot(input: {
  currentRepoRoot: string;
  configuredRepoRoot: string;
  printOnly: boolean;
}): void {
  if (input.printOnly) return;
  if (resolve(input.currentRepoRoot) !== resolve(input.configuredRepoRoot)) {
    throw new Error("INSTALL_REQUIRES_CANONICAL_REPO");
  }
}

export function buildN2TrifectaImmutableRuntimeRoot(input: {
  releasesRoot: string;
  authoritySha: string;
  canonicalRepoRoot: string;
}): string {
  if (!SHA_RE.test(input.authoritySha)) throw new Error("RUNTIME_AUTHORITY_SHA_INVALID");
  const releasesRoot = resolve(input.releasesRoot);
  const canonicalRepoRoot = resolve(input.canonicalRepoRoot);
  const runtimeRoot = resolve(releasesRoot, input.authoritySha);
  if (runtimeRoot === canonicalRepoRoot || runtimeRoot.startsWith(`${canonicalRepoRoot}${sep}`)) {
    throw new Error("RUNTIME_MUST_BE_OUTSIDE_CANONICAL_REPO");
  }
  if (runtimeRoot.includes(`${sep}_work${sep}`) || runtimeRoot.includes("actions-runner-")) {
    throw new Error("RUNTIME_MUST_NOT_USE_RUNNER_WORKSPACE");
  }
  return runtimeRoot;
}

export function buildN2TrifectaLocalCaptureAuthorization(input: {
  now: string;
  authorizationDays: number;
  authorizationId?: string;
}): N2TrifectaLocalCaptureAuthorization {
  if (
    !Number.isSafeInteger(input.authorizationDays)
    || input.authorizationDays < 1
    || input.authorizationDays > N2_TRIFECTA_LOCAL_CAPTURE_MAX_AUTHORIZATION_DAYS
  ) {
    throw new Error("AUTHORIZATION_DAYS_OUT_OF_RANGE");
  }
  const issuedAtMs = parseInstant(input.now);
  const authorizationId = input.authorizationId
    ?? `AUTH-N2-TRI-LOCAL-${new Date(issuedAtMs).toISOString().replaceAll(/[-:.TZ]/gu, "").slice(0, 14)}-private`;
  return {
    authorizationVersion: N2_TRIFECTA_LOCAL_CAPTURE_AUTHORIZATION_VERSION,
    authorizationId,
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(
      issuedAtMs + input.authorizationDays * 24 * 60 * 60 * 1_000,
    ).toISOString(),
    stage: "ONE_VENUE_REVIEW",
    maxRequestsPerDay: 48,
    checkpointLabels: ["T-30", "T-20", "T-10", "T-5"],
    minInterRequestMs: 10_000,
    privateResearchOnly: true,
    publicRedistributionAuthorized: false,
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    automatedBettingAuthorized: false,
  };
}

export function buildN2TrifectaLocalCaptureLaunchAgentPlist(
  input: N2TrifectaLocalCaptureLaunchAgentInput,
): string {
  if (Object.values(input).some((value) => !value.trim())) {
    throw new Error("LAUNCH_AGENT_PATH_EMPTY");
  }
  if (!SHA_RE.test(input.authoritySha)) throw new Error("LAUNCH_AGENT_AUTHORITY_SHA_INVALID");
  const normalized = {
    nodePath: resolve(input.nodePath),
    tsxCliPath: resolve(input.tsxCliPath),
    tickScriptPath: resolve(input.tickScriptPath),
    workingDirectory: resolve(input.workingDirectory),
    authoritySha: input.authoritySha,
    runtimeRoot: resolve(input.runtimeRoot),
    dataRoot: resolve(input.dataRoot),
    authorizationPath: resolve(input.authorizationPath),
    runtimeAuthorityPath: resolve(input.runtimeAuthorityPath),
    stdoutPath: resolve(input.stdoutPath),
    stderrPath: resolve(input.stderrPath),
  };
  if (normalized.workingDirectory !== normalized.runtimeRoot) {
    throw new Error("LAUNCH_AGENT_WORKING_DIRECTORY_MUST_EQUAL_RUNTIME_ROOT");
  }
  const args = [
    normalized.nodePath,
    normalized.tsxCliPath,
    normalized.tickScriptPath,
  ].map((value) => `      ${plistString(value)}`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  ${plistString(N2_TRIFECTA_LOCAL_CAPTURE_LAUNCH_AGENT_LABEL)}
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key>
  ${plistString(normalized.workingDirectory)}
  <key>EnvironmentVariables</key>
  <dict>
    <key>BOAT_PON_DATA_ROOT</key>
    ${plistString(normalized.dataRoot)}
    <key>BOAT_PON_LOCAL_CAPTURE_AUTH_PATH</key>
    ${plistString(normalized.authorizationPath)}
    <key>BOAT_PON_LOCAL_CAPTURE_RUNTIME_AUTH_PATH</key>
    ${plistString(normalized.runtimeAuthorityPath)}
    <key>BOAT_PON_LOCAL_CAPTURE_AUTHORITY_SHA</key>
    ${plistString(normalized.authoritySha)}
    <key>BOAT_PON_LOCAL_CAPTURE_RUNTIME_ROOT</key>
    ${plistString(normalized.runtimeRoot)}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${N2_TRIFECTA_LOCAL_CAPTURE_START_INTERVAL_SECONDS}</integer>
  <key>ThrottleInterval</key>
  <integer>${N2_TRIFECTA_LOCAL_CAPTURE_START_INTERVAL_SECONDS}</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  ${plistString(normalized.stdoutPath)}
  <key>StandardErrorPath</key>
  ${plistString(normalized.stderrPath)}
  <key>LowPriorityIO</key>
  <true/>
  <key>Nice</key>
  <integer>10</integer>
</dict>
</plist>
`;
}
