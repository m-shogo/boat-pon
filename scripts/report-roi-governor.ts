/**
 * report-roi-governor.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 * BUY は検証候補、ROI は検証指標であり購入推奨ではない。
 *
 * 目的: 既存レポート JSON を読み取り、現在フェーズ・格上げ/降格判定・次アクションを自動生成。
 *       新規 ROI 候補探索はしない。ガバナンス判定のみ。
 *
 * 入力: reports/ 配下の JSON（DB アクセスなし）
 * 出力: reports/roi-governor.md / reports/roi-governor.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const OUT_MD   = "reports/roi-governor.md";
const OUT_JSON = "reports/roi-governor.json";

// ─── 型 ──────────────────────────────────────────────────────────────────────

type Phase =
  | "monitor-only"
  | "candidate-search"
  | "promotion-review"
  | "demotion-review"
  | "blocked-overfit-risk";

type CondBStatus = {
  n: number;
  nToUpgrade: number;
  nReached200: boolean;
  trainRoi: number;
  fwdRoi: number;
  top1ExclRoi: number;
  top2ExclRoi: number;
  top3ExclRoi: number;
  recentFwdRoi: number;     // forward後半 (fwdH2) ROI
  recentZeroMonths: number;
  top2RoiOk: boolean;
  upgradeVerdict: string;
  // 降格条件を数値上は満たしているが n<200 のため判定を保留している場合 true
  demotionRisk: boolean;
  verdict: "格上げ候補" | "格上げ待ち" | "降格候補" | "monitor継続" | "data-insufficient";
};

type SelectorStatus = {
  baselineFwdRoi: number;
  onePtFwdRoi: number;
  multiPtFwdRoi: number;
  onePtAdopted: boolean;
  multiPtAdopted: boolean;
  reason: string;
};

type SuminoeStatus = {
  label: string;
  fwdN: number;
  status: "data-insufficient" | "overfit-risk" | "overfit" | "凍結";
  note: string;
};

type GovReport = {
  generatedAt: string;
  phase: Phase;
  phaseReason: string;
  condB: CondBStatus;
  selector: SelectorStatus;
  suminoe: SuminoeStatus[];
  blockedActions: string[];
  allowedActions: string[];
  nextCommands: string[];
  humanSummary: {
    doNow: string[];
    doNotDo: string[];
    nextTrigger: string;
  };
};

// ─── JSON 読み込み（存在しない場合は null） ───────────────────────────────────

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) { console.warn(`  [skip] ${path} not found`); return null; }
  try { return JSON.parse(readFileSync(path, "utf-8")) as T; } catch { console.warn(`  [skip] failed to parse ${path}`); return null; }
}

// ─── 各 JSON 読み込み ─────────────────────────────────────────────────────────

console.log("[roi-governor] レポートJSON 読み込み...");

const monitorJson = readJson<{
  generatedAt: string;
  baseline: { n: number; payoutRoi: number };
  switchMonitors: {
    id: string; label: string; from: string; to: string;
    train: { n: number; payoutRoi132: number };
    forward: { n: number; payoutRoi132: number };
    trend: string;
    upgradeCheck: { top2ExclRoi: number; recentZeroMonths: number; upgradeVerdict: string; nToUpgrade: number };
    verdict: string;
  }[];
}>("reports/paper-forward-monitor.json");

const deepDiveJson = readJson<{
  upgradeStatus: { nForUpgrade: number; nReached200: boolean; top2RoiOk: boolean; recentZeroCount: number };
  periods: {
    train: { n: number; roi132: number };
    fwdAll: { n: number; roi132: number; hits132: number; hitRate132: number };
    fwdH1: { n: number; roi132: number };
    fwdH2: { n: number; roi132: number };
  };
  excludeMax: {
    forward: { allRoi: number; top1Roi: number; top2Roi: number; top3Roi: number };
    train: { allRoi: number };
  };
}>("reports/wind24-exh1-switch-deep-dive.json");

const selectorJson = readJson<{
  generatedAt: string;
  conditions: Record<string, {
    id: string; label: string;
    nForward: number; nTrain: number;
    bestTrainRoi: number;
    singleBets: Record<string, { overall: { n: number; roi: number }; train: { roi: number }; forward: { roi: number; top2ExclRoi: number } }>;
  }>;
  selectors: {
    onePt: { forward: { roi: number; selected: number; skipped: number } };
    multiPt: { forward: { roi: number; selected: number; skipped: number } };
  };
  classification: {
    paperForward: string[];
    upgradeWait: string[];
    dataInsufficient: string[];
    fwdRisingMonitor: string[];
    fwdRising: string[];
    overfit: string[];
    degraded: string[];
    skipped: string[];
    rejected: string[];
  };
}>("reports/ticket-selector-strategies.json");

const candidatesJson = readJson<{
  baseline: { n: number; payoutRoi: number };
  switchCandidates: { id: string; label: string; n: number; payoutRoiTo: number; nConfidence: string }[];
}>("reports/paper-forward-candidates.json");

// ─── 条件B 判定 ────────────────────────────────────────────────────────────────

function buildCondBStatus(): CondBStatus {
  const swMon = monitorJson?.switchMonitors.find(m => m.id === "sw_wind24_exh1");
  const dd = deepDiveJson;

  const n              = dd?.periods.fwdAll.n ?? swMon?.forward.n ?? 0;
  const trainRoi       = dd?.periods.train.roi132 ?? swMon?.train.payoutRoi132 ?? 0;
  const fwdRoi         = dd?.periods.fwdAll.roi132 ?? swMon?.forward.payoutRoi132 ?? 0;
  const top1ExclRoi    = dd?.excludeMax.forward.top1Roi ?? 0;
  const top2ExclRoi    = dd?.excludeMax.forward.top2Roi ?? swMon?.upgradeCheck.top2ExclRoi ?? 0;
  const top3ExclRoi    = dd?.excludeMax.forward.top3Roi ?? 0;
  const recentFwdRoi   = dd?.periods.fwdH2.roi132 ?? 0;
  const nToUpgrade     = dd?.upgradeStatus.nForUpgrade ?? swMon?.upgradeCheck.nToUpgrade ?? 33;
  const nReached200    = dd?.upgradeStatus.nReached200 ?? false;
  const top2RoiOk      = dd?.upgradeStatus.top2RoiOk ?? false;
  const recentZeroMonths = dd?.upgradeStatus.recentZeroCount ?? swMon?.upgradeCheck.recentZeroMonths ?? 0;

  const upgradeVerdict = swMon?.upgradeCheck.upgradeVerdict ?? "格上げ待ち(n不足)";

  // 降格判定は n >= 200 到達後のみ有効にする
  // n < 200 の間は、降格条件を満たしていても「格上げ待ち」として monitor 継続
  // （降格リスクあり警告は demotionRisk フラグで別途表示）
  let verdict: CondBStatus["verdict"];
  if (n < 30)                                                         verdict = "data-insufficient";
  else if (nReached200 && top2RoiOk && recentZeroMonths === 0)        verdict = "格上げ候補";
  else if (nReached200 && top2ExclRoi < 95 && recentZeroMonths >= 3) verdict = "降格候補";
  else                                                                 verdict = "格上げ待ち";

  // n<200 の間は降格を保留するが、数値上の降格リスクがあれば警告フラグを立てる
  const demotionRisk = !nReached200 && top2ExclRoi < 95 && recentZeroMonths >= 3;

  return { n, nToUpgrade, nReached200, trainRoi, fwdRoi, top1ExclRoi, top2ExclRoi, top3ExclRoi, recentFwdRoi, recentZeroMonths, top2RoiOk, upgradeVerdict, demotionRisk, verdict };
}

// ─── セレクター判定 ────────────────────────────────────────────────────────────

function buildSelectorStatus(): SelectorStatus {
  const baseline = candidatesJson?.baseline.payoutRoi ?? monitorJson?.baseline.payoutRoi ?? 0;
  const onePt    = selectorJson?.selectors.onePt.forward.roi ?? 0;
  const multiPt  = selectorJson?.selectors.multiPt.forward.roi ?? 0;

  const onePtAdopted  = onePt > baseline;
  const multiPtAdopted = multiPt > baseline;
  const reason = [
    `現行全件 3連単1-2-3 forward ROI = ${baseline}%`,
    `1点セレクター forward ROI = ${onePt}% → ${onePtAdopted ? "改善(採用候補)" : "悪化(不採用)"}`,
    `複数点セレクター forward ROI = ${multiPt}% → ${multiPtAdopted ? "改善(採用候補)" : "悪化(不採用)"}`,
  ].join(" / ");

  return { baselineFwdRoi: baseline, onePtFwdRoi: onePt, multiPtFwdRoi: multiPt, onePtAdopted, multiPtAdopted, reason };
}

// ─── 住之江ステータス ──────────────────────────────────────────────────────────

function buildSuminoeStatus(): SuminoeStatus[] {
  const suminoeCondIds = ["C_suminoe_o4049", "D_suminoe_exh1", "E_suminoe_r5", "F_suminoe_o2539"];
  const result: SuminoeStatus[] = [];
  for (const id of suminoeCondIds) {
    const cond = selectorJson?.conditions[id];
    if (!cond) {
      result.push({ label: id, fwdN: 0, status: "data-insufficient", note: "データなし" });
      continue;
    }
    const fwdN = cond.nForward;
    let status: SuminoeStatus["status"];
    let note: string;
    if (fwdN < 30) {
      const trainRoi = cond.bestTrainRoi ?? 0;
      status = trainRoi >= 150 ? "overfit-risk" : "data-insufficient";
      note = trainRoi >= 150
        ? `n<30 かつ trainROI(best)=${trainRoi}%。過学習リスクあり。n=30到達まで凍結`
        : `n<30。判定不可。n=30到達後に再評価`;
    } else {
      const best = Object.values(cond.singleBets).reduce((a, b) => a.train.roi >= b.train.roi ? a : b);
      if (best.train.roi >= 100 && best.forward.roi < 95) {
        status = "overfit";
        note = `n=${fwdN} / trainROI高 / fwdROI低。過学習疑い。n=50到達後に再確認`;
      } else {
        status = "凍結";
        note = `n=${fwdN}。監視継続`;
      }
    }
    result.push({ label: cond.label, fwdN, status, note });
  }
  return result;
}

// ─── フェーズ判定 ──────────────────────────────────────────────────────────────

function determinePhase(condB: CondBStatus, sel: SelectorStatus, suminoe: SuminoeStatus[]): { phase: Phase; reason: string } {
  // 格上げ候補がいる場合
  if (condB.verdict === "格上げ候補") {
    return { phase: "promotion-review", reason: `条件B 格上げ条件を全て満たした (n=${condB.n}, top2除外=${condB.top2ExclRoi}%, 直近${condB.recentZeroMonths}ヶ月0hitなし)` };
  }
  // 降格候補がいる場合
  if (condB.verdict === "降格候補") {
    return { phase: "demotion-review", reason: `条件B top2除外ROI=${condB.top2ExclRoi}% かつ 直近${condB.recentZeroMonths}ヶ月連続0hit` };
  }
  // 過学習リスクが多い場合
  const overfitCount = suminoe.filter(s => s.status === "overfit" || s.status === "overfit-risk").length;
  if (overfitCount >= 3 && condB.n < 30) {
    return { phase: "blocked-overfit-risk", reason: `過学習リスク条件 ${overfitCount}件。n不足で判定不能な候補が多い` };
  }
  // セレクターが現行より改善している場合のみ候補探索フェーズへ
  if (sel.onePtAdopted || sel.multiPtAdopted) {
    return { phase: "promotion-review", reason: `セレクター forward ROI が現行を上回っている` };
  }
  // デフォルト: monitor-only
  return {
    phase: "monitor-only",
    reason: [
      `条件別セレクター不採用 (1点=${sel.onePtFwdRoi}% / 複数点=${sel.multiPtFwdRoi}% < 現行=${sel.baselineFwdRoi}%)`,
      `条件B n=${condB.n}/${condB.nReached200 ? "n=200到達済" : `n=200まであと${condB.nToUpgrade}件`} / top2除外=${condB.top2ExclRoi}%(格上げ条件>=100% ${condB.top2RoiOk ? "✅" : "❌"})`,
      `住之江系: 全条件 n<30 または 過学習疑いで凍結`,
    ].join("; "),
  };
}

// ─── 次アクション・ブロック ───────────────────────────────────────────────────

function buildActions(phase: Phase, condB: CondBStatus): { allowed: string[]; blocked: string[]; nextCommands: string[] } {
  const blocked = [
    "新規 ROI 候補探索（今は候補探しフェーズではない）",
    "app_settings 変更（禁止）",
    "本番 decision ロジック変更（禁止）",
    "条件別券種セレクター採用（forward ROI < 現行）",
    "複数点買いセット採用（forward ROI < 現行）",
    "拡連複採用（全条件最下位）",
    "住之江系の即採用（n不足 / 過学習リスク）",
    "自動投票・ログイン保存・投票サイト操作（禁止）",
  ];

  const allowed = ["監視 3点セット実行（データ更新後）", "forward データ蓄積の継続"];
  if (phase === "monitor-only") {
    allowed.push(`条件B forward n=${condB.n} → n=200到達を待つ`);
    allowed.push("住之江系 n=30 / n=50 到達を待つ");
  }
  if (phase === "promotion-review") {
    allowed.push("条件B 格上げ条件の再確認（全基準チェック）");
  }
  if (phase === "demotion-review") {
    allowed.push("条件B 降格基準の確認（top2除外ROI / 直近3ヶ月）");
  }

  const nextCommands = [
    "pnpm report:paper-forward-candidates   # 台帳: switch/除外/残存",
    "pnpm report:paper-forward-monitor      # 格上げ判定自動表示",
    "pnpm analyze:wind24-exh1-switch        # 最有力候補の深掘り",
    "# 必要なら:",
    "pnpm analyze:ticket-selector-strategies  # 券種セレクター検証（月次程度でOK）",
  ];

  return { allowed, blocked, nextCommands };
}

// ─── 人間向けサマリー ──────────────────────────────────────────────────────────

function buildHumanSummary(phase: Phase, condB: CondBStatus, sel: SelectorStatus): GovReport["humanSummary"] {
  const doNow = ["監視 3点セットを定期実行する"];

  if (phase === "monitor-only") {
    doNow.push(`条件B forward n=${condB.n}。n=200到達後に top2除外ROI ≥ 100% を確認する`);
    if (condB.recentZeroMonths >= 2) doNow.push(`⚠️ 直近${condB.recentZeroMonths}ヶ月 0hit 継続中。降格ラインに注意`);
  }
  if (phase === "promotion-review") {
    doNow.push("条件B 格上げ全条件を手動確認する（CLAUDE.md 格上げ条件 4項目）");
  }
  if (phase === "demotion-review") {
    doNow.push("条件B 降格条件を確認。直近3ヶ月継続0hitなら降格候補へ");
  }

  const doNotDo = [
    "app_settings / 本番 decision ロジックを変更する",
    "新しい ROI 候補を探索する（今は不要）",
    "条件別セレクター・複数点買いを採用する",
    "拡連複を採用する",
    "住之江系（n<30）を採用する",
  ];

  let nextTrigger: string;
  if (phase === "monitor-only") {
    nextTrigger = condB.nReached200
      ? `条件B top2除外ROI が ${condB.top2ExclRoi}% から 100% 以上に到達したとき`
      : `条件B forward n が ${condB.n} から 200 に到達したとき（あと ${condB.nToUpgrade} 件）`;
  } else if (phase === "promotion-review") {
    nextTrigger = "格上げ 4条件の人間確認が完了したとき";
  } else {
    nextTrigger = "降格条件の確認完了後";
  }

  return { doNow, doNotDo, nextTrigger };
}

// ─── メイン実行 ───────────────────────────────────────────────────────────────

const condB    = buildCondBStatus();
const selector = buildSelectorStatus();
const suminoe  = buildSuminoeStatus();
const { phase, reason: phaseReason } = determinePhase(condB, selector, suminoe);
const { allowed, blocked, nextCommands } = buildActions(phase, condB);
const humanSummary = buildHumanSummary(phase, condB, selector);

const report: GovReport = {
  generatedAt: new Date().toISOString(),
  phase, phaseReason,
  condB, selector, suminoe,
  blockedActions: blocked,
  allowedActions: allowed,
  nextCommands,
  humanSummary,
};

// ─── Markdown 生成 ────────────────────────────────────────────────────────────

const PHASE_LABELS: Record<Phase, string> = {
  "monitor-only":        "🔍 monitor-only（監視フェーズ）",
  "candidate-search":    "🔎 candidate-search（候補探索フェーズ）",
  "promotion-review":    "⬆️  promotion-review（格上げ確認フェーズ）",
  "demotion-review":     "⬇️  demotion-review（降格確認フェーズ）",
  "blocked-overfit-risk":"🚫 blocked-overfit-risk（過学習リスクにより探索ブロック）",
};

const VERDICT_EMOJI: Record<string, string> = {
  "格上げ候補": "⬆️",
  "格上げ待ち": "⏳",
  "降格候補":   "⬇️",
  "monitor継続":"🔍",
  "data-insufficient": "🔍",
};

const recentNote = condB.recentZeroMonths >= 3
  ? `⚠️ 直近 ${condB.recentZeroMonths}ヶ月 0hit 継続`
  : condB.recentZeroMonths >= 1
    ? `注意: 直近 ${condB.recentZeroMonths}ヶ月 0hit`
    : `直近3ヶ月 ROI=${condB.recentFwdRoi}%`;

let md = `# ROI Governor Report

生成日時: ${report.generatedAt}

> **読み取り専用。BUY は検証候補、ROI は検証指標。購入指示ではない。app_settings / 本番 decision 変更禁止。**

---

## 現在フェーズ

**${PHASE_LABELS[phase]}**

**理由:**
${phaseReason.split("; ").map(r => `- ${r}`).join("\n")}

### 許可アクション
${allowed.map(a => `- ✅ ${a}`).join("\n")}

### ブロックアクション
${blocked.map(b => `- 🚫 ${b}`).join("\n")}

---

## 監視対象

### 条件B: 風速2〜4 × 1号艇展示1位 → 3連単1-3-2

| 項目 | 値 |
|---|---|
| forward n | **${condB.n}** |
| n=200 まであと | **${condB.nReached200 ? "到達済 ✅" : `${condB.nToUpgrade}件`}** |
| train ROI (3連単1-3-2) | ${condB.trainRoi}% |
| forward ROI (3連単1-3-2) | **${condB.fwdRoi}%** |
| top1除外 ROI | ${condB.top1ExclRoi}% |
| top2除外 ROI | **${condB.top2ExclRoi}%** ${condB.top2RoiOk ? "✅ (>=100%)" : "❌ (<100%)"} |
| top3除外 ROI | ${condB.top3ExclRoi}% |
| forward後半(H2) ROI | ${condB.recentFwdRoi}% |
| 直近 0hit 月数 | ${condB.recentZeroMonths}ヶ月 (${recentNote}) |
| 判定 | **${VERDICT_EMOJI[condB.verdict] ?? ""} ${condB.verdict}** |
| 格上げ条件 | n>=200: ${condB.nReached200 ? "✅" : "❌"} / top2除外>=100%: ${condB.top2RoiOk ? "✅" : "❌"} / 直近0hitなし: ${condB.recentZeroMonths === 0 ? "✅" : "❌"} |

${condB.demotionRisk ? `> ⚠️ **降格リスク警告**: top2除外ROI=${condB.top2ExclRoi}%(<95%) かつ 直近${condB.recentZeroMonths}ヶ月連続0hit。降格条件を数値上は満たしている。\n> ただし n=${condB.n} < 200 のため判定を保留。n=200到達後に改めて判断する。\n> ` : ""}
> train ROI < 100% (${condB.trainRoi}%) → forward ROI > 100% (${condB.fwdRoi}%) = **forward急伸**
> セレクターとしては不採用（train最良買い目は 2連単1-3）。単独 monitor 継続。

### セレクター（条件別券種セレクター）

| セレクター | forward ROI | 現行比 | 採用 |
|---|---|---|---|
| 現行 全件3連単1-2-3 | **${selector.baselineFwdRoi}%** | baseline | - |
| 1点セレクター | ${selector.onePtFwdRoi}% | ${selector.onePtFwdRoi - selector.baselineFwdRoi > 0 ? "+" : ""}${Math.round((selector.onePtFwdRoi - selector.baselineFwdRoi) * 100) / 100}pt | ${selector.onePtAdopted ? "✅ 採用候補" : "❌ 不採用"} |
| 複数点セレクター | ${selector.multiPtFwdRoi}% | ${selector.multiPtFwdRoi - selector.baselineFwdRoi > 0 ? "+" : ""}${Math.round((selector.multiPtFwdRoi - selector.baselineFwdRoi) * 100) / 100}pt | ${selector.multiPtAdopted ? "✅ 採用候補" : "❌ 不採用"} |

> 拡連複: 全条件最下位。完全不採用。

### 住之江系

| 条件 | fwd n | ステータス | 備考 |
|---|---|---|---|
${suminoe.map(s => `| ${s.label} | ${s.fwdN} | ${s.status} | ${s.note} |`).join("\n")}

---

## 格上げ/降格 判定表

| 候補 | n | forward ROI | top2除外ROI | 直近3M | 判定 | 次のトリガー |
|---|---|---|---|---|---|---|
| 条件B 3連単1-3-2 | ${condB.n} | ${condB.fwdRoi}% | **${condB.top2ExclRoi}%** ${condB.top2RoiOk ? "✅" : "❌"} | ${recentNote} | **${condB.verdict}** | ${condB.nReached200 ? "top2除外ROI >= 100% 到達時" : `n=200到達 (あと${condB.nToUpgrade}件)`} |
${suminoe.map(s => `| ${s.label} | ${s.fwdN} | - | - | - | **${s.status}** | n=30到達後に再評価 |`).join("\n")}

---

## 次に実行するコマンド

\`\`\`bash
${nextCommands.join("\n")}
\`\`\`

---

## 人間への結論

### 今やること
${humanSummary.doNow.map(d => `- ${d}`).join("\n")}

### やらないこと
${humanSummary.doNotDo.map(d => `- 🚫 ${d}`).join("\n")}

### 次の判断タイミング
**${humanSummary.nextTrigger}**

---
*生成: report-roi-governor.ts*
`;

// ─── 出力 ─────────────────────────────────────────────────────────────────────

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD,   md,                          "utf-8");
writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), "utf-8");

console.log(`\n[roi-governor] 完了`);
console.log(`  → ${OUT_MD}`);
console.log(`  → ${OUT_JSON}`);
console.log(`\n=== 現在フェーズ ===`);
console.log(`  ${PHASE_LABELS[phase]}`);
console.log(`\n=== 条件B ===`);
console.log(`  n=${condB.n} (あと${condB.nToUpgrade}件) / fwd ROI=${condB.fwdRoi}% / top2除外=${condB.top2ExclRoi}% / ${condB.verdict}`);
console.log(`  直近${condB.recentZeroMonths}ヶ月 0hit / forward後半ROI=${condB.recentFwdRoi}%`);
console.log(`\n=== セレクター ===`);
console.log(`  現行=${selector.baselineFwdRoi}% / 1点=${selector.onePtFwdRoi}% / 複数点=${selector.multiPtFwdRoi}%`);
console.log(`  → ${selector.onePtAdopted || selector.multiPtAdopted ? "改善あり(採用候補)" : "両方不採用"}`);
console.log(`\n=== 次アクション ===`);
humanSummary.doNow.forEach(d => console.log(`  ✅ ${d}`));
console.log(`\n=== 次の判断タイミング ===`);
console.log(`  ${humanSummary.nextTrigger}`);
