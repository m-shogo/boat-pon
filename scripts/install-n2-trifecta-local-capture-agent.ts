import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  buildN2TrifectaImmutableRuntimeAuthorityBinding,
  type N2TrifectaImmutableRuntimeAuthorityBinding,
} from "../src/research-replay/n2TrifectaImmutableRuntimeAuthority";
import {
  N2_TRIFECTA_LOCAL_CAPTURE_LAUNCH_AGENT_LABEL,
  assertN2TrifectaCanonicalInstallRoot,
  buildN2TrifectaImmutableRuntimeRoot,
  buildN2TrifectaLocalCaptureAuthorization,
  buildN2TrifectaLocalCaptureLaunchAgentPlist,
} from "../src/research-replay/n2TrifectaLocalCaptureLaunchAgent";
import type { N2TrifectaLocalCaptureAuthorization } from "../src/research-replay/n2TrifectaLocalCaptureService";

const repoRoot = resolve(process.cwd());
const policy = JSON.parse(
  readFileSync(join(repoRoot, "config/research-automation-policy.json"), "utf8"),
) as Record<string, unknown>;
const dataRoot = resolve(
  process.env.BOAT_PON_DATA_ROOT?.trim()
    || String(policy.dataRoot ?? policy.repoPath ?? repoRoot),
);
const privateRoot = join(dataRoot, "data/private/trifecta-capture");
const authorizationPath = join(privateRoot, "authorization.json");
const runtimeAuthorityPath = join(privateRoot, "runtime-authority.json");
const logsPath = join(privateRoot, "logs");
const launchAgentsPath = join(homedir(), "Library/LaunchAgents");
const plistPath = join(
  launchAgentsPath,
  `${N2_TRIFECTA_LOCAL_CAPTURE_LAUNCH_AGENT_LABEL}.plist`,
);
const printOnly = process.argv.includes("--print-only");
const uninstall = process.argv.includes("--uninstall");
const authorize = process.argv.includes("--authorize");
const renew = process.argv.includes("--renew");
const authorizationDays = Number(argument("days") ?? "30");
const canonicalRepoRoot = resolve(String(policy.repoPath ?? repoRoot));
const releasesRoot = resolve(
  argument("runtime-releases-root")
    ?? join(homedir(), "Library/Application Support/BoatPon/trifecta-private-capture/releases"),
);

assertN2TrifectaCanonicalInstallRoot({
  currentRepoRoot: repoRoot,
  configuredRepoRoot: canonicalRepoRoot,
  printOnly,
});

function argument(name: string): string | null {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function run(command: string, args: string[], options: {
  cwd?: string;
  allowFailure?: boolean;
  capture?: boolean;
} = {}): { status: number | null; stdout: string } {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.capture || options.allowFailure
      ? ["ignore", "pipe", "pipe"]
      : "inherit",
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
  }
  return { status: result.status, stdout: result.stdout?.trim() ?? "" };
}

function git(args: string[], options: { cwd?: string; allowFailure?: boolean } = {}) {
  return run("git", args, { ...options, capture: true });
}

function runLaunchctl(args: string[], allowFailure = false): void {
  run("/bin/launchctl", args, { allowFailure });
}

function readPrivateJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  if (lstatSync(path).isSymbolicLink()) {
    throw new Error("PRIVATE_AUTHORITY_SYMLINK_NOT_ALLOWED");
  }
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writePrivate(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

function verifyImmutableRuntime(runtimeRoot: string, authoritySha: string): void {
  if (!existsSync(runtimeRoot)) throw new Error("IMMUTABLE_RUNTIME_NOT_FOUND");
  if (lstatSync(runtimeRoot).isSymbolicLink()) {
    throw new Error("IMMUTABLE_RUNTIME_SYMLINK_NOT_ALLOWED");
  }
  const head = git(["rev-parse", "HEAD"], { cwd: runtimeRoot });
  if (head.stdout !== authoritySha) throw new Error("IMMUTABLE_RUNTIME_SHA_MISMATCH");
  const symbolic = git(["symbolic-ref", "-q", "HEAD"], {
    cwd: runtimeRoot,
    allowFailure: true,
  });
  if (symbolic.status !== 1) throw new Error("IMMUTABLE_RUNTIME_MUST_BE_DETACHED");
  const status = git(["status", "--porcelain", "--untracked-files=no"], {
    cwd: runtimeRoot,
  });
  if (status.stdout) throw new Error("IMMUTABLE_RUNTIME_TRACKED_FILES_DIRTY");
}

if (uninstall) {
  if (process.platform !== "darwin" && !printOnly) {
    throw new Error("UNINSTALL_REQUIRES_MACOS");
  }
  if (!printOnly) {
    runLaunchctl(["bootout", `gui/${process.getuid?.() ?? 0}`, plistPath], true);
    rmSync(plistPath, { force: true });
  }
  console.log(JSON.stringify({
    status: "UNINSTALLED",
    label: N2_TRIFECTA_LOCAL_CAPTURE_LAUNCH_AGENT_LABEL,
    plistRemoved: !printOnly,
    authorizationPreserved: true,
    runtimeAuthorityPreserved: true,
    immutableRuntimePreserved: true,
    rawEvidencePreserved: true,
    dataRoot,
  }, null, 2));
  process.exit(0);
}

if (process.platform !== "darwin" && !printOnly) {
  throw new Error("INSTALL_REQUIRES_MACOS");
}
if (!printOnly) {
  const branch = git(["branch", "--show-current"], { cwd: repoRoot });
  if (branch.stdout !== "main") throw new Error("INSTALL_REQUIRES_MAIN_BRANCH");
  const status = git(["status", "--porcelain"], { cwd: repoRoot });
  if (status.stdout) throw new Error("INSTALL_REQUIRES_CLEAN_WORKTREE");
}

const authoritySha = git(["rev-parse", "HEAD"], { cwd: repoRoot }).stdout;
const runtimeRoot = buildN2TrifectaImmutableRuntimeRoot({
  releasesRoot,
  authoritySha,
  canonicalRepoRoot,
});
const runtimeTsxCliPath = join(runtimeRoot, "node_modules/tsx/dist/cli.mjs");
const runtimeTickScriptPath = join(runtimeRoot, "scripts/run-n2-trifecta-local-capture-tick.ts");
const existingAuthorization = readPrivateJson<N2TrifectaLocalCaptureAuthorization>(authorizationPath);
const existingRuntimeAuthority =
  readPrivateJson<N2TrifectaImmutableRuntimeAuthorityBinding>(runtimeAuthorityPath);

if (existingAuthorization && !renew) {
  if (!existingRuntimeAuthority
    || existingRuntimeAuthority.authorizationId !== existingAuthorization.authorizationId
    || existingRuntimeAuthority.issuedAt !== existingAuthorization.issuedAt
    || existingRuntimeAuthority.expiresAt !== existingAuthorization.expiresAt
    || existingRuntimeAuthority.authoritySha !== authoritySha
    || resolve(existingRuntimeAuthority.runtimeRoot) !== runtimeRoot) {
    throw new Error("EXISTING_AUTHORIZATION_REQUIRES_EXPLICIT_RENEWAL_FOR_RUNTIME_AUTHORITY");
  }
}

if (!printOnly) {
  mkdirSync(releasesRoot, { recursive: true, mode: 0o700 });
  if (!existsSync(runtimeRoot)) {
    git(["worktree", "add", "--detach", runtimeRoot, authoritySha], { cwd: repoRoot });
  }
  verifyImmutableRuntime(runtimeRoot, authoritySha);
  run("npm", ["ci"], { cwd: runtimeRoot });
  verifyImmutableRuntime(runtimeRoot, authoritySha);
  if (!existsSync(runtimeTsxCliPath)) throw new Error("IMMUTABLE_RUNTIME_TSX_CLI_NOT_FOUND");
  if (!existsSync(runtimeTickScriptPath)) throw new Error("IMMUTABLE_RUNTIME_TICK_SCRIPT_NOT_FOUND");
}

let authorization = existingAuthorization;
if (!existingAuthorization) {
  if (!authorize) throw new Error("NEW_INSTALL_REQUIRES_EXPLICIT_--authorize");
  authorization = buildN2TrifectaLocalCaptureAuthorization({
    now: new Date().toISOString(),
    authorizationDays,
  });
} else if (renew) {
  if (!authorize) throw new Error("RENEW_REQUIRES_EXPLICIT_--authorize");
  authorization = buildN2TrifectaLocalCaptureAuthorization({
    now: new Date().toISOString(),
    authorizationDays,
  });
}
if (!authorization) throw new Error("AUTHORIZATION_UNRESOLVED");
const runtimeAuthority = buildN2TrifectaImmutableRuntimeAuthorityBinding({
  authorization,
  authoritySha,
  runtimeRoot,
});

mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
mkdirSync(logsPath, { recursive: true, mode: 0o700 });
const plist = buildN2TrifectaLocalCaptureLaunchAgentPlist({
  nodePath: process.execPath,
  tsxCliPath: runtimeTsxCliPath,
  tickScriptPath: runtimeTickScriptPath,
  workingDirectory: runtimeRoot,
  authoritySha,
  runtimeRoot,
  dataRoot,
  authorizationPath,
  runtimeAuthorityPath,
  stdoutPath: join(logsPath, "stdout.log"),
  stderrPath: join(logsPath, "stderr.log"),
});

if (!printOnly) {
  if (!existingAuthorization || renew) {
    writePrivate(authorizationPath, `${JSON.stringify(authorization, null, 2)}\n`);
    writePrivate(runtimeAuthorityPath, `${JSON.stringify(runtimeAuthority, null, 2)}\n`);
  }
  mkdirSync(launchAgentsPath, { recursive: true });
  writeFileSync(plistPath, plist, { encoding: "utf8", mode: 0o644 });
  chmodSync(plistPath, 0o644);
  const domain = `gui/${process.getuid?.() ?? 0}`;
  runLaunchctl(["bootout", domain, plistPath], true);
  runLaunchctl(["bootstrap", domain, plistPath]);
  runLaunchctl(["kickstart", "-k", `${domain}/${N2_TRIFECTA_LOCAL_CAPTURE_LAUNCH_AGENT_LABEL}`]);
}

console.log(JSON.stringify({
  status: printOnly ? "PRINT_ONLY" : "INSTALLED",
  label: N2_TRIFECTA_LOCAL_CAPTURE_LAUNCH_AGENT_LABEL,
  authorizationId: authorization.authorizationId,
  authorizationIssuedAt: authorization.issuedAt,
  authorizationExpiresAt: authorization.expiresAt,
  authoritySha: runtimeAuthority.authoritySha,
  runtimeRoot: runtimeAuthority.runtimeRoot,
  runtimeDetached: true,
  runtimeTrackedWorktreeClean: true,
  stage: authorization.stage,
  maxRequestsPerDay: authorization.maxRequestsPerDay,
  checkpoints: authorization.checkpointLabels,
  startIntervalSeconds: 30,
  privateResearchOnly: authorization.privateResearchOnly,
  databaseWriteAuthorized: authorization.databaseWriteAuthorized,
  currentBuyConnectionAuthorized: authorization.currentBuyConnectionAuthorized,
  lineConnectionAuthorized: authorization.lineConnectionAuthorized,
  automatedBettingAuthorized: authorization.automatedBettingAuthorized,
  dataRoot,
  authorizationPath,
  runtimeAuthorityPath,
  plistPath,
  oldRuntimeCleanupExecuted: false,
  rawEvidenceUploadedOrPublished: false,
}, null, 2));

if (printOnly) console.log(plist);
