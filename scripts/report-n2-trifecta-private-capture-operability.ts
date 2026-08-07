import { getuid } from "node:process";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { buildN2TrifectaPrivateCaptureOperabilityReport } from
  "../src/research-replay/n2TrifectaPrivateCaptureOperability";

function argument(name: string): string | null {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function currentJstDate(now: Date): string {
  return new Intl.DateTimeFormat("sv", { timeZone: "Asia/Tokyo" }).format(now);
}

function launchdRegistered(): boolean | null {
  if (process.platform !== "darwin" || typeof getuid !== "function") return null;
  const label = "com.boatpon.trifecta-private-capture";
  const result = spawnSync("/bin/launchctl", ["print", `gui/${getuid()}/${label}`], {
    stdio: "ignore",
  });
  return result.status === 0;
}

const nowArg = argument("now");
const now = nowArg ? new Date(nowArg) : new Date();
if (!Number.isFinite(now.getTime())) {
  console.error("invalid --now");
  process.exit(2);
}
const date = argument("date") ?? currentJstDate(now);
if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
  console.error("invalid --date");
  process.exit(2);
}

const report = buildN2TrifectaPrivateCaptureOperabilityReport({
  dataRoot: resolve(process.env.BOAT_PON_DATA_ROOT?.trim() || process.cwd()),
  date,
  now: now.toISOString(),
  launchdRegistered: launchdRegistered(),
});
console.log(JSON.stringify(report, null, 2));
if (report.status === "BLOCKED") process.exitCode = 3;
