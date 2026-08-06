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
  N2_TRIFECTA_LOCAL_CAPTURE_LAUNCH_AGENT_LABEL,
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
const logsPath = join(privateRoot, "logs");
const launchAgentsPath = join(homedir(), "Library/LaunchAgents");
const plistPath = join(
  launchAgentsPath,
  `${N2_TRIFECTA_LOCAL_CAPTURE_LAUNCH_AGENT_LABEL}.plist`,
);
const tsxCliPath = join(repoRoot, "node_modules/tsx/dist/cli.mjs");
const tickScriptPath = join(repoRoot, "scripts/run-n2-trifecta-local-capture-tick.ts");
const printOnly = process.argv.includes("--print-only");
const uninstall = process.argv.includes("--uninstall");
const authorize = process.argv.includes("--authorize");
const renew = process.argv.includes("--renew");
const authorizationDays = Number(argument("days") ?? "30");

function argument(name: string): string | null {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function runLaunchctl(args: string[], allowFailure = false): void {
  const result = spawnSync("/bin/launchctl", args, {
    encoding: "utf8",
    stdio: allowFailure ? "pipe" : "inherit",
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`launchctl ${args.join(" ")} failed with ${result.status}`);
  }
}

function readExistingAuthorization(): N2TrifectaLocalCaptureAuthorization | null {
  if (!existsSync(authorizationPath)) return null;
  if (lstatSync(authorizationPath).isSymbolicLink()) {
    throw new Error("AUTHORIZATION_SYMLINK_NOT_ALLOWED");
  }
  return JSON.parse(readFileSync(authorizationPath, "utf8")) as N2TrifectaLocalCaptureAuthorization;
}

function writePrivate(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
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
    rawEvidencePreserved: true,
    dataRoot,
  }, null, 2));
  process.exit(0);
}

if (process.platform !== "darwin" && !printOnly) {
  throw new Error("INSTALL_REQUIRES_MACOS");
}
if (!existsSync(tsxCliPath)) throw new Error("TSX_CLI_NOT_FOUND_RUN_NPM_CI_FIRST");
if (!existsSync(tickScriptPath)) throw new Error("TICK_SCRIPT_NOT_FOUND");

const existingAuthorization = readExistingAuthorization();
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

mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
mkdirSync(logsPath, { recursive: true, mode: 0o700 });
const plist = buildN2TrifectaLocalCaptureLaunchAgentPlist({
  nodePath: process.execPath,
  tsxCliPath,
  tickScriptPath,
  workingDirectory: repoRoot,
  dataRoot,
  authorizationPath,
  stdoutPath: join(logsPath, "stdout.log"),
  stderrPath: join(logsPath, "stderr.log"),
});

if (!printOnly) {
  if (!existingAuthorization || renew) {
    writePrivate(authorizationPath, `${JSON.stringify(authorization, null, 2)}\n`);
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
  plistPath,
  rawEvidenceUploadedOrPublished: false,
}, null, 2));

if (printOnly) console.log(plist);
