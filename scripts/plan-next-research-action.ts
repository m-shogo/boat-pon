/**
 * plan-next-research-action.ts
 *
 * 禁止: 既存DBへのINSERT/UPDATE/DELETE/DROP, app_settings変更, 本番decision変更
 * BUY は検証候補、ROI は検証指標。購入指示ではない。
 *
 * 目的: research-governor の JSON を読み込み、次にやるべき1本の具体的な
 *   実行手順・コマンド案・禁止事項・チェックリストを生成する。
 *   自動実行は一切しない。提案のみ。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const GOV_JSON = "reports/research-governor.json";
const OUT_MD   = "reports/next-research-action.md";
const OUT_JSON = "reports/next-research-action.json";

if (!existsSync(GOV_JSON)) {
  console.error(`research-governor.json not found. 先に pnpm report:research-governor を実行してください。`);
  process.exit(1);
}

type GovData = {
  generatedAt: string;
  phase: string;
  nextAction: { priority: number; action: string; command: string };
  dataReadiness: {
    forwardTotal: number;
    condB: { total: number; haoSaved: number; coverage: number };
    skip6R: { total: number; haoSaved: number; coverage: number };
    skipVenue: { total: number; haoSaved: number; coverage: number };
    timeseries: { buyForwardOverlap: number; condBOverlap: number; futureOnlySwitchReady: boolean; dateRange: string };
  };
  hypotheses: Array<{ id: string; name: string; status: string; adoptionAllowed: boolean; nextAction: string | null }>;
  condBSwitchVerdict: Record<string, unknown>;
  forbidden: string[];
  oneLiner: string;
};

const gov = JSON.parse(readFileSync(GOV_JSON, "utf-8")) as GovData;

// ─── 次アクションの詳細手順生成 ──────────────────────────────────────────────

type StepItem = { step: number; description: string; command?: string; isCheck?: boolean; isWarn?: boolean };

function buildActionPlan(gov: GovData): {
  title: string;
  rationale: string;
  steps: StepItem[];
  prereqs: string[];
  checks: string[];
  postChecks: string[];
  writeAllowed: boolean;
  writeTarget: string | null;
} {
  const p = gov.nextAction.priority;
  const dr = gov.dataReadiness;

  if (p === 1) {
    // future-only timeseries confirmation ready
    return {
      title: "condB future-only odds_timeseries 確認",
      rationale: `timeseries x condB overlap が n=${dr.timeseries.condBOverlap} に達した。future-only での switch 評価が可能。`,
      steps: [
        { step: 1, description: "timeseries health を確認", command: "pnpm check:alt-odds-health" },
        { step: 2, description: "condB switch historical 分析スクリプトを timeseries 版に更新 (別途実装)" },
        { step: 3, description: "future-only odds_timeseries を用いた condB switch 検証を実行" },
        { step: 4, description: "quality check", command: "pnpm check:historical-alt-odds-quality" },
        { step: 5, description: "research-governor を更新", command: "pnpm report:research-governor" },
      ],
      prereqs: ["timeseries health 確認", "分析スクリプト実装"],
      checks: ["condB timeseries overlap >= 30", "timeseries quality 100%"],
      postChecks: ["future-only ROI vs historical closing odds ROI 比較", "top2除外ROI チェック"],
      writeAllowed: false,
      writeTarget: null,
    };
  }

  if (p === 2) {
    // condB 残件取得
    const remaining = dr.condB.total - dr.condB.haoSaved;
    return {
      title: `condB historical closing odds 残件取得 (${remaining}件)`,
      rationale: `condB ${dr.condB.haoSaved}/${dr.condB.total} 保存済み。残り ${remaining} 件を取得する。`,
      steps: [
        { step: 1, description: "backup", command: "pnpm backup", isCheck: true },
        { step: 2, description: "dry-run 確認", command: `pnpm backfill:historical-alt-odds --limit 5 --priority condB` },
        { step: 3, description: "人間確認", isWarn: true },
        { step: 4, description: `write: condB 残 ${remaining} 件`, command: `pnpm backfill:historical-alt-odds --limit ${remaining} --priority condB --write --sleep-ms 1000` },
        { step: 5, description: "quality check", command: "pnpm check:historical-alt-odds-quality" },
        { step: 6, description: "governor 更新", command: "pnpm report:research-governor" },
      ],
      prereqs: ["backup 実施", "human approval"],
      checks: ["dry-run 結果確認", "品質チェック通過"],
      postChecks: ["condB coverage 100%確認", "同値率 0%確認"],
      writeAllowed: true,
      writeTarget: "historical_alternative_odds のみ",
    };
  }

  if (p === 3) {
    // skip6R backfill
    const remaining = dr.skip6R.total - dr.skip6R.haoSaved;
    return {
      title: `skip6R historical alternative odds 小規模 backfill (残 ${remaining}/${dr.skip6R.total}件)`,
      rationale: `condB historical closing odds は完備 (${dr.condB.coverage}%)。次は skip6R switch 予備検証のためにデータ取得。`,
      steps: [
        { step: 1, description: "backup を実施", command: "pnpm backup", isCheck: true },
        { step: 2, description: "現状確認", command: "pnpm check:historical-alt-odds-quality" },
        { step: 3, description: "skip6R dry-run (5件)", command: "pnpm backfill:historical-alt-odds --limit 5 --priority skip6R" },
        { step: 4, description: "dry-run 結果を人間が確認", isWarn: true, description2: "same-value rate / fetch成功率 / 5買い目coverage を確認" } as StepItem,
        { step: 5, description: "小規模 write 30件", command: "pnpm backfill:historical-alt-odds --limit 30 --priority skip6R --write --sleep-ms 1000" },
        { step: 6, description: "quality check", command: "pnpm check:historical-alt-odds-quality" },
        { step: 7, description: "governor 更新", command: "pnpm report:research-governor" },
        { step: 8, description: "満足なら残り write", command: `pnpm backfill:historical-alt-odds --limit ${remaining} --priority skip6R --write --sleep-ms 1000` },
      ],
      prereqs: ["backup 実施", "dry-run 確認", "human approval", "condB coverage 100%"],
      checks: ["fetch 成功率 ≥ 95%", "5買い目揃い率 ≥ 95%", "同値率 0%", "既存テーブル汚染なし"],
      postChecks: ["skip6R historical closing odds coverage 確認", "switch 予備検証スクリプト作成"],
      writeAllowed: true,
      writeTarget: "historical_alternative_odds のみ (既存テーブルへの書き込み禁止)",
    };
  }

  // default
  return {
    title: gov.nextAction.action,
    rationale: "governor の自動判断に基づく次アクション",
    steps: [{ step: 1, description: gov.nextAction.command }],
    prereqs: [],
    checks: [],
    postChecks: [],
    writeAllowed: false,
    writeTarget: null,
  };
}

const plan = buildActionPlan(gov);

// ─── MD 出力 ──────────────────────────────────────────────────────────────────

const now = new Date().toISOString();
const lines: string[] = [];

lines.push(`# 次のリサーチアクション計画`);
lines.push(``);
lines.push(`生成日時: ${now}`);
lines.push(`governor 生成日時: ${gov.generatedAt}`);
lines.push(``);
lines.push(`> **⚠️ この計画は提案のみです。自動実行しません。write が必要な場合は人間確認後に実施してください。**`);
lines.push(`> **BUY は検証候補。ROI は検証指標。購入指示・採用判断ではない。app_settings 変更禁止。**`);
lines.push(``);
lines.push(`---`);
lines.push(``);

// 1行結論
lines.push(`## 1行結論`);
lines.push(``);
lines.push(`> **${gov.oneLiner}**`);
lines.push(``);

// 次のアクション
lines.push(`## 次アクション: ${plan.title}`);
lines.push(``);
lines.push(`**根拠:** ${plan.rationale}`);
lines.push(``);

lines.push(`### 前提条件`);
lines.push(``);
for (const p of plan.prereqs) lines.push(`- [ ] ${p}`);
if (plan.prereqs.length === 0) lines.push(`- (なし)`);
lines.push(``);

lines.push(`### 実行ステップ`);
lines.push(``);
for (const s of plan.steps) {
  const warn = (s as { isWarn?: boolean }).isWarn ? " ⚠️ **人間確認が必要**" : "";
  const check = s.isCheck ? " ✅" : "";
  lines.push(`${s.step}. ${s.description}${warn}${check}`);
  if (s.command) lines.push(`   \`\`\`bash\n   ${s.command}\n   \`\`\``);
}
lines.push(``);

lines.push(`### 品質チェックリスト`);
lines.push(``);
for (const c of plan.checks) lines.push(`- [ ] ${c}`);
if (plan.checks.length === 0) lines.push(`- (なし)`);
lines.push(``);

lines.push(`### write 許可`);
lines.push(``);
lines.push(`| 項目 | 内容 |`);
lines.push(`|---|---|`);
lines.push(`| write 許可 | ${plan.writeAllowed ? "⚠️ 人間確認後に許可" : "❌ 今回は write なし"} |`);
lines.push(`| write 対象 | ${plan.writeTarget ?? "なし"} |`);
lines.push(`| 既存テーブルへの書き込み | **禁止** |`);
lines.push(``);

// 禁止事項
lines.push(`## 今やってはいけないこと`);
lines.push(``);
for (const f of gov.forbidden) lines.push(`- ❌ ${f}`);
lines.push(``);

// データ準備状況
lines.push(`## データ準備状況`);
lines.push(``);
const dr = gov.dataReadiness;
lines.push(`| 項目 | 状態 |`);
lines.push(`|---|---|`);
lines.push(`| condB historical closing odds | ${dr.condB.haoSaved}/${dr.condB.total} (${dr.condB.coverage}%) ${dr.condB.coverage >= 99 ? "✅" : "⚠️"} |`);
lines.push(`| skip6R historical closing odds | ${dr.skip6R.haoSaved}/${dr.skip6R.total} (${dr.skip6R.coverage}%) ${dr.skip6R.coverage >= 99 ? "✅" : "❌"} |`);
lines.push(`| skipVenue historical closing odds | ${dr.skipVenue.haoSaved}/${dr.skipVenue.total} (${dr.skipVenue.coverage}%) ${dr.skipVenue.coverage >= 99 ? "✅" : "❌"} |`);
lines.push(`| future-only timeseries condB overlap | ${dr.timeseries.condBOverlap} ${dr.timeseries.futureOnlySwitchReady ? "✅" : "❌ (<30)"} |`);
lines.push(``);

// 仮説状態サマリ
lines.push(`## 仮説状態サマリ`);
lines.push(``);
lines.push(`| ID | 名前 | 状態 | 採用可否 |`);
lines.push(`|---|---|---|:---:|`);
for (const h of gov.hypotheses) {
  lines.push(`| ${h.id} | ${h.name} | ${h.status} | ${h.adoptionAllowed ? "✅" : "❌"} |`);
}
lines.push(``);

lines.push(`---`);
lines.push(`*生成: plan-next-research-action.ts*`);

const md = lines.join("\n");
if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");

const jsonOut = {
  generatedAt: now,
  governorGeneratedAt: gov.generatedAt,
  nextAction: gov.nextAction,
  plan: {
    title: plan.title,
    rationale: plan.rationale,
    writeAllowed: plan.writeAllowed,
    writeTarget: plan.writeTarget,
    steps: plan.steps.map(s => ({ step: s.step, description: s.description, command: s.command ?? null })),
    prereqs: plan.prereqs,
    checks: plan.checks,
    postChecks: plan.postChecks,
  },
  dataReadiness: gov.dataReadiness,
  forbidden: gov.forbidden,
  oneLiner: gov.oneLiner,
};
writeFileSync(OUT_JSON, JSON.stringify(jsonOut, null, 2), "utf-8");

console.log(`=== 次のリサーチアクション計画 ===`);
console.log(`  タイトル: ${plan.title}`);
console.log(`  write 許可: ${plan.writeAllowed ? "⚠️ 人間確認後" : "❌ なし"}`);
console.log(`  1行結論: ${gov.oneLiner}`);
console.log();
console.log(`出力: ${OUT_MD}`);
console.log(`出力: ${OUT_JSON}`);
