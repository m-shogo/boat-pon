/**
 * 既存の公式K結果アーカイブ（data/raw/official/results/k*.lzh, 2000-2026）を再パースして
 * race_conditions / race_entries / race_payouts に保存する。
 *
 * ダウンロードは行わない（既存.lzhのみ使用＝外部アクセスゼロ）。
 * 解凍: unar → Shift_JIS デコード。日単位トランザクション。
 *
 * usage:
 *   tsx scripts/reparse-official-results.ts [--dry-run] [--skip-existing] [--from YYMMDD] [--to YYMMDD] [--limit N]
 *
 * 例:
 *   tsx scripts/reparse-official-results.ts --dry-run --limit 3
 *   tsx scripts/reparse-official-results.ts --skip-existing
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { openDb, saveResultDetail } from "../server/db";
import { parseOfficialResultDetail } from "../src/domain/officialResultDetailParser";

const RESULTS_DIR = path.join("data", "raw", "official", "results");
const TMP_DIR = path.join("data", "tmp");

function argValue(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}
const dryRun = process.argv.includes("--dry-run");
const skipExisting = process.argv.includes("--skip-existing");
const fromArg = argValue("--from"); // YYMMDD
const toArg = argValue("--to");
const limit = argValue("--limit") ? Number(argValue("--limit")) : Infinity;

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function yymmddToDate(yymmdd: string): string {
  const yy = Number(yymmdd.slice(0, 2));
  const yyyy = yy < 70 ? 2000 + yy : 1900 + yy;
  return `${yyyy}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
}

const db = openDb();
try {
  let files = readdirSync(RESULTS_DIR).filter((f) => /^k\d{6}\.lzh$/.test(f)).sort();
  if (fromArg) files = files.filter((f) => f.slice(1, 7) >= fromArg);
  if (toArg) files = files.filter((f) => f.slice(1, 7) <= toArg);

  const existingDates = new Set<string>();
  if (skipExisting) {
    for (const r of db.prepare("SELECT DISTINCT date FROM race_conditions").all() as Array<{ date: string }>) {
      existingDates.add(r.date);
    }
    log(`skip-existing: race_conditions に ${existingDates.size} 日分あり`);
  }

  const fetchedAt = new Date().toISOString();
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let totalRaces = 0;
  let totalEntries = 0;
  let totalPayouts = 0;

  for (const f of files) {
    if (processed >= limit) break;
    const yymmdd = f.slice(1, 7);
    const fallbackDate = yymmddToDate(yymmdd);
    if (skipExisting && existingDates.has(fallbackDate)) { skipped++; continue; }

    let txt: string;
    const txtPath = path.join(TMP_DIR, `K${yymmdd}.TXT`);
    try {
      try { rmSync(txtPath); } catch { /* not present */ }
      execFileSync("unar", ["-q", "-o", TMP_DIR, "-f", path.join(RESULTS_DIR, f)]);
      txt = new TextDecoder("shift_jis").decode(readFileSync(txtPath));
    } catch (err) {
      failed++;
      log(`FAIL extract ${f}: ${(err as Error).message}`);
      continue;
    }

    const parsed = parseOfficialResultDetail(txt, { date: fallbackDate, fetchedAt });
    if (!dryRun) {
      db.exec("BEGIN");
      try {
        saveResultDetail(db, parsed);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        failed++;
        log(`FAIL save ${f}: ${(err as Error).message}`);
        try { rmSync(txtPath); } catch { /* ignore */ }
        continue;
      }
    }
    totalRaces += parsed.conditions.length;
    totalEntries += parsed.entries.length;
    totalPayouts += parsed.payouts.length;
    processed++;
    try { rmSync(txtPath); } catch { /* ignore */ }

    if (processed % 200 === 0) {
      log(`progress: ${processed} files / races=${totalRaces} entries=${totalEntries} payouts=${totalPayouts} (last ${f})`);
    }
    if (dryRun && processed <= 3) {
      log(`dry-run ${f}: cond=${parsed.conditions.length} entries=${parsed.entries.length} payouts=${parsed.payouts.length}`);
    }
  }

  log(`DONE processed=${processed} skipped=${skipped} failed=${failed} races=${totalRaces} entries=${totalEntries} payouts=${totalPayouts} dryRun=${dryRun}`);
} finally {
  db.close();
}
