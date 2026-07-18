import assert from "node:assert/strict";
import test from "node:test";
import { parseKyotei24RacerMetadata } from "./kyotei24RacerMetadata";

test("レース前HTMLから年齢・支部・身体情報を艇順に読む", () => {
  const html = `<table>
    <tr><td class="labelTitle">号艇</td><td>1</td><td>2</td></tr>
    <tr><td class="labelTitle">選手名</td><td></td><td></td></tr>
    <tr><td class="name-td"><a href="https://x/racer-4320.html">峰</a><span class="age"> (39)</span></td><td class="name-td"><a href="https://x/racer-3918.html">深井</a><span class="age"> (50)</span></td></tr>
    <tr><td class="labelTitle">支部</td><td class="ken">佐賀</td><td class="ken">滋賀</td></tr>
    <tr><td class="labelTitle">選手<br/>情報</td><td><div>男&nbsp;&nbsp;B</div><div>173 cm</div><div>51 kg</div></td><td><div>男&nbsp;&nbsp;O</div><div>162 cm</div><div>52 kg</div></td></tr>
  </table>`;
  assert.deepEqual(parseKyotei24RacerMetadata(html), [
    { registrationNo: "4320", age: 39, branch: "佐賀", gender: "男", bloodType: "B", heightCm: 173, weightKg: 51 },
    { registrationNo: "3918", age: 50, branch: "滋賀", gender: "男", bloodType: "O", heightCm: 162, weightKg: 52 },
  ]);
});
