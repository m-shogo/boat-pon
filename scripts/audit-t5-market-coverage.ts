/** T-5全120通りの収集率を公式番組母数で測るread-only監査。 */
import { DatabaseSync } from "node:sqlite";
import { evaluateT5MarketCoverage } from "../src/domain/t5MarketCoverage";

const argv = process.argv.slice(2);
const from = valueOf("--from") ?? "2026-06-01";
const to = valueOf("--to") ?? todayJst();
const json = argv.includes("--json");
const strict = argv.includes("--strict");
const db = new DatabaseSync("data/boat.sqlite", { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 30000;");

try {
  const programsInWindow = db.prepare(`
    SELECT race_id, date FROM official_programs
    WHERE date >= ? AND date <= ?
    ORDER BY date, race_id
  `).all(from, to) as Array<{ race_id: string; date: string }>;
  const settled = new Set((db.prepare(`
    SELECT race_id FROM race_results WHERE date >= ? AND date <= ? AND returned = 0
  `).all(from, to) as Array<{ race_id: string }>).map(row => row.race_id));
  // checkpoint_label単独の索引走査を避け、race_id先頭の既存複合索引をレースごとに使う。
  const countT5 = db.prepare(`
    SELECT COALESCE(MAX(n), 0) AS n FROM (
      SELECT COUNT(DISTINCT selection) AS n
      FROM odds_timeseries_snapshots
      WHERE race_id = ? AND checkpoint_label = 'T-5'
      GROUP BY captured_at
    )
  `);
  const rows = programsInWindow.map(program => ({
    ...program,
    selections: Number((countT5.get(program.race_id) as { n: number }).n),
    settled: settled.has(program.race_id) ? 1 : 0,
  }));

  const programs = rows.length;
  const racesWithT5 = rows.filter(row => row.selections > 0).length;
  const fullMarketRaces = rows.filter(row => row.selections >= 120).length;
  const settledFullMarketRaces = rows.filter(row => row.selections >= 120 && row.settled === 1).length;
  const gate = evaluateT5MarketCoverage({ programs, fullMarketRaces, settledFullMarketRaces });
  const byDate = [...new Set(rows.map(row => row.date))].map(date => {
    const daily = rows.filter(row => row.date === date);
    const full = daily.filter(row => row.selections >= 120).length;
    return { date, programs: daily.length, racesWithT5: daily.filter(row => row.selections > 0).length, fullMarketRaces: full, coverage: daily.length > 0 ? full / daily.length : 0 };
  });
  const report = {
    generatedAt: new Date().toISOString(),
    window: { from, to },
    safety: { readOnly: true, productionConnected: false, dbWrites: false },
    summary: { programs, racesWithT5, fullMarketRaces, settledFullMarketRaces },
    gate,
    byDate,
  };

  if (json) console.log(JSON.stringify(report));
  else {
    console.log("=== T-5 full-market coverage audit (read-only) ===");
    console.log(`window: ${from}..${to}`);
    console.log(`programs=${programs} / any T-5=${racesWithT5} / full120=${fullMarketRaces} / settled full120=${settledFullMarketRaces}`);
    console.log(`coverage=${(gate.coverage * 100).toFixed(2)}%`);
    console.log(`research gate: ${gate.passed ? "PASS" : `BLOCKED (${gate.reasons.join(" / ")})`}`);
  }
  if (strict && !gate.passed) process.exitCode = 2;
} finally {
  db.close();
}

function valueOf(name: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function todayJst() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}
