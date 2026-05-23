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

test("kyotei24の候補URLを3系統作る", () => {
  assert.deepEqual(kyotei24OddsUrls(target), [
    "https://odds.kyotei24.jp/odds3t-karatsu-20250625-3.html",
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

test("艇番をdivで描画する新旧HTML構造から抽出する", () => {
  const html = `
    <table>
      <tr>
        <td>
          <div class="rgs3">
            <div class="r1"><div class="rb">1</div></div>
            <div class="r2"><div class="rb">2</div></div>
            <div class="r3"><div class="rb">3</div></div>
          </div>
        </td>
        <td class="odText">8.7</td>
      </tr>
    </table>
  `;
  const parsed = parseKyotei24TrifectaOdds(html, target, "2026-05-23T00:00:00+09:00");
  assert.equal(parsed?.odds, 8.7);
});

test("非表示の重複オッズを連結せず表示値だけ抽出する", () => {
  const html = `
    <table>
      <tr>
        <td>3<div id="dm-76" style="display: none;">1-2-3</div></td>
        <td><div class="ng20r1">1</div><div class="ng20r2n">2</div><div class="ng20r3n">3</div></td>
        <td class="odds">220.4<div id="od-76" style="display: none;">220.4</div></td>
      </tr>
    </table>
  `;
  const parsed = parseKyotei24TrifectaOdds(html, {
    ...target,
    raceId: "20250804-桐生-02",
    date: "2025-08-04",
    venue: "桐生",
    raceNo: 2,
  }, "2026-05-23T00:00:00+09:00");
  assert.equal(parsed?.odds, 220.4);
});
