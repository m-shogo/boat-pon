import { openDb, upsertMotorBoatStats } from "../server/db";

type Args = {
  dryRun: boolean;
  from: string | null;
  to: string | null;
  limit: number | null;
};

const args = parseArgs(process.argv.slice(2));
const db = openDb();
try {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (args.from) {
    where.push("date >= ?");
    params.push(args.from);
  }
  if (args.to) {
    where.push("date <= ?");
    params.push(args.to);
  }
  const limitSql = args.limit != null ? "LIMIT ?" : "";
  if (args.limit != null) params.push(args.limit);
  const rows = db.prepare(`
SELECT race_id, date, venue, race_no, raw_json
FROM official_programs
${where.length ? `WHERE ${where.join(" AND ")}` : ""}
ORDER BY date ASC, venue ASC, race_no ASC
${limitSql}
`).all(...params) as Array<Record<string, unknown>>;

  let parsed = 0;
  let writtenPrograms = 0;
  for (const row of rows) {
    const raw = JSON.parse(String(row.raw_json)) as Record<string, unknown>;
    parsed += Array.isArray(raw.boats) ? raw.boats.length : 0;
    if (args.dryRun) continue;
    upsertMotorBoatStats(db, {
      raceId: String(row.race_id),
      date: String(row.date),
      venue: String(row.venue),
      raceNo: Number(row.race_no),
      raw,
    });
    writtenPrograms += 1;
  }
  console.log(`motor_boat_stats backfill programs=${rows.length} boatRows=${parsed} writtenPrograms=${writtenPrograms} dryRun=${args.dryRun}`);
} finally {
  db.close();
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, from: null, to: null, limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--dry-run") args.dryRun = true;
    else if (key === "--from") { args.from = normalizeDate(value); i += 1; }
    else if (key === "--to") { args.to = normalizeDate(value); i += 1; }
    else if (key === "--limit") { args.limit = Number(value); i += 1; }
    else throw new Error(`unknown option: ${key}`);
  }
  return args;
}

function normalizeDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`date must be YYYY-MM-DD: ${value}`);
  return value;
}
