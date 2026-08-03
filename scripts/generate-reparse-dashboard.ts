// N2 settlement reparse の可視化成果物生成（read-only, 実 DB scan 無し）。
// Before/After report・実レース例・年別/券種別グラフ・進捗 dashboard を self-contained HTML + Markdown で出力する。
// 例の Before は full report の correctionSamples（status-level）、After は archive の v2 再parse から作る。
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseOfficialResultDetail } from "../src/domain/officialResultDetailParser";
import { deriveSettlementCandidates, candidateKey } from "../src/research-replay/n2SettlementReparse";
import type { SettlementBetType } from "../src/research-replay/settlement";

const root = resolve(process.cwd());
const arg = (n: string): string | null => {
  const d = process.argv.find((v) => v.startsWith(`${n}=`)); if (d) return d.slice(n.length + 1);
  const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] ?? null : null;
};
const archiveRoot = resolve(arg("--archive-root") ?? join(root, "data", "raw", "official", "results"));
const reportDir = resolve(arg("--report-dir") ?? join(root, "reports", "n2"));
const VENUE: Record<string, string> = {
  "01": "桐生", "02": "戸田", "03": "江戸川", "04": "平和島", "05": "多摩川", "06": "浜名湖", "07": "蒲郡", "08": "常滑",
  "09": "津", "10": "三国", "11": "びわこ", "12": "住之江", "13": "尼崎", "14": "鳴門", "15": "丸亀", "16": "児島",
  "17": "宮島", "18": "徳山", "19": "下関", "20": "若松", "21": "芦屋", "22": "福岡", "23": "唐津", "24": "大村",
};
function unpack(path: string): Promise<Buffer> {
  return new Promise((res, rej) => {
    const ch = spawn("unar", ["-q", "-o", "-", path], { stdio: ["ignore", "pipe", "pipe"] });
    const o: Buffer[] = []; const e: Buffer[] = [];
    ch.stdout.on("data", (c: Buffer) => o.push(c)); ch.stderr.on("data", (c: Buffer) => e.push(c));
    ch.on("error", rej); ch.on("close", (code) => code === 0 ? res(Buffer.concat(o)) : rej(new Error(Buffer.concat(e).toString() || `unar ${code}`)));
  });
}
const archiveFor = (date: string): string => `k${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}.lzh`;

type V2Cand = ReturnType<typeof deriveSettlementCandidates>[number];
type Example = {
  category: string; raceKey: string; venue: string; date: string; raceNo: string; betType: string;
  before: string; after: string; rationale: string; modelLabelImpact: string; rawArchive: string;
};

async function main(): Promise<void> {
  const full = JSON.parse(readFileSync(join(reportDir, "settlement-reparse-full.json"), "utf8"));
  const audit = existsSync(join(reportDir, "unexpected-additions-audit.json"))
    ? JSON.parse(readFileSync(join(reportDir, "unexpected-additions-audit.json"), "utf8")) : { findings: [] };
  const manifest = existsSync(join(reportDir, "settlement-reparse-approval-manifest.json"))
    ? JSON.parse(readFileSync(join(reportDir, "settlement-reparse-approval-manifest.json"), "utf8")) : null;
  const applyReport = existsSync(join(reportDir, "settlement-reparse-apply.json"))
    ? JSON.parse(readFileSync(join(reportDir, "settlement-reparse-apply.json"), "utf8")) : null;
  const rollback = existsSync(join(reportDir, "settlement-reparse-rollback-rehearsal.json"))
    ? JSON.parse(readFileSync(join(reportDir, "settlement-reparse-rollback-rehearsal.json"), "utf8")) : null;
  const approval = {
    approvalTargetDigest: manifest?.approvalTargetDigest ?? "n/a",
    settlementSnapshotIdentity: manifest?.binding?.snapshotIdentity?.settlementSnapshotIdentity ?? "n/a",
    sourceWholeFileSha: full.identity.sourceSha256,
    approvalPresent: (applyReport && !String(applyReport?.gate?.approval?.code ?? "").includes("SCOPE_MISMATCH") && applyReport?.gate?.approval?.approved) ? "YES" : "NO",
    applyExecuted: applyReport?.realSidecarApply === "EXECUTED" ? "YES" : "NO",
    applyStatus: applyReport?.status ?? "n/a",
    rollbackReadiness: rollback?.result === "REHEARSED" ? "REHEARSED (v1 restore + backup/restore)" : "n/a",
    nextHumanAction: "operator が rollout_approval_grants_v2 へ N2_SETTLEMENT_REPARSE_APPLY 承認を append（docs/n2-settlement-reparse-approval-operator-runbook.md）",
  };

  const parseCache = new Map<string, Map<string, V2Cand> | null>();
  async function dayMap(date: string): Promise<Map<string, V2Cand> | null> {
    if (!parseCache.has(date)) {
      const path = join(archiveRoot, archiveFor(date));
      if (!existsSync(path)) { parseCache.set(date, null); }
      else {
        const parsed = parseOfficialResultDetail(new TextDecoder("shift_jis").decode(await unpack(path)), { date, fetchedAt: "1970-01-01T00:00:00.000Z" });
        const m = new Map<string, V2Cand>();
        for (const c of deriveSettlementCandidates(parsed)) m.set(candidateKey(c.raceKey, c.betType), c);
        parseCache.set(date, m);
      }
    }
    return parseCache.get(date) ?? null;
  }
  function v2Desc(c: V2Cand): string {
    return c.status === "settled"
      ? `settled/${c.resultKind} payout=[${c.payouts.map((p) => `${p.selection}:${p.payoutYen}${p.lineKind === "special_payout" ? "(特)" : ""}`).join(", ")}]`
      : `${c.status} refund=[${c.refunds.map((r) => `${r.scope}:${r.refundYenPer100}`).join(", ")}]`;
  }
  const beforeDesc = (originalStatus: string | null, originalResultKind: string | null): string =>
    originalStatus == null ? "(v1 candidate なし)"
      : originalStatus === "settled" ? `settled/${originalResultKind}`
        : `${originalStatus}（v1 返還: refundYenPer100=100)`;

  const examples: Example[] = [];
  async function add(category: string, raceKey: string, betType: string, originalStatus: string | null, originalResultKind: string | null, rationale: string, modelLabelImpact: string): Promise<void> {
    const [date, code, raceNo] = raceKey.split(":");
    const dm = await dayMap(date);
    const v2 = dm?.get(candidateKey(raceKey, betType as SettlementBetType)) ?? null;
    examples.push({
      category, raceKey, venue: VENUE[code] ?? code, date, raceNo, betType,
      before: beforeDesc(originalStatus, originalResultKind), after: v2 ? v2Desc(v2) : "(v2 candidate なし)",
      rationale, modelLabelImpact, rawArchive: archiveFor(date),
    });
  }

  const samples = full.correctionSamples as Array<{ raceKey: string; betType: string; action: string; originalStatus: string | null; originalResultKind: string | null }>;
  for (const s of diverse(samples.filter((x) => x.action === "false_refund_correction"), 6)) {
    await add("false_refund_correction", s.raceKey, s.betType, s.originalStatus, s.originalResultKind, "v1 が特払いを race-wide 返還化した偽返還。v2 は正常払戻へ復帰し settled。", "返還除外から復帰し hit/loss label が eligible 化");
  }
  for (const s of diverse(samples.filter((x) => x.action === "special_payout_addition"), 3)) {
    await add("special_payout_addition", s.raceKey, s.betType, s.originalStatus, s.originalResultKind, "v1 が抑止した特払いを v2 が券種別 special_payout candidate として顕在化。", "special_payout outcome（hit=null, 特払額を financial target に保持）");
  }
  let genuine = 0;
  for (const date of ["2024-01-03", "2024-05-04", "2023-11-11", "2025-02-02"]) {
    if (genuine >= 2) break;
    const dm = await dayMap(date);
    if (!dm) continue;
    for (const [, cand] of dm) {
      if (cand.status === "refunded") { await add("genuine_refund_maintained", cand.raceKey, cand.betType, "refunded", "normal", "v1/v2 とも返還。真の返還として維持（訂正しない）。", "eligible=false（返還）を維持"); genuine += 1; break; }
    }
  }
  for (const f of (audit.findings as Array<{ raceKey: string; betType: string; classification: string }>)) {
    await add(`held_out:${f.classification}`, f.raceKey, f.betType, null, null, "本 special-payout reparse の scope 外（v1 win 返還欠落）。auto-apply せず手動レビュー。", "本 reparse では変更なし（別承認の別訂正で扱う）");
  }

  const c = full.counts;
  const eligBefore = full.before.settled / full.logicalActive.before;
  const eligAfter = full.afterMeasured.settled / full.logicalActive.after;
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, "settlement-reparse-before-after.md"), beforeAfterMd(full, examples, eligBefore, eligAfter));
  writeFileSync(join(reportDir, "settlement-reparse-examples.json"), JSON.stringify({ generatedAt: new Date().toISOString(), sourceDigest: full.outputDigest, examples }, null, 2) + "\n");
  writeFileSync(join(reportDir, "settlement-reparse-dashboard.html"), dashboardHtml(full, examples, eligBefore, eligAfter, approval));
  console.log(JSON.stringify({ examples: examples.length, byCategory: countBy(examples.map((e) => e.category.split(":")[0])), wrote: ["settlement-reparse-before-after.md", "settlement-reparse-examples.json", "settlement-reparse-dashboard.html"] }, null, 2));
}

function diverse<T extends { raceKey: string; betType: string }>(items: T[], n: number): T[] {
  const out: T[] = []; const seenYear = new Set<string>(); const seenBet = new Set<string>();
  for (const it of items) { const y = it.raceKey.slice(0, 4); if (out.length < n && (!seenYear.has(y) || !seenBet.has(it.betType))) { out.push(it); seenYear.add(y); seenBet.add(it.betType); } }
  for (const it of items) { if (out.length >= n) break; if (!out.includes(it)) out.push(it); }
  return out.slice(0, n);
}
function countBy(xs: string[]): Record<string, number> { const m: Record<string, number> = {}; for (const x of xs) m[x] = (m[x] ?? 0) + 1; return m; }

function beforeAfterMd(full: any, examples: Example[], eligBefore: number, eligAfter: number): string {
  const c = full.counts;
  const rows = [
    ["active refunded", full.before.refunded, full.afterMeasured.refunded],
    ["active settled", full.before.settled, full.afterMeasured.settled],
    ["active partially_refunded", full.before.partially_refunded ?? 0, full.afterMeasured.partially_refunded ?? 0],
    ["logical active total", full.logicalActive.before, full.logicalActive.after],
    ["physical rows", full.physicalRows.before, full.physicalRows.after],
  ];
  return `# Settlement reparse Before / After（temp-copy 実測・実適用は未承認）

> 出典: \`reports/n2/settlement-reparse-full.json\`（digest ${full.outputDigest}）。source SHA-256 ${full.identity.sourceSha256.slice(0, 16)}… 不変・write 0。production apply は BLOCKED。

| 指標 | Before | After | 差分 |
|---|---:|---:|---:|
${rows.map((r) => `| ${r[0]} | ${Number(r[1]).toLocaleString()} | ${Number(r[2]).toLocaleString()} | ${(Number(r[2]) - Number(r[1])) >= 0 ? "+" : ""}${(Number(r[2]) - Number(r[1])).toLocaleString()} |`).join("\n")}
| false refund（active） | 319,301 | ${(319301 - c.false_refund_correction).toLocaleString()}（真の返還） | -${c.false_refund_correction.toLocaleString()} |
| special payout additions | 0 | ${c.special_payout_addition.toLocaleString()} | +${c.special_payout_addition.toLocaleString()} |
| eligible率（settled/active・概算） | 約${(eligBefore * 100).toFixed(2)}% | 約${(eligAfter * 100).toFixed(2)}% | +約${((eligAfter - eligBefore) * 100).toFixed(2)}pt |

- false_refund_correction **${c.false_refund_correction.toLocaleString()}** / special_payout_addition **${c.special_payout_addition.toLocaleString()}** / held-out(manual review) **${c.unexpected_addition}**（CONFIRMED_V1_WIN_REFUND_OMISSION）
- second-run appended ${full.secondRun.appended}（idempotent）/ integrity ${JSON.stringify(full.fullIntegrity)}

## 実レース例

| 種別 | race | 会場 | 券種 | Before | After | 根拠 ／ model label 影響 |
|---|---|---|---|---|---|---|
${examples.map((e) => `| ${e.category} | ${e.date} ${e.raceNo} | ${e.venue} | ${e.betType} | ${e.before} | ${e.after} | ${e.rationale} ／ ${e.modelLabelImpact} |`).join("\n")}

> Before は full report の correctionSamples（status-level）、After は archive の v2 再parse。実適用は未承認。
`;
}

function bars(data: Array<{ label: string; a: number; b: number }>, aLabel: string, bLabel: string): string {
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b]));
  const bw = 20, gap = 12, h = 170;
  const w = data.length * (bw * 2 + gap) + 50;
  const body = data.map((d, i) => {
    const x = 36 + i * (bw * 2 + gap);
    const ha = (d.a / max) * (h - 30), hb = (d.b / max) * (h - 30);
    return `<rect x="${x}" y="${h - ha}" width="${bw}" height="${ha}" fill="#c0392b"><title>${d.label} ${aLabel}:${d.a}</title></rect>`
      + `<rect x="${x + bw}" y="${h - hb}" width="${bw}" height="${hb}" fill="#2980b9"><title>${d.label} ${bLabel}:${d.b}</title></rect>`
      + `<text x="${x + bw}" y="${h + 12}" font-size="9" text-anchor="middle" transform="rotate(-40 ${x + bw} ${h + 12})">${d.label}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h + 42}" width="100%" style="max-width:${w}px">${body}</svg>`;
}
function dashboardHtml(full: any, examples: Example[], eligBefore: number, eligAfter: number, approval: Record<string, string>): string {
  const c = full.counts;
  const approvalRows = [
    ["approval target digest (v3)", approval.approvalTargetDigest],
    ["settlement snapshot identity", approval.settlementSnapshotIdentity],
    ["source whole-file SHA (advisory)", approval.sourceWholeFileSha],
    ["approval present", approval.approvalPresent],
    ["real-sidecar apply executed", approval.applyExecuted],
    ["apply gate status", approval.applyStatus],
    ["rollback readiness", approval.rollbackReadiness],
    ["next human action", approval.nextHumanAction],
  ];
  const byYear = full.byYear as Array<{ year: string; false_refund: number; special_addition: number }>;
  const byBet = full.byBetType as Array<{ betType: string; false_refund: number; special_addition: number }>;
  const stage = [
    ["Raw archive scan", "COMPLETE"], ["Refund defect identification", "COMPLETE"], ["Unexpected addition audit", "COMPLETE"],
    ["Temp-copy correction (full)", "COMPLETE"], ["Rollback rehearsal", "COMPLETE"], ["Approval manifest v2", "COMPLETE"],
    ["Production apply gate", "COMPLETE (BLOCKS w/o approval)"], ["Production approval", "NOT CREATED"],
    ["Real sidecar apply", "BLOCKED (no approval)"], ["N2 dataset freeze", "BLOCKED"], ["Baseline model", "NOT STARTED"], ["Shadow ROI comparison", "NOT STARTED"],
  ];
  const badge = (s: string) => `<span class="st ${s.startsWith("COMPLETE") ? "ok" : (s.includes("BLOCK") || s.includes("NOT")) ? "no" : "wip"}">${s}</span>`;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Settlement reparse dashboard</title>
<style>:root{color-scheme:light dark}body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:auto;max-width:1100px;padding:24px}
h1{font-size:20px}h2{font-size:16px;border-bottom:1px solid #8884;padding-bottom:4px;margin-top:26px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #8884;padding:5px 8px;text-align:left}th{background:#8881}
.tw{overflow-x:auto}td.n{text-align:right;font-variant-numeric:tabular-nums}.st{padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600}
.st.ok{background:#2ecc7133;color:#1e8449}.st.no{background:#e74c3c33;color:#c0392b}.st.wip{background:#f39c1233;color:#b9770e}
.kpi{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}.card{border:1px solid #8884;border-radius:10px;padding:12px 16px;min-width:150px}
.card b{display:block;font-size:20px}.card span{color:#888;font-size:12px}.warn{background:#f39c1222;border:1px solid #f39c12;border-radius:8px;padding:10px 14px}
.lg{font-weight:400;font-size:11px;color:#888}.lg i{display:inline-block;width:10px;height:10px;margin:0 3px 0 8px;vertical-align:middle}.lg i.a{background:#c0392b}.lg i.b{background:#2980b9}
code{font-size:12px}figure{margin:14px 0;overflow-x:auto}</style></head><body>
<h1>N2 settlement reparse — 成果 dashboard</h1>
<p class="warn"><b>実適用は未承認・未実行。</b>temp-copy 実測（source SHA-256 <code>${full.identity.sourceSha256.slice(0, 16)}…</code> 不変・write 0）。production apply は有効な承認まで BLOCKED（gate 実測: exit 3）。</p>
<div class="kpi">
<div class="card"><b>${c.false_refund_correction.toLocaleString()}</b><span>false refund 訂正</span></div>
<div class="card"><b>${c.special_payout_addition.toLocaleString()}</b><span>special payout 追加</span></div>
<div class="card"><b>${(319301 - c.false_refund_correction).toLocaleString()}</b><span>真の返還（残）</span></div>
<div class="card"><b>${c.unexpected_addition}</b><span>held-out（win返還欠落）</span></div>
<div class="card"><b>約${(eligBefore * 100).toFixed(2)}% → ${(eligAfter * 100).toFixed(2)}%</b><span>eligible率(settled/active,概算)</span></div>
</div>
<h2>Approval readiness</h2>
<div class="tw"><table><tr><th>項目</th><th>値</th></tr>
${approvalRows.map(([k, v]) => `<tr><td>${k}</td><td><code>${esc(String(v))}</code></td></tr>`).join("")}</table></div>
<h2>Before / After（active candidate）</h2>
<div class="tw"><table><tr><th>指標</th><th>Before</th><th>After</th><th>差分</th></tr>
<tr><td>refunded</td><td class="n">${full.before.refunded.toLocaleString()}</td><td class="n">${full.afterMeasured.refunded.toLocaleString()}</td><td class="n">-${c.false_refund_correction.toLocaleString()}</td></tr>
<tr><td>settled</td><td class="n">${full.before.settled.toLocaleString()}</td><td class="n">${full.afterMeasured.settled.toLocaleString()}</td><td class="n">+${(full.afterMeasured.settled - full.before.settled).toLocaleString()}</td></tr>
<tr><td>logical active</td><td class="n">${full.logicalActive.before.toLocaleString()}</td><td class="n">${full.logicalActive.after.toLocaleString()}</td><td class="n">+${(full.logicalActive.after - full.logicalActive.before).toLocaleString()}</td></tr>
<tr><td>physical rows</td><td class="n">${full.physicalRows.before.toLocaleString()}</td><td class="n">${full.physicalRows.after.toLocaleString()}</td><td class="n">+${(full.physicalRows.after - full.physicalRows.before).toLocaleString()}</td></tr></table></div>
<h2>年別 <span class="lg"><i class="a"></i>false refund<i class="b"></i>special add</span></h2><figure>${bars(byYear.map((y) => ({ label: y.year, a: y.false_refund, b: y.special_addition })), "false refund", "special add")}</figure>
<h2>券種別 <span class="lg"><i class="a"></i>false refund<i class="b"></i>special add</span></h2><figure>${bars(byBet.map((b) => ({ label: b.betType, a: b.false_refund, b: b.special_addition })), "false refund", "special add")}</figure>
<h2>実レース例</h2>
<div class="tw"><table><tr><th>種別</th><th>race</th><th>会場</th><th>券種</th><th>Before</th><th>After</th><th>根拠</th></tr>
${examples.map((e) => `<tr><td>${e.category}</td><td>${e.date} ${e.raceNo}</td><td>${e.venue}</td><td>${e.betType}</td><td><code>${esc(e.before)}</code></td><td><code>${esc(e.after)}</code></td><td>${e.rationale}</td></tr>`).join("")}</table></div>
<h2>進捗</h2><div class="tw"><table><tr><th>工程</th><th>状態</th></tr>${stage.map(([n, s]) => `<tr><td>${n}</td><td>${badge(s)}</td></tr>`).join("")}</table></div>
<p class="lg">generated ${new Date().toISOString()} · full digest ${full.outputDigest} · self-contained (no external CDN)</p>
</body></html>`;
}
function esc(s: string): string { return s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch] as string)); }
await main();
