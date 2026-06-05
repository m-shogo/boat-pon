import { judgeCandidate } from "../src/domain/decision";
import { DEFAULT_MODEL_ALPHA, buildCandidatesFromModel, buildVenueModel, type ModelCandidateInput } from "../src/domain/model";
import { filterComparableResultsForDate } from "../src/domain/raceRegime";
import { mergeOddsMaps } from "../src/domain/oddsSnapshot";
import { getManualOdds, getSettings, insertDecisionHistory, listOddsSnapshots, listProgramInputsRange, listProgramInputsWithOddsSnapshotsRange, listResultsForModelRange, openDb } from "../server/db";
import { assertGenerateHistoryWriteAllowed } from "../src/domain/liveRunKind";
import type { DatabaseSync } from "node:sqlite";

// 2026-01-01 以降は live監視の完全未使用データ。generate:history での書き込みは汚染になるため
// --allow-live-write フラグなしでは実行を拒否する。
const LIVE_GUARD_FROM = "2026-01-01";

type Args = {
  help: boolean;
  from: string | null;
  to: string | null;
  limit: number | null;
  dryRun: boolean;
  includeSkips: boolean;
  includeRequiredOddsCandidates: boolean;
  refreshExisting: boolean;
  refreshOnly: boolean;
  minTrainRaceCount: number | null;
  trainDays: number;
  alpha: number;
  allowLiveWrite: boolean;
};

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}
if (!args.from || !args.to || args.limit == null || args.limit <= 0) {
  throw new Error("usage: tsx scripts/generate-decision-history.ts --from YYYY-MM-DD --to YYYY-MM-DD --limit N [--dry-run] [--include-skips]");
}
// 2026 live監視ガード: --to が LIVE_GUARD_FROM 以降を含む場合は明示フラグが必須
try {
  assertGenerateHistoryWriteAllowed({ to: args.to, dryRun: args.dryRun, allowLiveWrite: args.allowLiveWrite }, LIVE_GUARD_FROM);
} catch {
  console.error(`
[GUARD] --to ${args.to} は live監視期間（${LIVE_GUARD_FROM}以降）を含みます。
        generate:history を 2026年以降に実行すると /api/live/b1-monitor の
        監視データが汚染されます。

        意図的に実行する場合のみ --allow-live-write を付けてください:
          npm run generate:history -- --from ... --to ... --limit N --allow-live-write

        内容確認だけなら --dry-run を使ってください（ガード対象外）。
`);
  process.exit(1);
}

const db = openDb();
try {
  const settings = getSettings(db);
  const minTrainRaceCount = args.minTrainRaceCount ?? settings.minSampleSize;
  const oddsByRaceId = mergeOddsMaps(getManualOdds(db), listOddsSnapshots(db));
  const trainFrom = addDays(args.from, -args.trainDays);
  const allResults = listResultsForModelRange(db, trainFrom, args.to);
  const programs = args.refreshExisting && args.refreshOnly
    ? listProgramInputsWithOddsSnapshotsRange(db, args.from, args.to, args.limit)
    : listProgramInputsRange(db, args.from, args.to, args.limit);
  const existingKeys = loadExistingDecisionKeys(db, args.from, args.to);
  const existingRaceIds = loadExistingDecisionRaceIds(db, args.from, args.to);

  let generated = 0;
  let written = 0;
  let skippedExisting = 0;
  let refreshedExisting = 0;
  const modelCache = new Map<string, ReturnType<typeof buildVenueModel>>();

  for (const program of programs) {
    const trainResults = getTrainResults(allResults, program.date, modelCache, minTrainRaceCount, args.alpha);
    const candidates = buildCandidatesFromModel(
      [program as ModelCandidateInput],
      trainResults,
      settings.targetEv,
      program.date + "T00:00:00+09:00",
      oddsByRaceId,
    );
    const candidate = candidates[0];
    if (!candidate) continue;
    const decision = judgeCandidate(candidate, settings, {
      now: beforeCloseTime(program.date, program.closeAt, settings.minMinutesBeforeClose + 10),
      buyCountToday: 0,
      reservedBudgetYen: 0,
    });
    const isRequiredOddsCandidate = args.includeRequiredOddsCandidates &&
      candidate.currentOdds == null &&
      candidate.sampleSize >= settings.minSampleSize &&
      decision.requiredOdds <= 80;
    const key = decisionKey(candidate.raceId, candidate.selection.join("-"));
    const isExisting = existingKeys.has(key);
    const isExistingRace = existingRaceIds.has(candidate.raceId);
    if (args.refreshOnly && !isExisting && !isExistingRace) continue;
    if (!args.includeSkips && decision.status === "SKIP" && !isRequiredOddsCandidate && !((isExisting || isExistingRace) && args.refreshExisting)) continue;
    if ((isExisting || isExistingRace) && !args.refreshExisting) {
      skippedExisting += 1;
      continue;
    }
    generated += 1;
    if (args.dryRun) {
      const marker = isExisting ? "refresh" : "new";
      console.log(`[dry-run:${marker}] ${candidate.raceId} ${candidate.selection.join("-")} ${decision.status} odds=${candidate.currentOdds ?? "-"} ev=${decision.ev?.toFixed(2) ?? "-"}`);
      continue;
    }
    insertDecisionHistory(db, candidate, decision, {
      replaceRace: args.refreshExisting && args.refreshOnly,
      runKind: "historical-backfill",
    });
    if (isExisting || isExistingRace) refreshedExisting += 1;
    existingKeys.add(key);
    existingRaceIds.add(candidate.raceId);
    written += 1;
  }

  console.log(`decision history generated=${generated} written=${written} refreshedExisting=${refreshedExisting} skippedExisting=${skippedExisting} dryRun=${args.dryRun} programs=${programs.length}`);
} finally {
  db.close();
}

function loadExistingDecisionKeys(db: DatabaseSync, from: string, to: string) {
  const rows = db.prepare(`
SELECT race_id, selection
FROM decision_history
WHERE date >= ? AND date <= ?
`).all(from, to) as Array<Record<string, unknown>>;
  return new Set(rows.map((row) => decisionKey(String(row.race_id), String(row.selection))));
}

function loadExistingDecisionRaceIds(db: DatabaseSync, from: string, to: string) {
  const rows = db.prepare(`
SELECT DISTINCT race_id
FROM decision_history
WHERE date >= ? AND date <= ?
`).all(from, to) as Array<Record<string, unknown>>;
  return new Set(rows.map((row) => String(row.race_id)));
}

function decisionKey(raceId: string, selection: string) {
  return `${raceId}|${selection}`;
}

function getTrainResults(
  allResults: ReturnType<typeof listResultsForModelRange>,
  date: string,
  cache: Map<string, ReturnType<typeof buildVenueModel>>,
  minTrainRaceCount: number,
  alpha: number,
) {
  const key = `${date}|${minTrainRaceCount}|${alpha}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const comparable = filterComparableResultsForDate(allResults.filter((row) => row.date < date), date);
  const model = buildVenueModel(comparable, minTrainRaceCount, alpha);
  cache.set(key, model);
  return model;
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00+09:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function beforeCloseTime(date: string, closeAt: string, minutesBeforeClose: number) {
  const [hour, minute] = closeAt.split(":").map(Number);
  const base = new Date(`${date}T00:00:00+09:00`);
  base.setHours(hour, minute, 0, 0);
  return new Date(base.getTime() - minutesBeforeClose * 60_000);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { help: false, from: null, to: null, limit: null, dryRun: false, includeSkips: false, includeRequiredOddsCandidates: false, refreshExisting: false, refreshOnly: false, minTrainRaceCount: null, trainDays: 180, alpha: DEFAULT_MODEL_ALPHA, allowLiveWrite: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--help" || key === "-h") args.help = true;
    else if (key === "--allow-live-write") args.allowLiveWrite = true;
    else if (key === "--dry-run") args.dryRun = true;
    else if (key === "--include-skips") args.includeSkips = true;
    else if (key === "--include-required-odds-candidates") args.includeRequiredOddsCandidates = true;
    else if (key === "--refresh-existing") args.refreshExisting = true;
    else if (key === "--refresh-only") args.refreshOnly = true;
    else if (key === "--from") { args.from = normalizeDate(value); i += 1; }
    else if (key === "--to") { args.to = normalizeDate(value); i += 1; }
    else if (key === "--limit") { args.limit = Number(value); i += 1; }
    else if (key === "--min-train") { args.minTrainRaceCount = Number(value); i += 1; }
    else if (key === "--train-days") { args.trainDays = Number(value); i += 1; }
    else if (key === "--alpha") { args.alpha = Number(value); i += 1; }
    else if (key === "--") { /* pnpm separator */ }
    else throw new Error(`unknown option: ${key}`);
  }
  return args;
}

function normalizeDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`date must be YYYY-MM-DD: ${value}`);
  return value;
}

function printHelp() {
  console.log(`Boat Pon 判定履歴生成CLI

保存済みの公式番組表・結果・オッズスナップショットだけを使い、外部サイトへアクセスせずに decision_history を生成/更新する。

必須:
  --from YYYY-MM-DD
  --to YYYY-MM-DD
  --limit N

主なオプション:
  --dry-run                          保存せず対象だけ表示
  --include-required-odds-candidates オッズ未取得でも必要オッズ80倍以下の候補を保存対象にする
  --include-skips                    SKIPも保存/更新対象にする
  --refresh-existing                 既存履歴を補完済みオッズで再計算する
  --refresh-only                     既存履歴だけを更新し、新規履歴は作らない
  --train-days N                     学習に使う過去日数。既定値: 180
  --min-train N                      会場モデルの最小サンプル数。未指定なら設定値
  --alpha N                          Laplaceスムージング係数。既定値: ${DEFAULT_MODEL_ALPHA}
  --allow-live-write                 ${LIVE_GUARD_FROM}以降への書き込みを許可する（通常は禁止）

例:
  npm run generate:history -- --dry-run --from 2026-05-01 --to 2026-05-21 --limit 100 --include-required-odds-candidates
  npm run generate:history -- --from 2025-05-01 --to 2025-05-21 --limit 100 --refresh-existing --refresh-only --include-skips
`);
}
