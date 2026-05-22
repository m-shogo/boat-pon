import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseOfficialProgramsText } from "./officialProgramParser";

const buf = readFileSync(path.join("tests", "fixtures", "B260520.TXT"));
const text = new TextDecoder("shift_jis").decode(buf);

test("公式番組表から複数会場のレース予定をパースする", () => {
  const rows = parseOfficialProgramsText(text, { date: "2026-05-20" });
  assert.ok(rows.length >= 50, `50件以上ではなく ${rows.length} 件`);
  const venues = new Set(rows.map((row) => row.venue));
  assert.ok(venues.size >= 3, "3会場以上");
});

test("芦屋1Rの締切時刻が抽出できる", () => {
  const rows = parseOfficialProgramsText(text, { date: "2026-05-20" });
  const ashiya1 = rows.find((row) => row.venue === "芦屋" && row.raceNo === 1);
  assert.ok(ashiya1, "芦屋1Rが見つかる");
  assert.match(ashiya1!.closeAt, /^\d{2}:\d{2}$/);
  assert.equal(ashiya1!.boats.length, 6);
  assert.equal(ashiya1!.boats[0].course, 1);
  assert.equal(ashiya1!.boats[0].registrationNo, "4772");
  assert.equal(ashiya1!.boats[0].racerName, "石丸海渡");
  assert.equal(ashiya1!.boats[0].nationalWinRate, 6.40);
  assert.equal(ashiya1!.boats[0].nationalTop2Rate, 50.41);
  assert.equal(ashiya1!.boats[0].motorNo, "17");
  assert.equal(ashiya1!.boats[0].motorTop2Rate, 22.22);
  assert.equal(ashiya1!.boats[0].boatNo, "138");
  assert.equal(ashiya1!.boats[0].boatTop2Rate, 39.29);
});

test("dateとraceNoが整っている", () => {
  const rows = parseOfficialProgramsText(text, { date: "2026-05-20" });
  for (const row of rows) {
    assert.equal(row.date, "2026-05-20");
    assert.ok(row.raceNo >= 1 && row.raceNo <= 12);
  }
});

test("旧フォーマット（○○競艇場）の番組表もパースできる", () => {
  const oldBuf = readFileSync(path.join("tests", "fixtures", "B040601.TXT"));
  const oldText = new TextDecoder("shift_jis").decode(oldBuf);
  const rows = parseOfficialProgramsText(oldText, { date: "2004-06-01" });
  assert.ok(rows.length >= 50, `旧フォーマット50件以上ではなく ${rows.length} 件`);
  const venues = new Set(rows.map((row) => row.venue));
  assert.ok(venues.size >= 3, "旧フォーマット3会場以上");
  const karatsu1 = rows.find((row) => row.venue === "唐津" && row.raceNo === 1);
  assert.ok(karatsu1, "唐津1Rが見つかる");
  assert.equal(karatsu1!.closeAt, "10:57");
  assert.equal(karatsu1!.boats.length, 6);
  assert.equal(karatsu1!.boats[0].registrationNo, "2167");
  assert.equal(karatsu1!.boats[0].racerName, "田代敏明");
  assert.equal(karatsu1!.boats[0].nationalWinRate, 3.36);
  assert.equal(karatsu1!.boats[0].boatTop2Rate, 25.00);
});
