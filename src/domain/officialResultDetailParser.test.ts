import assert from "node:assert/strict";
import test from "node:test";
import { parseOfficialResultDetail } from "./officialResultDetailParser";

const defaults = { date: "2009-11-11", fetchedAt: "2026-11-17T00:00:00.000Z" };

const header = (venue: string) => `${venue}［成績］     11/11      一般競走　　　　　　  第 2日\n`;
const columns = "  着 艇 登番 　選　手　名　　ﾓｰﾀｰ ﾎﾞｰﾄ 展示 進入 ｽﾀｰﾄﾀｲﾐﾝｸ ﾚｰｽﾀｲﾑ まくり　　\n";
const entries = (first: number, second: number) =>
  `  01  ${first} 3621 天　野　晶　夫　 27   59  6.87   5    0.13     1.54.1\n` +
  `  02  ${second} 3863 海老澤　泰　行　 18   66  7.01   2    0.21     1.55.8\n`;

test("K ファイル: 全 7 券種を読む（単勝・複勝 2 行・拡連複 3 行）", () => {
  const text = header("下　関") +
    "   2R       予　　選　　                 H1800m  曇り  風  北　　 3m  波　  2cm\n" + columns + entries(4, 1) + "\n" +
    "        単勝     4          150  \n" +
    "        複勝     4          100  1          120  \n" +
    "        ２連単   4-1        810  人気     3 \n" +
    "        ２連複   1-4        230  人気     1 \n" +
    "        拡連複   1-4        200  人気     3 \n" +
    "                 3-4        310  人気     6 \n" +
    "                 1-3        570  人気     4 \n" +
    "        ３連単   4-1-3     3970  人気    13 \n" +
    "        ３連複   1-3-4      840  人気     5 \n";
  const parsed = parseOfficialResultDetail(text, defaults);
  const byType = (t: string) => parsed.payouts.filter((p) => p.betType === t).map((p) => `${p.combination}=${p.payoutYen}`);
  assert.deepEqual(byType("win"), ["4=150"]);
  assert.deepEqual(byType("place"), ["4=100", "1=120"]);
  assert.deepEqual(byType("wide"), ["1-4=200", "3-4=310", "1-3=570"]);
  assert.deepEqual(byType("trifecta"), ["4-1-3=3970"]);
  assert.deepEqual(byType("trio"), ["1-3-4=840"]);
  assert.equal(parsed.conditions[0].raceId, "20091111-下関-02");
});

test("K ファイル: 風速が 2 桁で風向との間に空白が無いレースも、見出しとして読む（2009-11-11 下関 3R）", () => {
  const text = header("下　関") +
    "   2R       予　　選　　                 H1800m  曇り  風  北　　 3m  波　  2cm\n" + columns + entries(4, 1) + "\n" +
    "        ３連単   4-1-3     3970  人気    13 \n\n\n" +
    "   3R       予　　選　　                 H1800m  曇り  風  北北東10m  波　 10cm\n" + columns + entries(5, 2) + "\n" +
    "        ３連単   5-2-4     4670  人気    14 \n";
  const parsed = parseOfficialResultDetail(text, defaults);
  assert.deepEqual(parsed.conditions.map((c) => [c.raceNo, c.windDir, c.windMps, c.waveCm]), [[2, "北", 3, 2], [3, "北北東", 10, 10]]);
  // 読み落とすと 3R の払戻と成績が 2R の race_id に付く
  assert.deepEqual(parsed.payouts.map((p) => `${p.raceId}:${p.combination}`), ["20091111-下関-02:4-1-3", "20091111-下関-03:5-2-4"]);
  assert.deepEqual(parsed.entries.map((e) => `${e.raceNo}:${e.boat}`), ["2:4", "2:1", "3:5", "3:2"]);
});

test("K ファイル: 拡連複の途中に空行があっても、その後ろの行を読む（2004-08-21 三国 2R）", () => {
  const text = header("三　国") +
    "   2R       一　般　　　                 H1800m  晴　  風  北　　 3m  波　  2cm\n" + columns + entries(4, 1) + "\n" +
    "        拡連複   1-4        200  人気     3 \n" +
    "\n" +
    "                 1-3        570  人気     4 \n" +
    "        ３連単   4-1-3     3970  人気    13 \n" +
    "        ３連複   1-3-4      840  人気     5 \n\n\n" +
    "   3R       一　般　　　                 H1800m  晴　  風  北　　 3m  波　  2cm\n" + columns + entries(5, 2) + "\n" +
    "        拡連複   2-5        100  人気     1 \n" +
    "                 4-5        290  人気     4 \n" +
    "\n" +
    "        ３連単   5-2-4     4670  人気    14 \n";
  const parsed = parseOfficialResultDetail(text, defaults);
  const wide = parsed.payouts.filter((p) => p.betType === "wide").map((p) => `${p.raceNo}:${p.combination}=${p.payoutYen}`);
  assert.deepEqual(wide, ["2:1-4=200", "2:1-3=570", "3:2-5=100", "3:4-5=290"]);
});

test("K ファイル: 特払いはその券種だけの払戻で、レース全体の返還にしない（2004-06-29 びわこ 2R）", () => {
  const text = header("琵琶湖") +
    "   2R       一般戦　　　                 H1800m  晴　  風  南西　 1m  波　  1cm\n" + columns + entries(3, 2) + "\n" +
    "        単勝        特払い   70          \n" +
    "        複勝     3          150  2          150  \n" +
    "        ３連単   3-2-4     5200  人気    18 \n";
  const parsed = parseOfficialResultDetail(text, defaults);
  assert.equal(parsed.conditions[0].venue, "びわこ");
  assert.equal(parsed.conditions[0].returned, false);
  assert.deepEqual(parsed.payouts.map((p) => `${p.betType}:${p.combination}=${p.payoutYen}:${p.returned}`), [
    "win:特払=70:false", "place:3=150:false", "place:2=150:false", "trifecta:3-2-4=5200:false",
  ]);
});
