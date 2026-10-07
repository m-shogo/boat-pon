import assert from "node:assert/strict";
import test from "node:test";
import { parseRaceResultTrifecta } from "./officialRaceResultPage";

// 公式ページの HTML はそのまま置かず、同じ構造の最小限の断片で確かめる。
const combo = (a: number, b: number, c: number) =>
  `<div class="numberSet1_row"><span class="numberSet1_number is-type${a}">${a}</span><span class="numberSet1_text">-</span><span class="numberSet1_number is-type${b}">${b}</span><span class="numberSet1_text">-</span><span class="numberSet1_number is-type${c}">${c}</span></div>`;
const page = (rows: string) => `<table><tbody><tr><td rowspan="2">2連単</td><td>${combo(1, 5, 0).replace(/<span[^>]*is-type0[^>]*>0<\/span>/, "")}</td><td><span class="is-payout1">&yen;900</span></td></tr></tbody>
<tbody>${rows}</tbody><tbody><tr><td rowspan="2">3連複</td><td>${combo(1, 4, 5)}</td><td><span class="is-payout1">&yen;1,230</span></td></tr></tbody></table>`;

test("3連単の確定組番と払戻を取り出す（他の券種の値は拾わない）", () => {
  const html = page(`<tr class="is-p3-0"><td rowspan="2">3連単</td><td>${combo(1, 5, 4)}</td><td><span class="is-payout1">&yen;5,750</span></td><td>22</td></tr>
<tr class="is-p3-0"><td>&nbsp; </td><td><span class="is-payout1">&nbsp;</span></td><td>&nbsp;</td></tr>`);
  assert.deepEqual(parseRaceResultTrifecta(html), { combinations: ["1-5-4"], payoutYen: 5750 });
});

test("同着で2組あるときは両方返す", () => {
  const html = page(`<tr><td rowspan="2">3連単</td><td>${combo(1, 2, 3)}</td><td><span class="is-payout1">&yen;1,000</span></td></tr>
<tr><td>${combo(1, 3, 2)}</td><td><span class="is-payout1">&yen;1,500</span></td></tr>`);
  assert.deepEqual(parseRaceResultTrifecta(html)?.combinations, ["1-2-3", "1-3-2"]);
});

test("結果がまだ無いページでは null", () => {
  assert.equal(parseRaceResultTrifecta(page(`<tr><td rowspan="2">3連単</td><td>&nbsp;</td><td><span class="is-payout1">&nbsp;</span></td></tr>`)), null);
  assert.equal(parseRaceResultTrifecta("<html><body>データはありません</body></html>"), null);
});
