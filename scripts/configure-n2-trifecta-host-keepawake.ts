import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  MAC_CAPTURE_HOST_KEEPAWAKE_LABEL,
  auditMacCaptureHostKeepAwakePlist,
  buildMacCaptureHostKeepAwakePlist,
} from "../src/automation/macCaptureHostKeepAwake";
import { assertN2TrifectaCanonicalInstallRoot } from "../src/research-replay/n2TrifectaLocalCaptureLaunchAgent";

const repoRoot = resolve(process.cwd());
const policy = JSON.parse(
  readFileSync(join(repoRoot, "config/research-automation-policy.json"), "utf8"),
) as Record<string, unknown>;
const canonicalRepoRoot = resolve(String(policy.repoPath ?? repoRoot));
const dataRoot = resolve(
  process.env.BOAT_PON_DATA_ROOT?.trim()
    || String(policy.dataRoot ?? policy.repoPath ?? repoRoot),
);
const enable = process.argv.includes("--enable");
const disable = process.argv.includes("--disable");
const printOnly = process.argv.includes("--print-only");

if (Number(enable) + Number(disable) !== 1) {
  throw new Error("KEEPAWAKE_REQUIRES_EXACTLY_ONE_OF_--enable_OR_--disable");
}

assertN2TrifectaCanonicalInstallRoot({
  currentRepoRoot: repoRoot,
  configuredRepoRoot: canonicalRepoRoot,
  printOnly,
});

function run(command: string, args: string[], allowFailure = false): {
  status: number | null;
  stdout: string;
} {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: allowFailure ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
  }
  return { status: result.status, stdout: result.stdout?.trim() ?? "" };
}

function git(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

if (!printOnly) {
  if (process.platform !== "darwin") throw new Error("KEEPAWAKE_REQUIRES_MACOS");
  if (git(["branch", "--show-current"]) !== "main") {
    throw new Error("KEEPAWAKE_REQUIRES_MAIN_BRANCH");
  }
  if (git(["status", "--porcelain"])) {
    throw new Error("KEEPAWAKE_REQUIRES_CLEAN_WORKTREE");
  }
}

const logsRoot = join(dataRoot, "data/private/trifecta-capture/logs");
const launchAgentsRoot = join(homedir(), "Library/LaunchAgents");
const plistPath = join(launchAgentsRoot, `${MAC_CAPTURE_HOST_KEEPAWAKE_LABEL}.plist`);
const domain = `gui/${process.getuid?.() ?? 0}`;
const stdoutPath = join(logsRoot, "host-keepawake.stdout.log");
const stderrPath = join(logsRoot, "host-keepawake.stderr.log");

if (disable) {
  if (!printOnly) {
    run("/bin/launchctl", ["bootout", domain, plistPath], true);
    rmSync(plistPath, { force: true });
  }
  console.log(JSON.stringify({
    status: printOnly ? "PRINT_ONLY_DISABLE" : "DISABLED",
    label: MAC_CAPTURE_HOST_KEEPAWAKE_LABEL,
    explicitOptInRequiredToEnable: true,
    changesPmset: false,
    requiresSudo: false,
    currentBuyChanged: false,
    lineChanged: false,
    publicPublished: false,
    databaseWriteCount: 0,
  }, null, 2));
  process.exit(0);
}

const plist = buildMacCaptureHostKeepAwakePlist({ stdoutPath, stderrPath });
const audit = auditMacCaptureHostKeepAwakePlist(plist);
if (audit.status !== "PASS") {
  throw new Error(`KEEPAWAKE_PLIST_BLOCKED:${audit.blockers.join(",")}`);
}

if (!printOnly) {
  mkdirSync(logsRoot, { recursive: true, mode: 0o700 });
  mkdirSync(launchAgentsRoot, { recursive: true });
  writeFileSync(plistPath, plist, { encoding: "utf8", mode: 0o644 });
  chmodSync(plistPath, 0o644);
  run("/bin/launchctl", ["bootout", domain, plistPath], true);
  run("/bin/launchctl", ["bootstrap", domain, plistPath]);
  run("/bin/launchctl", ["kickstart", "-k", `${domain}/${MAC_CAPTURE_HOST_KEEPAWAKE_LABEL}`]);
}

console.log(JSON.stringify({
  status: printOnly ? "PRINT_ONLY_ENABLE" : "ENABLED",
  label: audit.label,
  caffeinatePath: audit.caffeinatePath,
  explicitOptInRequiredToEnable: true,
  acPowerOnly: audit.acPowerOnly,
  preventsSystemSleep: audit.preventsSystemSleep,
  preventsDisplaySleep: audit.preventsDisplaySleep,
  preventsDiskIdle: audit.preventsDiskIdle,
  simulatesUserActivity: audit.simulatesUserActivity,
  changesPmset: audit.changesPmset,
  requiresSudo: audit.requiresSudo,
  currentBuyChanged: audit.currentBuyChanged,
  lineChanged: audit.lineChanged,
  publicPublished: audit.publicPublished,
  databaseWriteCount: audit.databaseWriteCount,
  plistWrittenOrLoaded: !printOnly,
}, null, 2));

if (printOnly) console.log(plist);
