import assert from "node:assert/strict";
import test from "node:test";
import { parseBeforeInfoHtml, parseEquipmentHtml, parseStartExhibitionOrder, parseWindDirection } from "./beforeInfoParser";

test("公式直前情報HTMLから展示・チルト・部品交換を抽出する", () => {
  const html = `
    <table>
      <thead>
        <tr>
          <th rowspan="2">枠</th><th rowspan="2">写真</th><th rowspan="2">ボートレーサー</th>
          <th>体重</th><th rowspan="2">展示<br />タイム</th><th rowspan="2">チルト</th>
          <th rowspan="2">プロペラ</th><th rowspan="2">部品交換</th><th colspan="2">前走成績</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td rowspan="4">1</td><td></td><td>選手A</td><td>52.0kg</td><td rowspan="4">6.72</td>
          <td rowspan="4">-0.5</td><td rowspan="4">新</td>
          <td rowspan="4"><ul><li><span>リング</span></li><li><span>キャブ</span></li></ul></td><td>R</td><td></td>
        </tr>
      </tbody>
      <tbody>
        <tr>
          <td rowspan="4">2</td><td></td><td>選手B</td><td>52.1kg</td><td rowspan="4">6.81</td>
          <td rowspan="4">0.0</td><td rowspan="4">&nbsp;</td><td rowspan="4">&nbsp;</td><td>R</td><td></td>
        </tr>
      </tbody>
    </table>
    <table>
      <thead><tr><th colspan="3">スタート展示</th></tr><tr><th>コース</th><th>並び</th><th>ST</th></tr></thead>
      <tbody>
        <tr><td colspan="3">1 .13</td></tr>
        <tr><td colspan="3">2 .21</td></tr>
      </tbody>
    </table>
    <div class="weather1">
      <div class="weather1_bodyUnit is-weather"><span class="weather1_bodyUnitLabelTitle">晴</span></div>
      <div class="weather1_bodyUnit is-wind"><span class="weather1_bodyUnitLabelData">3m</span></div>
      <div class="weather1_bodyUnit is-wave"><span class="weather1_bodyUnitLabelData">2cm</span></div>
    </div>
  `;

  const parsed = parseBeforeInfoHtml(html);
  assert.deepEqual(parsed.exhibition, [
    { course: 1, exhibitionTime: 6.72, startTiming: 0.13, ranking: null },
    { course: 2, exhibitionTime: 6.81, startTiming: 0.21, ranking: null },
  ]);
  assert.equal(parsed.weather?.weather, "晴");
  assert.equal(parsed.weather?.windSpeedMps, 3);
  assert.equal(parsed.equipment[0].tiltAngle, -0.5);
  assert.equal(parsed.equipment[0].propellerChanged, true);
  assert.deepEqual(parsed.equipment[0].partsChanged, ["ピストンリング", "キャブレター"]);
  assert.equal(parsed.equipment[1].partsChangedCount, 0);
});

test("部品交換が空なら空配列にする", () => {
  assert.deepEqual(parseEquipmentHtml("<table><thead><tr><th>枠</th><th>チルト</th><th>部品交換</th></tr></thead></table>"), []);
});

// 公式の直前情報のスタート展示と水面気象の作り（2026-11-19 の平和島 2R のページの形を縮めたもの）
const startRow = (boat: number, time: string) => `<tr><td colspan="3"><div class="table1_boatImage1"><span class="table1_boatImage1Number is-type${boat}">${boat}</span><span class="table1_boatImage1Line"><span class="table1_boatImage1Boat" style="left: 60%;"></span></span><span class="table1_boatImage1Time${time.startsWith("F") ? " is-fBold is-fColor1" : ""}">${time}</span></div></td></tr>`;
const weatherBlock = `<div class="weather1"><div class="weather1_body">
<div class="weather1_bodyUnit is-direction"><p class="weather1_bodyUnitImage is-direction5"></p><div class="weather1_bodyUnitLabel"><span class="weather1_bodyUnitLabelTitle">気温</span><span class="weather1_bodyUnitLabelData">15.0℃</span></div></div>
<div class="weather1_bodyUnit is-wind"><div class="weather1_bodyUnitLabel"><span class="weather1_bodyUnitLabelTitle">風速</span><span class="weather1_bodyUnitLabelData">3m</span></div></div>
<div class="weather1_bodyUnit is-windDirection"><p class="weather1_bodyUnitImage is-wind3"></p></div>
<div class="weather1_bodyUnit is-wave"><div class="weather1_bodyUnitLabel"><span class="weather1_bodyUnitLabelTitle">波高</span><span class="weather1_bodyUnitLabelData">2cm</span></div></div>
</div></div>`;

test("スタート展示の並び: 上の行から 1 コース、F は flying にする、前づけは艇番と行がずれる", () => {
  const html = `<table><thead><tr><th colspan="3">スタート展示</th></tr></thead><tbody>${[startRow(1, ".02"), startRow(2, ".09"), startRow(4, "F.06"), startRow(3, ".03"), startRow(5, ".11"), startRow(6, "F.09")].join("")}</tbody></table>`;
  assert.deepEqual(parseStartExhibitionOrder(html), [
    { position: 1, boat: 1, st: 0.02, flying: false },
    { position: 2, boat: 2, st: 0.09, flying: false },
    { position: 3, boat: 4, st: 0.06, flying: true },
    { position: 4, boat: 3, st: 0.03, flying: false },
    { position: 5, boat: 5, st: 0.11, flying: false },
    { position: 6, boat: 6, st: 0.09, flying: true },
  ]);
});

test("スタート展示がまだ無いページでは空", () => {
  assert.deepEqual(parseStartExhibitionOrder(`<table><tbody><tr><td colspan="3"></td></tr></tbody></table>`), []);
});

test("風向きと場の向きの絵の番号を読む", () => {
  assert.deepEqual(parseWindDirection(weatherBlock), { windCode: 3, venueDirectionCode: 5 });
  assert.equal(parseWindDirection("<div></div>"), null);
  const snapshot = parseBeforeInfoHtml(weatherBlock);
  assert.deepEqual(snapshot.windDirection, { windCode: 3, venueDirectionCode: 5 });
  assert.equal(snapshot.weather?.windSpeedMps, 3);
});
