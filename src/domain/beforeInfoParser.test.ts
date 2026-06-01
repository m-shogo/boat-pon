import assert from "node:assert/strict";
import test from "node:test";
import { parseBeforeInfoHtml, parseEquipmentHtml } from "./beforeInfoParser";

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
