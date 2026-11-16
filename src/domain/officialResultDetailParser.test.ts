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

test("K ファイル: 同着のレースは、2 つ目の払戻も読む（2025-01-04 津 2R。3 着が同着）", () => {
  const text = header("津　　") +
    "   2R       一　般　　　                 H1800m  晴　  風  北　　 3m  波　  2cm\n" + columns + entries(1, 2) + "\n" +
    "        単勝     1          130  \n" +
    "        複勝     1          100  2          100  \n" +
    "        ２連単   1-2        200  人気     1 \n" +
    "        ２連複   1-2        150  人気     1 \n" +
    "        拡連複   1-2        100  人気     2 \n" +
    "                 1-3        100  人気     1 \n" +
    "                 1-4        110  人気     4 \n" +
    "                 2-3        100  人気     3 \n" +
    "                 2-4        110  人気     5 \n" +
    "        ３連単   1-2-3      280  人気     1 \n" +
    "                 1-2-4      390  人気     2 \n" +
    "        ３連複   1-2-3      130  人気     1 \n" +
    "                 1-2-4      150  人気     2 \n\n\n" +
    "   3R       一　般　　　                 H1800m  晴　  風  北　　 3m  波　  2cm\n" + columns + entries(5, 2) + "\n" +
    "        ２連単   5-2        890  人気     2 \n" +
    "                 2-5        640  人気     1 \n" +
    "        ２連複   2-5        480  人気     1 \n";
  const parsed = parseOfficialResultDetail(text, defaults);
  const of = (raceNo: number, t: string) => parsed.payouts.filter((p) => p.raceNo === raceNo && p.betType === t).map((p) => `${p.combination}=${p.payoutYen}`);
  assert.deepEqual(of(2, "exacta"), ["1-2=200"]);
  assert.deepEqual(of(2, "wide"), ["1-2=100", "1-3=100", "1-4=110", "2-3=100", "2-4=110"]);
  assert.deepEqual(of(2, "trifecta"), ["1-2-3=280", "1-2-4=390"]);
  assert.deepEqual(of(2, "trio"), ["1-2-3=130", "1-2-4=150"]);
  // 1 着が同着: ２連単が 2 つ
  assert.deepEqual(of(3, "exacta"), ["5-2=890", "2-5=640"]);
  assert.deepEqual(of(3, "quinella"), ["2-5=480"]);
});

test("K ファイル: 拡連複の 1 行目が空でも、続きの行は拡連複として読む（2004-06-03 下関 3R）", () => {
  const text = header("下　関") +
    "   3R       予　　選　　                 H1800m  晴　  風  南西　 3m  波　  3cm\n" + columns + entries(4, 3) + "\n" +
    "        単勝     \n" +
    "        複勝     \n" +
    "        ２連単   4-3       2170  人気    10 \n" +
    "        ２連複   3-4       6400  人気    12 \n" +
    "        拡連複   \n" +
    "                 1-4        250  人気     2 \n" +
    "                 1-3        600  人気     6 \n" +
    "        ３連単   4-3-1    12970  人気    46 \n" +
    "        ３連複   1-3-4     2070  人気     9 \n";
  const parsed = parseOfficialResultDetail(text, defaults);
  assert.deepEqual(parsed.payouts.map((p) => `${p.betType}:${p.combination}=${p.payoutYen}`), [
    "exacta:4-3=2170", "quinella:3-4=6400", "wide:1-4=250", "wide:1-3=600", "trifecta:4-3-1=12970", "trio:1-3-4=2070",
  ]);
});
