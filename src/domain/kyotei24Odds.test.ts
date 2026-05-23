import assert from "node:assert/strict";
import test from "node:test";
import { kyotei24OddsUrls, parseKyotei24TrifectaOdds } from "./kyotei24Odds";

const target = {
  raceId: "20250625-唐津-03",
  date: "2025-06-25",
  venue: "唐津",
  raceNo: 3,
  selection: "1-2-3",
};

test("kyotei24の候補URLを2系統作る", () => {
  assert.deepEqual(kyotei24OddsUrls(target), [
    "https://odds.kyotei24.jp/od3t-karatsu-20250625-3.html",
    "https://odds.kyotei24.jp/od-20250625-23-3.html",
  ]);
});

test("人気順テーブルから3連単オッズを抽出する", () => {
  const html = `
    <table>
      <tr><th>人気</th><th>組番</th><th>オッズ</th></tr>
      <tr><td>1番</td><td>1-2-3</td><td>12.4</td></tr>
      <tr><td>2番</td><td>1-3-2</td><td>13.6</td></tr>
    </table>
  `;
  const parsed = parseKyotei24TrifectaOdds(html, target, "2026-05-23T00:00:00+09:00");
  assert.equal(parsed?.odds, 12.4);
  assert.equal(parsed?.popularity, 1);
  assert.equal(parsed?.isFinalLike, true);
});

test("テキスト化された人気順からも抽出できる", () => {
  const html = `<main> 1番 1 2 3 15.7 2番 1 3 2 18.2 </main>`;
  const parsed = parseKyotei24TrifectaOdds(html, target, "2026-05-23T00:00:00+09:00");
  assert.equal(parsed?.odds, 15.7);
  assert.equal(parsed?.selection, "1-2-3");
});
