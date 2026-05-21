import assert from "node:assert/strict";
import test from "node:test";
import { parseKyotei24Odds } from "./oddsParser";

test("td隣接形式から3連単オッズを抽出する", () => {
  const html = `
    <table>
      <tr><td>1-3-4</td><td>16.2</td></tr>
      <tr><td>1-2-3</td><td>5.4</td></tr>
    </table>
  `;
  assert.equal(parseKyotei24Odds(html, [1, 3, 4]), 16.2);
  assert.equal(parseKyotei24Odds(html, [1, 2, 3]), 5.4);
});

test("「倍」付きでも抽出できる", () => {
  const html = `<table><tr><td>2-1-3</td><td>42.5倍</td></tr></table>`;
  assert.equal(parseKyotei24Odds(html, [2, 1, 3]), 42.5);
});

test("該当する組合せがない場合はnull", () => {
  const html = `<table><tr><td>1-2-3</td><td>5.4</td></tr></table>`;
  assert.equal(parseKyotei24Odds(html, [4, 5, 6]), null);
});

test("テキスト連続形式（フォールバック）から抽出する", () => {
  const html = `<div>1-3-4 16.2  1-3-5 12.7</div>`;
  assert.equal(parseKyotei24Odds(html, [1, 3, 4]), 16.2);
  assert.equal(parseKyotei24Odds(html, [1, 3, 5]), 12.7);
});

test("selectionが3要素でない場合はnull", () => {
  const html = `<table><tr><td>1-2</td><td>3.0</td></tr></table>`;
  assert.equal(parseKyotei24Odds(html, [1, 2]), null);
});
