import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { openDb } from "../server/db";

type Args = {
  help: boolean;
  from: string | null;
  to: string | null;
  batchSize: number;
  maxBatches: number;
  maxTotal: number;
  refreshEvery: number;
  sleepBetweenBatchesMs: number;
  dryRun: boolean;
  statusFile: string;
};

type BatchResult = {
  batch: number;
  targets: number;
  ok: number;
  skip: number;
  failed: number;
  stopped: boolean;
  reason: string | null;
};

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}
if (!args.from || !args.to) {
  throw new Error("安全のため --from YYYY-MM-DD と --to YYYY-MM-DD は必須です。月単位など短い範囲で実行してください。");
}
if (args.batchSize <= 0 || args.batchSize > 50) throw new Error("--batch-size は 1〜50 にしてください。");
if (args.maxBatches <= 0 || args.maxBatches > 20) throw new Error("--max-batches は 1〜20 にしてください。");
if (args.maxTotal <= 0 || args.maxTotal > 500) throw new Error("--max-total は 1〜500 にしてください。");

const startedAt = new Date().toISOString();
const batches: BatchResult[] = [];
let totalOk = 0;
let totalSkip = 0;
let fetchedSinceRefresh = 0;
let stopReason: string | null = null;

await writeStatus({ status: "running", message: "started" });

for (let batch = 1; batch <= args.maxBatches; batch += 1) {
  if (totalOk >= args.maxTotal) {
    stopReason = `max-total ${args.maxTotal} reached`;
    break;
  }

  const limit = Math.min(args.batchSize, args.maxTotal - totalOk);
  const dryRun = await runBackfill(["--dry-run", "--limit", String(limit), "--from", args.from, "--to", args.to, "--include-skip-required-odds"]);
  const targets = parseTargetCount(dryRun.stdout);
  if (targets === 0) {
    stopReason = "no targets";
    batches.push({ batch, targets, ok: 0, skip: 0, failed: 0, stopped: true, reason: stopReason });
    break;
  }
  if (args.dryRun) {
    batches.push({ batch, targets, ok: 0, skip: 0, failed: 0, stopped: true, reason: "dry-run only" });
    stopReason = "dry-run only";
    break;
  }

  const actual = await runBackfill(["--limit", String(Math.min(limit, targets)), "--from", args.from, "--to", args.to, "--include-skip-required-odds"]);
  const parsed = parseBackfillResult(actual.stdout + actual.stderr);
  totalOk += parsed.ok;
  totalSkip += parsed.skip;
  fetchedSinceRefresh += parsed.ok;

  const attempted = parsed.ok + parsed.skip;
  const failedRate = attempted === 0 ? 0 : parsed.skip / attempted;
  const hasBlockedStatus = hasBlockedHttpStatus(actual.stdout + actual.stderr);
  const batchResult: BatchResult = {
    batch,
    targets,
    ok: parsed.ok,
    skip: parsed.skip,
    failed: parsed.skip,
    stopped: false,
    reason: null,
  };
  batches.push(batchResult);

  if (hasBlockedStatus) {
    stopReason = "HTTP 429/403/5xx suspected";
    batchResult.stopped = true;
    batchResult.reason = stopReason;
    break;
  }
  if (attempted > 0 && failedRate >= 0.2) {
    stopReason = `failure rate ${(failedRate * 100).toFixed(1)}%`;
    batchResult.stopped = true;
    batchResult.reason = stopReason;
    break;
  }

  if (fetchedSinceRefresh >= args.refreshEvery) {
    await refreshHistory(args.from, args.to);
    fetchedSinceRefresh = 0;
  }

  await writeStatus({ status: "running", message: `batch ${batch} done` });
  await sleep(args.sleepBetweenBatchesMs);
}

if (!args.dryRun && fetchedSinceRefresh > 0) {
  await refreshHistory(args.from, args.to);
}

const finalCounts = readCounts();
await writeStatus({ status: "done", message: stopReason ?? "completed", finalCounts });

console.log(JSON.stringify({
  status: "done",
  startedAt,
  finishedAt: new Date().toISOString(),
  from: args.from,
  to: args.to,
  totalOk,
  totalSkip,
  stopReason,
  batches,
  finalCounts,
}, null, 2));

async function runBackfill(backfillArgs: string[]) {
  return runCommand("npm", ["run", "backfill:odds", "--", ...backfillArgs]);
}

async function refreshHistory(from: string, to: string) {
  await runCommand("npm", ["run", "generate:history", "--", "--from", from, "--to", to, "--limit", "5000", "--refresh-existing", "--refresh-only", "--include-skips"]);
}

function parseTargetCount(output: string) {
  const match = output.match(/odds backfill targets:\s*(\d+)/);
  return match ? Number(match[1]) : 0;
}

function parseBackfillResult(output: string) {
  const ok = (output.match(/^\[ok\]/gm) ?? []).length;
  const skip = (output.match(/^\[skip\]/gm) ?? []).length;
  return { ok, skip };
}

function hasBlockedHttpStatus(output: string) {
  return output
    .split(/\r?\n/)
    .some((line) => /fetch failed\s+(?:429|403|5\d\d)\b/i.test(line) || /\b(?:HTTP|status)\s*(?:429|403|5\d\d)\b/i.test(line));
}

function readCounts() {
  const db = openDb();
  try {
    const decisionHistory = db.prepare("SELECT COUNT(*) AS count FROM decision_history").get() as { count: number };
    const oddsSnapshots = db.prepare("SELECT COUNT(*) AS count FROM odds_snapshots").get() as { count: number };
    const currentOdds = db.prepare("SELECT COUNT(*) AS count FROM decision_history WHERE current_odds IS NOT NULL").get() as { count: number };
    const decisions = db.prepare("SELECT decision, COUNT(*) AS count FROM decision_history GROUP BY decision ORDER BY decision").all() as Array<{ decision: string; count: number }>;
    return {
      decisionHistory: Number(decisionHistory.count),
      oddsSnapshots: Number(oddsSnapshots.count),
      currentOdds: Number(currentOdds.count),
      decisions: Object.fromEntries(decisions.map((row) => [row.decision, Number(row.count)])),
    };
  } finally {
    db.close();
  }
}

async function writeStatus(extra: Record<string, unknown>) {
  const payload = {
    app: "boat-pon",
    task: "odds-backfill-loop",
    updatedAt: new Date().toISOString(),
    startedAt,
    from: args.from,
    to: args.to,
    batchSize: args.batchSize,
    maxBatches: args.maxBatches,
    maxTotal: args.maxTotal,
    totalOk,
    totalSkip,
    batches,
    ...extra,
  };
  await mkdir(path.dirname(args.statusFile), { recursive: true });
  await writeFile(args.statusFile, JSON.stringify(payload, null, 2), "utf8");
}

function runCommand(command: string, commandArgs: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${commandArgs.join(" ")} failed with code ${code}\n${stderr}`));
    });
  });
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    help: false,
    from: null,
    to: null,
    batchSize: 50,
    maxBatches: 2,
    maxTotal: 100,
    refreshEvery: 100,
    sleepBetweenBatchesMs: 3000,
    dryRun: false,
    statusFile: "/tmp/boat-pon-claude-status.json",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--help" || key === "-h") args.help = true;
    else if (key === "--dry-run") args.dryRun = true;
    else if (key === "--from") { args.from = normalizeDate(value); i += 1; }
    else if (key === "--to") { args.to = normalizeDate(value); i += 1; }
    else if (key === "--batch-size") { args.batchSize = Number(value); i += 1; }
    else if (key === "--max-batches") { args.maxBatches = Number(value); i += 1; }
    else if (key === "--max-total") { args.maxTotal = Number(value); i += 1; }
    else if (key === "--refresh-every") { args.refreshEvery = Number(value); i += 1; }
    else if (key === "--sleep-between-batches-ms") { args.sleepBetweenBatchesMs = Math.max(1000, Number(value)); i += 1; }
    else if (key === "--status-file") { args.statusFile = value; i += 1; }
    else throw new Error(`unknown option: ${key}`);
  }
  return args;
}

function normalizeDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`date must be YYYY-MM-DD: ${value}`);
  return value;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`Boat Pon オッズ補完安全ループ

backfill:odds と generate:history --refresh-existing を機械的に組み合わせる。
Claude/Codexのコンテキスト節約用。自動購入・投票サイト操作・ログイン保存は一切しない。

必須:
  --from YYYY-MM-DD
  --to YYYY-MM-DD

主なオプション:
  --dry-run                       最初のdry-runだけ実行して終了
  --batch-size N                  1バッチの取得件数。最大50。既定値: 50
  --max-batches N                 最大バッチ数。最大20。既定値: 2
  --max-total N                   最大成功取得件数。最大500。既定値: 100
  --refresh-every N               N件成功ごとに既存履歴だけ再計算。既定値: 100
  --sleep-between-batches-ms N    バッチ間隔。最低1000ms。既定値: 3000
  --status-file PATH              完了メモJSON。既定値: /tmp/boat-pon-claude-status.json

例:
  npm run backfill:odds:loop -- --dry-run --from 2025-08-01 --to 2025-08-31
  npm run backfill:odds:loop -- --from 2025-08-01 --to 2025-08-31 --max-total 200 --max-batches 4
`);
}
