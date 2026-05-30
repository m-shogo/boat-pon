import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseKyotei24Results } from "../src/domain/parser";
import { insertResult, openDb } from "../server/db";

export { parseKyotei24Results };

export async function parseSavedKyotei24(date: string) {
  const rawPath = path.join("data", "raw", "kyotei24", "results", `${date}.html`);
  const normalizedDir = path.join("data", "normalized", "results");
  const normalizedPath = path.join(normalizedDir, `${date}.json`);

  if (!existsSync(rawPath)) {
    throw new Error(`raw file not found: ${rawPath}. Run npm run fetch:kyotei24 first.`);
  }

  const html = await readFile(rawPath, "utf8");
  const fetchedAt = new Date().toISOString();
  const results = parseKyotei24Results(html, date, fetchedAt);

  await mkdir(normalizedDir, { recursive: true });
  await writeFile(normalizedPath, JSON.stringify({ source: "kyotei24", date, fetchedAt, results }, null, 2), "utf8");

  const db = openDb();
  for (const result of results) {
    insertResult(db, result);
  }
  db.close();

  return { normalizedPath, count: results.length };
}

if (process.argv[1]?.endsWith("import-kyotei24.ts")) {
  const date = process.argv[2] ?? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
  const result = await parseSavedKyotei24(date);
  console.log(`normalized ${result.count} results: ${result.normalizedPath}`);
}
