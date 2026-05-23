import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { recordOddsSnapshot, openDb } from "../server/db";
import { kyotei24OddsUrls, parseKyotei24TrifectaOdds, type Kyotei24OddsTarget } from "../src/domain/kyotei24Odds";
import type { OddsSnapshot } from "../src/domain/oddsSnapshot";

type Args = {
  limit: number | null;
  dryRun: boolean;
  from: string | null;
  to: string | null;
  source: "kyotei24";
  raceId: string | null;
  selection: string | null;
  includeExisting: boolean;
  includeSkipRequiredOdds: boolean;
  sleepMs: number;
};

const args = parseArgs(process.argv.slice(2));
if (args.limit == null || args.limit <= 0) {
  throw new Error("安全のため --limit <件数> は必須です。例: tsx scripts/backfill-odds.ts --dry-run --limit 10");
}

const db = openDb();
try {
  const targets = listTargets(args).slice(0, args.limit);
  console.log(`odds backfill targets: ${targets.length} source=${args.source} dryRun=${args.dryRun}`);
  for (const target of targets) {
    const urls = kyotei24OddsUrls(target);
    if (args.dryRun) {
      console.log(`[dry-run] ${target.raceId} ${target.selection} -> ${urls.join(" | ")}`);
      continue;
    }
    const result = await fetchAndParseKyotei24(target, urls);
    if (!result) {
      console.log(`[skip] ${target.raceId} ${target.selection} parse/fetch failed`);
      await sleep(args.sleepMs);
      continue;
    }
    recordOddsSnapshot(db, result);
    console.log(`[ok] ${target.raceId} ${target.selection} ${result.odds}倍 source=${result.source}`);
    await sleep(args.sleepMs);
  }
} finally {
  db.close();
}

function listTargets(args: Args): Kyotei24OddsTarget[] {
  if (args.raceId) {
    const direct = directTarget(args.raceId, args.selection);
    if (direct) return [direct];
  }

  const params: Array<string | number> = [];
  const where: string[] = ["selection IS NOT NULL", "selection != ''"];
  if (args.raceId) {
    where.push("race_id = ?");
    params.push(args.raceId);
  }
  if (args.from) {
    where.push("date >= ?");
    params.push(args.from);
  }
  if (args.to) {
    where.push("date <= ?");
    params.push(args.to);
  }
  if (!args.includeExisting) {
    where.push("(current_odds IS NULL OR current_odds <= 0)");
    where.push("NOT EXISTS (SELECT 1 FROM odds_snapshots os WHERE os.race_id = decision_history.race_id AND os.selection = decision_history.selection)");
  }

  const decisionFilter = args.includeSkipRequiredOdds
    ? "decision IN ('BUY', 'WATCH', 'SKIP') AND required_odds <= 80"
    : "decision IN ('BUY', 'WATCH')";

  const rows = db.prepare(`
SELECT race_id, date, venue, race_no, selection, decision, current_odds, created_at
FROM decision_history
WHERE ${where.join(" AND ")}
  AND ${decisionFilter}
ORDER BY date ASC, created_at ASC, id ASC
LIMIT ?
`).all(...params, args.limit) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    raceId: String(row.race_id),
    date: String(row.date),
    venue: String(row.venue),
    raceNo: Number(row.race_no),
    selection: String(row.selection),
  }));
}

function directTarget(raceId: string, selection: string | null): Kyotei24OddsTarget | null {
  if (!selection) return null;
  const match = raceId.match(/^(\d{8})-(.+)-(\d{2})$/);
  if (!match) throw new Error(`race-id must be YYYYMMDD-会場-RR: ${raceId}`);
  return {
    raceId,
    date: `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}`,
    venue: match[2],
    raceNo: Number(match[3]),
    selection,
  };
}

async function fetchAndParseKyotei24(target: Kyotei24OddsTarget, urls: string[]): Promise<OddsSnapshot | null> {
  for (const url of urls) {
    const rawPath = rawCachePath(target, url);
    let html: string;
    try {
      html = existsSync(rawPath)
        ? await readFile(rawPath, "utf8")
        : await fetchWithCache(url, rawPath);
    } catch {
      continue;
    }
    const parsed = parseKyotei24TrifectaOdds(html, target);
    if (!parsed) continue;
    const normalizedPath = normalizedCachePath(target);
    await mkdir(path.dirname(normalizedPath), { recursive: true });
    await writeFile(normalizedPath, JSON.stringify(parsed, null, 2), "utf8");
    return parsed;
  }
  return null;
}

async function fetchWithCache(url: string, outPath: string) {
  const res = await fetch(url, {
    headers: { "user-agent": "BoatPon/0.1 personal low-frequency odds backfill" },
  });
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`);
  const html = await res.text();
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, html, "utf8");
  return html;
}

function rawCachePath(target: Kyotei24OddsTarget, url: string) {
  const name = url.includes("/odds3t-") ? "odds3t" : url.includes("/od3t-") ? "od3t" : "od";
  return path.join("data", "raw", "kyotei24", "odds", target.date, `${target.raceId}-${name}.html`);
}

function normalizedCachePath(target: Kyotei24OddsTarget) {
  return path.join("data", "normalized", "odds", target.date, `${target.raceId}.json`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { limit: null, dryRun: false, from: null, to: null, source: "kyotei24", raceId: null, selection: null, includeExisting: false, includeSkipRequiredOdds: false, sleepMs: 1500 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--dry-run") args.dryRun = true;
    else if (key === "--include-existing") args.includeExisting = true;
    else if (key === "--include-skip-required-odds") args.includeSkipRequiredOdds = true;
    else if (key === "--limit") { args.limit = Number(value); i += 1; }
    else if (key === "--from") { args.from = normalizeDate(value); i += 1; }
    else if (key === "--to") { args.to = normalizeDate(value); i += 1; }
    else if (key === "--race-id") { args.raceId = value; i += 1; }
    else if (key === "--selection") { args.selection = value; i += 1; }
    else if (key === "--sleep-ms") { args.sleepMs = Math.max(1000, Number(value)); i += 1; }
    else if (key === "--source") {
      if (value !== "kyotei24") throw new Error("現時点の過去補完 source は kyotei24 のみです");
      args.source = value;
      i += 1;
    } else {
      throw new Error(`unknown option: ${key}`);
    }
  }
  return args;
}

function normalizeDate(value: string | undefined) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`date must be YYYY-MM-DD: ${value}`);
  return value;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
