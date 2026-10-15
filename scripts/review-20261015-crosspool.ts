/**
 * 券種間のずれの下調べ（段階0、2026-10-15 夜。読み取りだけ・stdout のみ）。結論は docs/knowledge-base.md の K11。
 *
 * 同じ出来事に対する2つの買い方の、公式の確定払戻（100円あたり）の比を測る。値付けがそろっていれば約1。
 * 控除率 25% を越えるには約 1.33 以上が要る（0.75 × 1.33 ≒ 1）。払戻は確定時のオッズで決まる（パリミュチュエル）ので、
 * 実際に受け取れる値段どうしの比べになる。
 * - 「3連単4点 ÷ 2連単」: 2連単 a-b が当たったレースで、3連単 a-b-○ の4点（6艇立て）と2連単 a-b の1点。帯は2連単の払戻。
 * - 「2連複 ÷ 2連単2点」: 2連複 a=b と、2連単 a-b・b-a の2点。帯は2連複の払戻（着順に左右されない）。
 *   2連単の払戻で帯を分けると、本命の着順で決まったレースほど 1 を超える（帯が結果で選ばれるため。値付けのずれではない）。
 *
 * 実行（夜に。本番の作業コピーで）:
 *   BOAT_PON_DB_URI='file:data/boat.sqlite?mode=ro&immutable=1' npx tsx scripts/review-20261015-crosspool.ts
 */
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(process.env.BOAT_PON_DB_URI ?? "file:data/boat.sqlite?mode=ro", { readOnly: true });
const FROM = "2010-01-01"; // 2004〜2005年は3連単を売っていなかった場を含む（CLAUDE.md のデータの注意）

const boats = new Map<string, number>();
for (const r of db.prepare(`SELECT race_id, COUNT(*) AS n FROM race_entries WHERE date >= ? GROUP BY race_id`).iterate(FROM) as Iterable<{ race_id: string; n: number }>) {
  boats.set(r.race_id, r.n);
}

type Pay = { c: string; p: number };
type Bucket = { n: number; a: number; b: number };
const bandOf = (bands: number[], odds: number) => bands.findIndex((x, i) => odds >= x && odds < bands[i + 1]);
const newBuckets = (bands: number[]) => bands.slice(0, -1).map((): Bucket => ({ n: 0, a: 0, b: 0 }));
const add = (bucket: Bucket, a: number, b: number) => { bucket.n += 1; bucket.a += a; bucket.b += b; };

const exBands = [1, 3, 5, 10, 20, 50, 100, 1e9];
const qBands = [1, 2, 3, 5, 10, 20, 50, 1e9];
const triVsEx = newBuckets(exBands), qVsEx = newBuckets(qBands);
const triByYear = new Map<string, Bucket>(), qByYear = new Map<string, Bucket>();
const yearBucket = (map: Map<string, Bucket>, y: string) => map.get(y) ?? (map.set(y, { n: 0, a: 0, b: 0 }), map.get(y)!);

let cur: string | null = null;
let rec: { ex: Pay[]; tr: Pay[]; q: Pay[] } | null = null;
const flush = () => {
  if (!rec || !cur || boats.get(cur) !== 6 || rec.ex.length !== 1) return;
  const ex = rec.ex[0];
  const year = cur.slice(0, 4);
  // 3連単4点 ÷ 2連単（同着などで払戻が複数あるレースは除く）
  if (rec.tr.length === 1 && rec.tr[0].c.startsWith(`${ex.c}-`)) {
    const i = bandOf(exBands, ex.p / 100);
    if (i >= 0) { add(triVsEx[i], rec.tr[0].p / 4, ex.p); add(yearBucket(triByYear, year), rec.tr[0].p / 4, ex.p); }
  }
  // 2連複 ÷ 2連単2点
  if (rec.q.length === 1) {
    const [a, b] = ex.c.split("-");
    const pair = rec.q[0].c.split(/[-=]/);
    if (pair.includes(a) && pair.includes(b)) {
      const i = bandOf(qBands, rec.q[0].p / 100);
      if (i >= 0) { add(qVsEx[i], rec.q[0].p, ex.p / 2); add(yearBucket(qByYear, year), rec.q[0].p, ex.p / 2); }
    }
  }
};
const rows = db.prepare(`SELECT race_id, bet_type, combination, payout_yen FROM race_payouts
  WHERE date >= ? AND returned = 0 AND payout_yen IS NOT NULL AND bet_type IN ('exacta', 'trifecta', 'quinella') ORDER BY race_id`)
  .iterate(FROM) as Iterable<{ race_id: string; bet_type: string; combination: string; payout_yen: number }>;
for (const r of rows) {
  if (r.race_id !== cur) { flush(); cur = r.race_id; rec = { ex: [], tr: [], q: [] }; }
  const pay = { c: r.combination, p: r.payout_yen };
  if (r.bet_type === "exacta") rec!.ex.push(pay); else if (r.bet_type === "trifecta") rec!.tr.push(pay); else rec!.q.push(pay);
}
flush();
db.close();

const ratio = (b: Bucket) => (b.b ? (b.a / b.b).toFixed(3) : "-");
const total = (list: Bucket[]) => list.reduce((s, b) => ({ n: s.n + b.n, a: s.a + b.a, b: s.b + b.b }), { n: 0, a: 0, b: 0 });
const print = (title: string, bands: number[], list: Bucket[], byYear: Map<string, Bucket>) => {
  console.log(`\n${title}`);
  list.forEach((b, i) => { if (b.n) console.log(`  ${bands[i]}〜${bands[i + 1] >= 1e9 ? "" : bands[i + 1]}倍 | ${b.n} レース | ${ratio(b)}`); });
  const t = total(list);
  console.log(`  全体 | ${t.n} レース | ${ratio(t)}`);
  console.log(`  年別 ${[...byYear].sort(([x], [y]) => x.localeCompare(y)).map(([y, b]) => `${y}:${ratio(b)}`).join(" ")}`);
};
print("3連単4点 ÷ 2連単（帯は2連単の払戻）", exBands, triVsEx, triByYear);
print("2連複 ÷ 2連単2点（帯は2連複の払戻）", qBands, qVsEx, qByYear);
console.log("\n約1なら値付けはそろっている。控除率 25% を越えるには約 1.33 以上が要る。");
