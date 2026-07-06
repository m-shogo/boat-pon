/**
 * Rule Lifecycle 永続化CLI（Phase 3 最小実装）
 *
 * data/research-rules.json のみを読み書きする。SQLite DB（boat.sqlite等）、
 * app_settings、decision_historyには一切触れない。状態遷移の可否判定は
 * src/domain/researchRuleStore.ts（純粋関数）に委譲し、ここではファイルI/Oのみ行う。
 *
 * サブコマンド:
 *   list [--status <status>]                                          登録済みルール一覧（デフォルト、read-only）
 *   add --rule-id <id> --reason <text> [--title <text>] [--dry-run]    candidate状態で新規登録
 *   transition --rule-id <id> --to <status> [--evaluation-file <path>] [--dry-run]
 *                                                                      状態遷移を試みる
 *
 * --evaluation-file には RuleEvaluationResult 形式のJSON（例: explore-roi.ts --json の出力）を渡す。
 * "production"への遷移はこれが無い、またはisForwardTested=falseだと拒否される。
 *
 * --dry-run は add / transition にのみ有効。状態遷移のバリデーション（canTransitionRuleStatus /
 * validateProductionEligibility）は通常通り実行し、不正な遷移は--dry-runでも失敗する。
 * data/research-rules.json は一切書き換えず、書き込まれるはずだった内容をJSONで表示するだけ。
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { addRule, applyRuleTransition, createResearchRule } from "../src/domain/researchRuleStore";
import type { ForwardTestResult, ResearchRule, RuleStatus } from "../src/domain/researchRule";

const STORE_PATH = process.env.BOAT_PON_RULE_STORE_PATH ?? "data/research-rules.json";

type RuleStoreFile = {
  _meta: { description: string; warning: string; lastUpdated: string };
  rules: ResearchRule[];
};

// pnpmのバージョンによっては `pnpm manage:research-rules -- add ...` の "--" が
// そのままスクリプトへ転送されるため（scripts/explore-roi.tsと同じ事情）、先に取り除く。
const argv = process.argv.slice(2).filter((arg) => arg !== "--");
const [command, ...rest] = argv;

switch (command) {
  case "add":
    runAdd(rest);
    break;
  case "transition":
    runTransition(rest);
    break;
  case "list":
  case undefined:
    runList(rest);
    break;
  case "--help":
  case "-h":
    printHelp();
    break;
  default:
    console.error(`unknown command: ${command}`);
    printHelp();
    process.exit(1);
}

function defaultStore(): RuleStoreFile {
  return {
    _meta: {
      description: "Boat Pon Research Rule Lifecycle registry (Phase 3, src/domain/researchRule.ts / researchRuleStore.ts)",
      warning:
        "BUYは検証候補、ROIは検証指標。Production昇格はvalidateProductionEligibility合格時のみ。" +
        "SQLite DB/app_settings/decision_historyには一切書き込まない。",
      lastUpdated: new Date().toISOString(),
    },
    rules: [],
  };
}

function loadStore(): RuleStoreFile {
  if (!existsSync(STORE_PATH)) return defaultStore();
  return JSON.parse(readFileSync(STORE_PATH, "utf8")) as RuleStoreFile;
}

function saveStore(store: RuleStoreFile) {
  store._meta.lastUpdated = new Date().toISOString();
  writeFileSync(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function runList(argv: string[]) {
  const args = parseFlags(argv, ["--status"]);
  const statusFilter = args["--status"];

  const store = loadStore();
  const rules = statusFilter ? store.rules.filter((rule) => rule.status === statusFilter) : store.rules;

  if (rules.length === 0) {
    console.log(
      statusFilter
        ? `no rules with status="${statusFilter}" in ${STORE_PATH}`
        : `no rules registered in ${STORE_PATH}`,
    );
    return;
  }
  for (const rule of rules) {
    const title = rule.title ? `\ttitle=${rule.title}` : "";
    console.log(`${rule.ruleId}\t${rule.status}${title}\tupdatedAt=${rule.updatedAt}\t${rule.reasonSummary}`);
  }
}

function runAdd(rawArgv: string[]) {
  const dryRun = rawArgv.includes("--dry-run");
  const argv = rawArgv.filter((arg) => arg !== "--dry-run");
  const args = parseFlags(argv, ["--rule-id", "--reason", "--title"]);
  const ruleId = args["--rule-id"];
  const reason = args["--reason"];
  if (!ruleId || !reason) {
    console.error("usage: add --rule-id <id> --reason <text> [--title <text>] [--dry-run]");
    process.exit(1);
  }

  const store = loadStore();
  const result = addRule(store.rules, createResearchRule(ruleId, reason, new Date().toISOString(), args["--title"]));
  if (!result.ok) {
    console.error(`error: ${result.error.reason}`);
    process.exit(1);
  }

  const addedRule = result.rules[result.rules.length - 1];
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, action: "add", wouldAdd: addedRule }, null, 2));
    return;
  }
  store.rules = result.rules;
  saveStore(store);
  console.log(`added rule "${ruleId}" at status=candidate`);
}

function runTransition(rawArgv: string[]) {
  const dryRun = rawArgv.includes("--dry-run");
  const argv = rawArgv.filter((arg) => arg !== "--dry-run");
  const args = parseFlags(argv, ["--rule-id", "--to", "--evaluation-file"]);
  const ruleId = args["--rule-id"];
  const to = args["--to"] as RuleStatus | undefined;
  if (!ruleId || !to) {
    console.error("usage: transition --rule-id <id> --to <status> [--evaluation-file <path>] [--dry-run]");
    process.exit(1);
  }

  let evaluation: ForwardTestResult | undefined;
  const evaluationFile = args["--evaluation-file"];
  if (evaluationFile) {
    if (!existsSync(evaluationFile)) {
      console.error(`evaluation file not found: ${evaluationFile}`);
      process.exit(1);
    }
    evaluation = JSON.parse(readFileSync(evaluationFile, "utf8")) as ForwardTestResult;
  }

  const store = loadStore();
  const result = applyRuleTransition(store.rules, ruleId, to, evaluation);
  if (!result.ok) {
    console.error(`error: ${result.error.reason}`);
    process.exit(1);
  }

  const updatedRule = result.rules.find((rule) => rule.ruleId === ruleId);
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, action: "transition", to, wouldUpdate: updatedRule }, null, 2));
    return;
  }
  store.rules = result.rules;
  saveStore(store);
  console.log(`rule "${ruleId}" transitioned to "${to}"`);
}

function parseFlags(argv: string[], known: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!known.includes(arg)) throw new Error(`unknown option: ${arg}`);
    out[arg] = argv[++i];
  }
  return out;
}

function printHelp() {
  console.log(`Usage:
  pnpm manage:research-rules -- list [--status <status>]
  pnpm manage:research-rules -- add --rule-id <id> --reason <text> [--title <text>] [--dry-run]
  pnpm manage:research-rules -- transition --rule-id <id> --to <status> [--evaluation-file <path>] [--dry-run]

Reads/writes only ${STORE_PATH} (override with $BOAT_PON_RULE_STORE_PATH).
Never touches the SQLite DB, app_settings, or decision_history.
Status transitions are validated by src/domain/researchRuleStore.ts —
production requires a forward-tested, eligible evaluation and the rule
must already be "approved".

--dry-run (add / transition only): runs the same validation but never
writes ${STORE_PATH}; prints the JSON that would have been written.
An invalid transition still fails under --dry-run.`);
}
