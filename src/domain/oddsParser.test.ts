import assert from "node:assert/strict";
import test from "node:test";
import { parseTrifectaOdds } from "./oddsParser";

test("td隣接形式から3連単オッズを抽出する", () => {
  const html = `
    <table>
      <tr><td>1-3-4</td><td>16.2</td></tr>
      <tr><td>1-2-3</td><td>5.4</td></tr>
    </table>
  `;
  assert.equal(parseTrifectaOdds(html, [1, 3, 4]), 16.2);
  assert.equal(parseTrifectaOdds(html, [1, 2, 3]), 5.4);
});

test("「倍」付きでも抽出できる", () => {
  const html = `<table><tr><td>2-1-3</td><td>42.5倍</td></tr></table>`;
  assert.equal(parseTrifectaOdds(html, [2, 1, 3]), 42.5);
});

test("該当する組合せがない場合はnull", () => {
  const html = `<table><tr><td>1-2-3</td><td>5.4</td></tr></table>`;
  assert.equal(parseTrifectaOdds(html, [4, 5, 6]), null);
});

test("テキスト連続形式（フォールバック）から抽出する", () => {
  const html = `<div>1-3-4 16.2  1-3-5 12.7</div>`;
  assert.equal(parseTrifectaOdds(html, [1, 3, 4]), 16.2);
  assert.equal(parseTrifectaOdds(html, [1, 3, 5]), 12.7);
});

test("公式風テーブル構造（1着セクション・2着列・3着行）から抽出する", () => {
  const html = `
    <h3>1コース1着</h3>
    <table>
      <thead>
        <tr><th>2着</th></tr>
        <tr><th>2</th><th>3</th><th>4</th></tr>
      </thead>
      <tbody>
        <tr><th>2</th><td>-</td><td>9.1</td><td>11.4</td></tr>
        <tr><th>3</th><td>5.0</td><td>-</td><td>16.2</td></tr>
        <tr><th>4</th><td>7.7</td><td>8.8</td><td>-</td></tr>
      </tbody>
    </table>
  `;
  assert.equal(parseTrifectaOdds(html, [1, 4, 3]), 16.2);
  assert.equal(parseTrifectaOdds(html, [1, 2, 4]), 7.7);
  assert.equal(parseTrifectaOdds(html, [1, 3, 2]), 9.1);
});

test("公式HTML風の分割列から3連単オッズを抽出する", () => {
  const html = `
    <table class="is-payout3">
      <tbody>
        <tr><td>1</td><td>3</td><td>4</td><td>16.2</td><td>人気</td></tr>
        <tr><td>1</td><td>4</td><td>3</td><td>21.5倍</td><td>人気</td></tr>
      </tbody>
    </table>
  `;
  assert.equal(parseTrifectaOdds(html, [1, 3, 4]), 16.2);
  assert.equal(parseTrifectaOdds(html, [1, 4, 3]), 21.5);
});

test("矢印や全角ハイフンの買い目表記も抽出する", () => {
  const html = `<div>1→3→4 16.2  2－1－3 42.5倍</div>`;
  assert.equal(parseTrifectaOdds(html, [1, 3, 4]), 16.2);
  assert.equal(parseTrifectaOdds(html, [2, 1, 3]), 42.5);
});

test("selectionが3要素でない場合はnull", () => {
  const html = `<table><tr><td>1-2</td><td>3.0</td></tr></table>`;
  assert.equal(parseTrifectaOdds(html, [1, 2]), null);
});
