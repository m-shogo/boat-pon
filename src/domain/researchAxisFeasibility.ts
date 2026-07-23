import type { FeasibilityDecision } from "./allBetTypeFeasibility";

export type ResearchAxisId =
  | "official_information_market_lag"
  | "cross_market_consistency"
  | "first_mark_causal_graph"
  | "selective_prediction"
  | "fragility_index"
  | "latent_water_state"
  | "error_atlas";

export type ResearchAxisFeasibility = {
  id: ResearchAxisId;
  name: string;
  decision: FeasibilityDecision;
  currentData: string;
  newAcquisition: string;
  historicalReconstruction: string;
  futureOnly: string;
  leakageRisk: string;
  recommendedPhase: string;
  requiredSchema: string[];
  additionalRequestCost: string;
  pointInTimeRule: string;
};

export const RESEARCH_AXIS_FEASIBILITY: readonly ResearchAxisFeasibility[] = [
  {
    id: "official_information_market_lag",
    name: "公式情報の市場反映遅延",
    decision: "CONDITIONAL",
    currentData: "beforeinfo系はlatest upsert、3連単oddsはcheckpoint時系列。source公開時刻・変更履歴・全券種同期観測がない",
    newAcquisition: "公式情報のversioned observationと、変更後lag checkpointごとの全5市場画面",
    historicalReconstruction: "保存済みHTMLから値は部分再抽出可能だが、first_seen/changed_atと30秒〜5分反応は再現不可",
    futureOnly: "公開時刻がないsourceのfirst_seen bound、変更後30秒/1分/3分/5分反応",
    leakageRisk: "取得完了時刻を公開時刻と偽装、変更後に取得した値を変更前oddsへ結合、券種間の観測時刻ずれ",
    recommendedPhase: "N2/N3で観測基盤、N5以降で研究",
    requiredSchema: ["official_information_observations", "official_information_changes", "odds_market_observations_v2"],
    additionalRequestCost: "情報観測はsource page数×poll回数。反応計測は1 changeあたり5市場画面×lag checkpoint数。正確な日次costは変更頻度実測までUNKNOWN",
    pointInTimeRule: "source_published_atとsource_observed_atを分離し、market.observed_at >= change.first_seen_atの組だけをlag計測へ使う",
  },
  {
    id: "cross_market_consistency",
    name: "全券種市場整合性",
    decision: "CONDITIONAL",
    currentData: "7券種の公式画面構造は確認済みだが、live時系列は3連単のみ。複勝・拡連複はrange",
    newAcquisition: "同一観測batchで5画面・7券種の全selection、発売状態、range、返還状態を保存",
    historicalReconstruction: "既存3連単のみ部分可。過去の全券種同時点整合性は再現不可",
    futureOnly: "券種別ノイズ・波及順序・同時点矛盾の評価",
    leakageRisk: "異なる観測時刻を同時市場として投影、range midpointの確定値化、返還後marketを事前値へ混入",
    recommendedPhase: "N2で保存、N5以降で120状態投影研究",
    requiredSchema: ["market_observation_batches", "odds_market_observations_v2", "odds_selection_observations_v2", "market_projection_audit"],
    additionalRequestCost: "既存設計どおり1 checkpointあたり5 page。投影・制約検査自体は0 request",
    pointInTimeRule: "batch内最大observed_at−最小observed_atを保存し、許容skewを超えたbatchは整合性学習へ使わない",
  },
  {
    id: "first_mark_causal_graph",
    name: "1マーク因果グラフのデータ前提",
    decision: "CONDITIONAL",
    currentData: "展示進入/ST、実進入/ST、決まり手、着順、事故は部分〜広範囲に存在。公式の攻撃艇telemetryはない",
    newAcquisition: "展示・装備のappend-only観測。攻撃艇の公式sourceが見つからない限り因果labelは追加しない",
    historicalReconstruction: "実進入→実ST→決まり手→上位3着と共起proxyは再構築可能。攻撃艇・隣接艇を潰した因果は不可",
    futureOnly: "展示の直前versionと当時PIT品質を伴う完全graph input",
    leakageRisk: "決まり手・実ST・着順をレース前特徴へ混入、勝者を攻撃艇と機械的同一視、共起を因果と断定",
    recommendedPhase: "N3/N4でdata/label、M3で研究",
    requiredSchema: ["beforeinfo_observations_v2", "first_mark_label_audit", "racer_style_features"],
    additionalRequestCost: "既存beforeinfo観測と結果取得を再利用する限り0。追加telemetry sourceはUNKNOWN",
    pointInTimeRule: "展示まではpre-race、実進入以後はpost-race label。単一feature rowへ混在させない",
  },
  {
    id: "selective_prediction",
    name: "SKIP予測器・選択的予測",
    decision: "CONDITIONAL",
    currentData: "選手標本数・PIT品質の一部は監査可能だが、全券種120状態分布・券種間不一致・完全な鮮度metadataは未整備",
    newAcquisition: "上流のN2/N3観測のみ。SKIP専用の追加外部sourceは不要",
    historicalReconstruction: "既存3連単と結果から一部entropy/類似数は可能。全券種不一致と当時欠損maskは不可",
    futureOnly: "完全な入力欠損mask、観測skew、全券種不一致、forward calibration",
    leakageRisk: "対象結果で予測可能性labelを最適化、欠損を0補完、将来標本数・将来calibrationを使用",
    recommendedPhase: "N5で監査値、N6以降で研究",
    requiredSchema: ["uncertainty_feature_snapshots", "market_projection_audit"],
    additionalRequestCost: "上流観測を再利用するため追加0 request",
    pointInTimeRule: "すべての不確実性にas_of_at、sample_count、missing_reason、source_qualityを必須とする",
  },
  {
    id: "fragility_index",
    name: "入力摂動とFragility Index",
    decision: "CONDITIONAL",
    currentData: "値は存在するが、表示precision、measurement error、confidence、late update metadataがほぼない",
    newAcquisition: "同一sourceのraw表示、丸め単位、range、version変更履歴を観測rowへ追加",
    historicalReconstruction: "raw HTMLが残る範囲は表示precisionを部分再抽出可能。late update順序は不可",
    futureOnly: "source間差、更新頻度、late update probabilityの較正",
    leakageRisk: "表示丸めより細かい擬似精度、将来判明した更新幅で過去候補を摂動、source差を誤差と断定",
    recommendedPhase: "N2/N3でmetadata、N5以降で研究",
    requiredSchema: ["measurement_quality_fields on observation tables", "input_perturbation_manifests"],
    additionalRequestCost: "raw表示とversionを同じresponseから保存するなら0。source比較を追加する場合はsource数に比例しUNKNOWN",
    pointInTimeRule: "摂動範囲は当該observed_at時点で既知のprecision/range/source差だけから作る",
  },
  {
    id: "latent_water_state",
    name: "潜在水面状態",
    decision: "CONDITIONAL",
    currentData: "長期結果に実進入/ST/決まり手/事故/着順、直近期間にpre-race風波・安定板・周回短縮がある",
    newAcquisition: "pre-race風向とappend-only観測の継続。状態推定専用の追加requestは不要",
    historicalReconstruction: "同日strict-prior結果から市場期待残差以外の多くを再構築可能。市場期待は保存odds範囲のみ",
    futureOnly: "完全なpre-race風向、全券種市場期待、観測鮮度付き逐次更新",
    leakageRisk: "対象race以後の結果、払戻/高配当を荒れ定義に使用、2〜3raceで状態確定、会場・季節差の無視",
    recommendedPhase: "N4でstrict-prior台帳、N5以降で研究",
    requiredSchema: ["venue_day_evidence_snapshots", "water_state_rebuild_manifests"],
    additionalRequestCost: "既存結果・上流pre-race観測を再利用するため追加0 request",
    pointInTimeRule: "source_max_event_at < target_event_atを必須とし、会場・季節baselineとevidence countを同時保存する",
  },
  {
    id: "error_atlas",
    name: "Error Atlas",
    decision: "CONDITIONAL",
    currentData: "decision_history、公式上位3着、実進入/ST/事故、3連単T-5、5券種払戻があり現行paper候補は多くを分類可能",
    newAcquisition: "単勝・複勝払戻、全券種T-5/final-like、PIT監査reasonの固定保存",
    historicalReconstruction: "既存候補の着順誤り・集合/順序誤り・券種変換的中・事故は再構築可能",
    futureOnly: "全券種T-5価値→final-like価値消失、当時PIT不適格理由、観測時点別市場対モデル比較",
    leakageRisk: "結果を見てBUY条件を変更、final price欠測を払戻から推測、当時利用不能なfeatureで失敗原因を説明",
    recommendedPhase: "N4で監査台帳、N5/N8で市場・モデル層分類",
    requiredSchema: ["error_atlas_entries", "error_atlas_evidence"],
    additionalRequestCost: "保存済みdecision/resultを使う分類は0。価格層分類はN2の観測を再利用",
    pointInTimeRule: "candidate_manifestと当時input fingerprintを凍結し、結果後分類はaudit labelとしてのみ保存する",
  },
] as const;

export const INFORMATION_TIMING_EVENTS = [
  timing("program", "出走表公開・更新", "official_programs/raw program", false, "single_latest", "future_only", "公式説明は通常18時頃等の概算表示予定。race/versionごとの正確な公開時刻ではない"),
  timing("scratch", "欠場", "official program / odds / beforeinfo", false, "partial_latest", "future_only"),
  timing("exhibition_course", "展示進入", "beforeinfo", false, "single_latest", "future_only"),
  timing("exhibition_st", "展示ST", "beforeinfo", false, "single_latest", "future_only"),
  timing("exhibition_time", "展示タイム", "beforeinfo", false, "single_latest", "future_only"),
  timing("tilt", "チルト", "beforeinfo", false, "single_latest", "future_only"),
  timing("parts_change", "部品交換", "beforeinfo", false, "single_latest", "future_only"),
  timing("weather", "風向・風速・波高", "beforeinfo", false, "single_latest", "future_only", "公式画面に「11R時点」等のrace相対markerはあるが、壁時計の公開時刻ではない"),
  timing("stable_plate", "安定板", "beforeinfo", false, "single_latest", "future_only"),
  timing("shortened_laps", "周回短縮", "beforeinfo", false, "single_latest", "future_only"),
  timing("close_time", "締切時刻変更", "official program", false, "single_latest", "future_only"),
] as const;

export const FIRST_MARK_DATA_BOUNDARY = [
  boundary("展示進入", "pre_race_feature", "beforeinfoの観測時点付きraw", "append-only化後に利用可"),
  boundary("展示ST", "pre_race_feature", "beforeinfoの観測時点付きraw", "append-only化後に利用可"),
  boundary("展示タイム", "pre_race_feature", "beforeinfoの観測時点付きraw", "append-only化後に利用可"),
  boundary("コース別ST平均・分散", "pre_race_feature", "strict-prior race_entries", "n・window・as_of必須"),
  boundary("実進入", "post_race_label", "race_entries.entry_course", "教師/監査専用"),
  boundary("実ST", "post_race_label", "race_entries.st/status_code", "教師/監査専用"),
  boundary("決まり手", "post_race_label", "race_conditions.kimarite", "教師/監査専用"),
  boundary("1号艇の残り方", "post_race_derived_label", "公式着順", "定義固定で再現可"),
  boundary("隣接艇の着順変化", "post_race_proxy", "実進入と着順", "baseline比較が必要、因果表現禁止"),
  boundary("外艇の連動", "post_race_proxy", "実進入と着順", "共起のみ、因果表現禁止"),
  boundary("攻撃艇", "undetermined", "公式telemetry未確認", "勝者・決まり手から主観補完しない"),
] as const;

export const FRAGILITY_INPUTS = [
  perturbation("展示ST", "0.01秒表示候補。raw桁を保存して確定", true, true),
  perturbation("展示タイム", "0.01秒表示候補。raw桁を保存して確定", true, true),
  perturbation("風速", "表示単位・丸めをrawから保存", true, true),
  perturbation("風向", "現行pre-race列なし。画像/方位codeの品質がUNKNOWN", true, true),
  perturbation("波高", "表示単位・丸めをrawから保存", true, true),
  perturbation("進入", "離散1〜6。展示と実進入を分離", true, true),
  perturbation("選手能力snapshot", "source掲載精度と集計期間を保存", true, true),
  perturbation("モーター成績", "source掲載精度と集計期間を保存", true, true),
  perturbation("オッズ", "point/range、表示丸め、観測skewを保存", true, true),
  perturbation("締切までの時間", "秒精度のscheduled closeとobserved_atから算出", true, true),
] as const;

export const ERROR_ATLAS_CLASSES = [
  "first_place_error",
  "second_place_error",
  "third_place_error",
  "top2_set_correct_order_wrong",
  "top3_set_correct_order_wrong",
  "win_would_hit",
  "place_would_hit",
  "exacta_would_hit",
  "quinella_would_hit",
  "trio_would_hit",
  "value_at_t5_lost_at_final_like",
  "entry_change",
  "abnormal_start",
  "incident_or_fl",
  "missing_input",
  "point_in_time_ineligible",
  "market_and_model_wrong",
  "market_right_model_wrong",
] as const;

function timing(
  id: string,
  event: string,
  source: string,
  sourceTimestampAvailable: boolean,
  currentVersioning: "single_latest" | "partial_latest",
  historicalLag: "future_only",
  sourceTimingEvidence = "監査sampleの表示内容と現保存schemaに個別の壁時計公開/更新時刻なし",
) {
  return {
    id,
    event,
    source,
    sourceTimestampAvailable,
    currentVersioning,
    historicalLag,
    sourceTimingEvidence,
    decision: "CONDITIONAL" as const,
    timingQuality: "observed_time_only",
    requiredFields: [
      "source_published_at",
      "source_observed_at",
      "first_seen_at",
      "changed_at",
      "previous_raw_hash",
      "current_raw_hash",
      "change_type",
      "change_payload",
      "source_version",
      "timing_quality",
    ],
  };
}

function boundary(item: string, role: string, source: string, rule: string) {
  return { item, role, source, rule };
}

function perturbation(input: string, precisionAudit: string, lateUpdatePossible: boolean, measurementQualityRequired: boolean) {
  return {
    input,
    precisionAudit,
    lateUpdatePossible,
    measurementQualityRequired,
    requiredFields: ["measurement_quality", "value_precision", "value_min", "value_max", "source_disagreement", "late_update_possible"],
  };
}
