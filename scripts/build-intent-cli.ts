// 最小 dispatch intent を生成する（operator / probe 用）。
// ChatGPT 本番はこの CLI を使わず intent JSON を直接 commit する（hash 不要）。
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { INTENT_SCHEMA_VERSION, validateIntent } from "../src/automation/dispatchIntent";

const root = resolve(process.cwd());
const arg = (n: string, d?: string): string | undefined => {
  const hit = process.argv.find((v) => v.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const git = (...a: string[]): string => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();

const authority = (arg("expected-authority-sha") ?? (() => { try { git("fetch", "origin", "--quiet"); return git("rev-parse", "--short", "origin/main"); } catch { return git("rev-parse", "--short", "HEAD"); } })()).toLowerCase();
const rand = Math.random().toString(16).slice(2, 12).padEnd(10, "0");
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const intent = {
  intentSchemaVersion: INTENT_SCHEMA_VERSION,
  intentId: arg("intent-id") ?? `INTENT-${stamp}-${rand}`,
  taskId: arg("task-id") ?? "NEXT",
  requestedAction: arg("requested-action") ?? "dry-run",
  safetyLevel: arg("safety-level") ?? "L0",
  expectedAuthoritySha: authority,
  maxDurationSeconds: Number(arg("max-duration-seconds") ?? "1800"),
  requestedBy: arg("requested-by") ?? "operator",
  requestReference: arg("request-reference") ?? `local:${stamp}`,
  ...(arg("approval-grant-id") ? { approvalGrantId: arg("approval-grant-id") } : {}),
};
const v = validateIntent(intent);
if (!v.valid) { console.error("INVALID INTENT:", v.errors); process.exit(1); }

if (process.argv.includes("--write")) {
  const dir = join(root, "automation/requests/intents");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${intent.intentId}.json`);
  writeFileSync(p, `${JSON.stringify(intent, null, 2)}\n`);
  console.error(`wrote ${p}`);
}
console.log(JSON.stringify(intent, null, 2));
