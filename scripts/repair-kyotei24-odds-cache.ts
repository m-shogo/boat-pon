import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { openDb, recordOddsSnapshot } from "../server/db";
import { kyotei24OddsUrls, parseKyotei24TrifectaOdds, type Kyotei24OddsTarget } from "../src/domain/kyotei24Odds";

type Args = {
  dryRun: boolean;
  limit: number;
  minOdds: number;
};

const args = parseArgs(process.argv.slice(2));
const db = openDb();
try {
  const rows = db.prepare(`
SELECT race_id, date, venue, race_no, selection, current_odds
FROM decision_history
WHERE current_odds >= ?
ORDER BY current_odds DESC
LIMIT ?
`).all(args.minOdds, args.limit) as Array<Record<string, unknown>>;

  let repaired = 0;
  let skipped = 0;
  for (const row of rows) {
    const target: Kyotei24OddsTarget = {
      raceId: String(row.race_id),
      date: String(row.date),
      venue: String(row.venue),
      raceNo: Number(row.race_no),
      selection: String(row.selection),
    };
    const parsed = parseFromCache(target);
    if (!parsed) {
      skipped += 1;
      console.log(`[skip] ${target.raceId} ${target.selection} cache/parse failed`);
      continue;
    }
    console.log(`[repair${args.dryRun ? ":dry-run" : ""}] ${target.raceId} ${target.selection} ${row.current_odds} -> ${parsed.odds}`);
    if (!args.dryRun) recordOddsSnapshot(db, parsed);
    repaired += 1;
  }
  console.log(`repair done repaired=${repaired} skipped=${skipped} dryRun=${args.dryRun}`);
} finally {
  db.close();
}

function parseFromCache(target: Kyotei24OddsTarget) {
  for (const url of kyotei24OddsUrls(target)) {
    const file = rawCachePath(target, url);
    if (!existsSync(file)) continue;
    const html = readFileSync(file, "utf8");
    const parsed = parseKyotei24TrifectaOdds(html, target);
    if (parsed) return parsed;
  }
  return null;
}

function rawCachePath(target: Kyotei24OddsTarget, url: string) {
  const name = url.includes("/odds3t-") ? "odds3t" : url.includes("/od3t-") ? "od3t" : "od";
  return path.join("data", "raw", "kyotei24", "odds", target.date, `${target.raceId}-${name}.html`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, limit: 50, minOdds: 100 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--dry-run") args.dryRun = true;
    else if (key === "--limit") { args.limit = Number(value); i += 1; }
    else if (key === "--min-odds") { args.minOdds = Number(value); i += 1; }
    else if (key === "--") { /* pnpm separator */ }
    else throw new Error(`unknown option: ${key}`);
  }
  if (args.limit <= 0 || args.limit > 2000) throw new Error("--limit は 1〜2000 にしてください");
  if (args.minOdds < 10) throw new Error("--min-odds は 10 以上にしてください");
  return args;
}
