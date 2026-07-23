import assert from "node:assert/strict";
import test from "node:test";
import { parseAllExactaOdds, parseExactaOdds } from "./exactaOddsParser";

const officialLikeHtml = `
  <div class="title7"><h3><span class="title7_mainLabel">2連単オッズ</span></h3></div>
  <div class="table1"><table>
    <thead><tr>
      <th class="is-boatColor1">1</th><th class="is-boatColor1 is-borderLeftNone">選手1</th>
      <th class="is-boatColor2">2</th><th class="is-boatColor2 is-borderLeftNone">選手2</th>
    </tr></thead>
    <tbody>
      <tr><td class="is-boatColor2">2</td><td class="oddsPoint">10.2</td><td class="is-boatColor1">1</td><td class="oddsPoint">11.5</td></tr>
      <tr><td class="is-boatColor3">3</td><td class="oddsPoint">15.2</td><td class="is-boatColor3">3</td><td class="oddsPoint">6.8</td></tr>
      <tr><td class="is-boatColor4">4</td><td class="oddsPoint is-miss">欠場</td><td class="is-boatColor4">4</td><td class="oddsPoint">8.4</td></tr>
    </tbody>
  </table></div>
  <div class="title7"><h3><span class="title7_mainLabel">2連複オッズ</span></h3></div>
  <div class="table1"><table>
    <thead><tr><th class="is-boatColor1">1</th><th class="is-boatColor1">選手1</th></tr></thead>
    <tbody><tr><td class="is-boatColor2">2</td><td class="oddsPoint">999.9</td></tr></tbody>
  </table></div>
`;

test("公式の横並び表から2連単だけを抽出する", () => {
  const odds = parseAllExactaOdds(officialLikeHtml);
  assert.deepEqual([...odds], [
    ["1-2", 10.2],
    ["2-1", 11.5],
    ["1-3", 15.2],
    ["2-3", 6.8],
    ["2-4", 8.4],
  ]);
  assert.equal(parseExactaOdds(officialLikeHtml, [1, 2]), 10.2);
  assert.equal(parseExactaOdds(officialLikeHtml, [1, 4]), null);
});

test("2連複テーブルを2連単として混入させない", () => {
  assert.notEqual(parseExactaOdds(officialLikeHtml, [1, 2]), 999.9);
});

test("不正な買い目はnull", () => {
  assert.equal(parseExactaOdds(officialLikeHtml, [1]), null);
  assert.equal(parseExactaOdds(officialLikeHtml, [1, 1]), null);
  assert.equal(parseExactaOdds(officialLikeHtml, [1, 7]), null);
});
