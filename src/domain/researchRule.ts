export type RuleStatus =
  | "candidate"
  | "backtest"
  | "forward"
  | "review"
  | "approved"
  | "production"
  | "deprecated"
  | "archived";

/**
 * ルール固有の評価条件（Phase 5.2最小実装）。allowlist方式の単純な等価比較のみ。
 * 複雑な比較・範囲条件・OR条件・正規表現・任意JS式・SQL文字列生成は意図的に対象外
 * （`src/domain/researchRuleConditions.ts`のバリデーションで弾く）。
 */
export type ResearchRuleConditionOperator = "equals";

export type ResearchRuleEvaluationCondition = {
  key: string;
  operator: ResearchRuleConditionOperator;
  value: string | number | boolean;
};

export type ResearchRule = {
  ruleId: string;
  status: RuleStatus;
  createdAt: string;
  updatedAt: string;
  reasonSummary: string;
  warnings: string[];
  title?: string;
  /**
   * 省略可能（後方互換）。未指定・空配列なら従来通り「共通集計のラベル付け」
   * （shared-fallback）として扱われる。既存の`data/research-rules.json`は
   * この項目を持たないため、そのまま読み込める。
   */
  evaluationConditions?: ResearchRuleEvaluationCondition[];
};

export type EvaluationMetadata = {
  dataWindowStart: string;
  dataWindowEnd: string;
  evaluationRunAt: string;
  sampleSize: number;
};

export type RuleEvaluationResult = {
  ruleId: string;
  metadata: EvaluationMetadata;
  hitRate: number;
  roi: number;
  confidence: number;
  maxDrawdown: number;
  isForwardTested: boolean;
  isProductionEligible: boolean;
  reasonSummary: string;
  warnings: string[];
};

export type ForwardTestResult = RuleEvaluationResult & {
  isForwardTested: true;
};
