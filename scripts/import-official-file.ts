import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { insertOfficialProgram, openDb } from "../server/db";

const file = process.argv[2];
if (!file) {
  throw new Error("usage: npm run import:official -- /path/to/program.csv");
}

const text = await readFile(file, "utf8");
const rows = parseDelimited(text);
const rawDir = path.join("data", "raw", "official");
await mkdir(rawDir, { recursive: true });
await writeFile(path.join(rawDir, path.basename(file)), text, "utf8");

const db = openDb();
let imported = 0;
for (const raw of rows) {
  const date = normalizeDate(raw.date ?? raw["日付"] ?? raw.hd ?? raw.HD);
  const venue = String(raw.venue ?? raw["会場"] ?? raw.jo ?? raw["場"] ?? "").trim();
  const raceNo = Number(raw.raceNo ?? raw["R"] ?? raw["レース"] ?? raw.rno);
  const closeAt = String(raw.closeAt ?? raw["締切"] ?? raw.deadline ?? "12:00").trim();
  if (!date || !venue || !Number.isFinite(raceNo)) continue;
  const raceId = `${date.replaceAll("-", "")}-${venue}-${String(raceNo).padStart(2, "0")}`;
  insertOfficialProgram(db, { raceId, date, venue, raceNo, closeAt, sourceFile: file, raw });
  imported += 1;
}
db.close();
console.log(`imported official program rows: ${imported}`);

function parseDelimited(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return [];
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = splitLine(lines[0], delimiter);
  return lines.slice(1).map((line) => {
    const values = splitLine(line, delimiter);
    return Object.fromEntries(headers.map((header, index) => [header.trim(), values[index]?.trim() ?? ""]));
  });
}

function splitLine(line: string, delimiter: string) {
  if (delimiter === "\t") return line.split("\t");
  return line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((value) => value.replace(/^"|"$/g, ""));
}

function normalizeDate(value: unknown) {
  const s = String(value ?? "").trim();
  const m = s.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);
  if (!m) return "";
  return `${m[1]}-${m[2]}-${m[3]}`;
}
