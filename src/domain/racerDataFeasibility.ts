import type { FeasibilityDecision } from "./allBetTypeFeasibility";

export type RacerFeaturePhase = "N3" | "N4" | "M1" | "M3";

export type RacerFeatureFeasibility = {
  category: "basic" | "course" | "recent" | "interaction";
  feature: string;
  decision: FeasibilityDecision;
  canonicalSource: string;
  pointInTimeQuality: "exact_pre_race" | "prior_results_derived" | "current_only" | "partial_cache" | "unavailable";
  historicalReproduction: string;
  newAcquisition: string;
  recommendedStore: string;
  phase: RacerFeaturePhase;
  leakageRisk: string;
};

export const RACER_FEATURE_FEASIBILITY: readonly RacerFeatureFeasibility[] = [
  row("basic", "registration_no", "GO", "official_programs.raw_json / race_entries", "exact_pre_race", "2004-06-01以降は番組、2000-01-01以降は結果から再現", "不要", "raw program / race_entriesを正本", "M1", "低"),
  row("basic", "class_name", "GO", "official_programs.raw_json", "exact_pre_race", "レース当時の級別を100%保持", "不要", "racer_profile_snapshotsへ正規化可", "N3", "現在profileで上書きすると級別変更を失う"),
  row("basic", "branch", "CONDITIONAL", "保存済みkyotei24レース前HTML", "partial_cache", "2020-01-01〜2026-05-21 cache範囲は再抽出可能", "未cache期間とforwardは公式source追加が必要", "racer_profile_snapshots", "N3", "現在支部を過去へ適用しない"),
  row("basic", "registration_period", "UNKNOWN", "公式の構造化source未確認", "unavailable", "登録番号近接proxyは登録期ではない", "公式source確認が必要", "racer_profile_snapshots", "N3", "番号差から登録期を推測しない"),
  row("basic", "age_gender_weight", "CONDITIONAL", "保存済みkyotei24レース前HTML / beforeinfo", "partial_cache", "cache範囲は年齢・性別・体重を当時値で再抽出可能", "公式forward sourceと体重parserが必要", "profile snapshot＋beforeinfo boat observation", "N3", "現在年齢・現在体重で過去を上書きしない"),
  row("basic", "national_win_top2_rate", "GO", "official_programs.raw_json", "exact_pre_race", "2004-06-01以降100%", "不要", "racer_period_statsへ任意正規化", "M1", "掲載値の対象期間metadataがrawにない"),
  row("basic", "national_top3_rate", "BLOCKED", "現DB/raw JSONに無し", "unavailable", "再現不可", "公式sourceと対象期間の確認が必要", "racer_period_stats", "N3", "現在値や2連率から補間しない"),
  row("basic", "local_win_top2_rate", "GO", "official_programs.raw_json", "exact_pre_race", "2004-06-01以降100%", "不要", "venue付きracer_period_statsへ任意正規化", "M1", "当地の対象期間metadataがrawにない"),
  row("basic", "local_top3_rate", "BLOCKED", "現DB/raw JSONに無し", "unavailable", "再現不可", "公式sourceと対象期間の確認が必要", "venue付きracer_period_stats", "N3", "2連率から補間しない"),
  row("basic", "average_st", "CONDITIONAL", "racer_profiles / race_entries", "current_only", "現在値は不可。過去結果からas-of rolling値は再構築可能", "公式期別値を使うならsnapshot取得が必要", "racer_period_stats / racer_recent_form_snapshots", "N3", "fetched_atを有効時点とみなさない"),
  row("basic", "f_l_counts", "CONDITIONAL", "racer_profiles / race_entries.status_code", "current_only", "2000年以降のprior resultから累積・window別に再構築可能", "公式期別値にはsnapshotが必要", "racer_period_stats / recent form", "N4", "対象race自身と以後を集計しない"),
  row("basic", "accident_rate", "CONDITIONAL", "race_entries.status_code", "prior_results_derived", "分母・事故code・windowを固定すれば再構築可能", "不要", "racer_recent_form_snapshots", "N4", "定義変更と左打切り"),

  row("course", "starts_finish_rates_by_course", "CONDITIONAL", "race_entries", "prior_results_derived", "出走数・1/2/3着率を2000年以降のprior resultsから再構築可能", "不要", "racer_course_period_stats", "N4", "標本数なしの率、対象race混入"),
  row("course", "st_mean_std_by_course", "CONDITIONAL", "race_entries", "prior_results_derived", "平均・標準偏差・nをprior resultsから再構築可能", "不要", "racer_course_period_stats", "N4", "F/ST欠測の扱いと対象race混入"),
  row("course", "f_late_start_rates_by_course", "CONDITIONAL", "race_entries", "prior_results_derived", "code定義と分母を固定すれば再構築可能", "不要", "racer_course_period_stats", "N4", "lateの閾値後付け"),
  row("course", "winning_style_by_course", "CONDITIONAL", "race_conditions.kimarite + race_entries", "prior_results_derived", "本人が1着時の決まり手傾向は再構築可能", "不要", "racer_style_features", "N4", "勝者戦法と他艇の因果を混同"),
  row("course", "remain_top2_top3_after_losing_from_course1", "CONDITIONAL", "race_entries", "prior_results_derived", "1コース敗戦時の2/3着残り率を再構築可能", "不要", "racer_course_period_stats", "N4", "対象race混入"),
  row("course", "entry_change_performance", "CONDITIONAL", "race_entries.boat / entry_course", "prior_results_derived", "枠と実進入差から再構築可能", "不要", "racer_course_period_stats", "N4", "枠を展示/実進入と混同"),
  row("course", "venue_course_performance", "CONDITIONAL", "race_entries", "prior_results_derived", "venue×実進入×選手で再構築可能", "不要", "venue付きracer_course_period_stats", "N4", "細分化小標本"),

  row("recent", "last_30_90_results", "CONDITIONAL", "race_entries", "prior_results_derived", "registration_no順の直前30/90走を再構築可能", "不要", "racer_recent_form_snapshots", "N4", "同日後続race・対象race混入"),
  row("recent", "recent_st_mean_variance", "CONDITIONAL", "race_entries", "prior_results_derived", "window・F除外規則・nを固定すれば再構築可能", "不要", "racer_recent_form_snapshots", "N4", "全期間平均と混同"),
  row("recent", "days_since_f", "CONDITIONAL", "race_entries.status_code / st_flying", "prior_results_derived", "直前F日からrace dateまでで再構築可能", "不要", "racer_recent_form_snapshots", "N4", "履歴開始前Fを不在扱い"),
  row("recent", "event_previous_finish_st", "CONDITIONAL", "race_entries + official_programs", "prior_results_derived", "同日・同場の前raceは既存処理で再構築済み", "開催event_idの正規化が必要", "racer_recent_form_snapshots", "N4", "開催境界誤認、後続race混入"),
  row("recent", "same_day_run_number_and_interval", "CONDITIONAL", "official_programs.close_at + race_entries", "prior_results_derived", "当日それ以前のraceだけで再構築可能", "不要", "racer_recent_form_snapshots", "N4", "race_noだけで時系列を決めない"),
  row("recent", "weight_change", "CONDITIONAL", "保存済みレース前HTML / future beforeinfo", "partial_cache", "cache範囲のみ再構築可能", "公式forward sourceとparserが必要", "beforeinfo/profile observations", "N3", "静的profile体重と直前体重を混同"),
  row("recent", "exhibition_time_st_day_trend", "CONDITIONAL", "exhibition_data + official_programs", "partial_cache", "取得済race間は同日prior trendを再構築可能", "欠測補完ではなくforward蓄積が必要", "beforeinfo observations / recent form", "N3", "同race後の観測やlatest上書き"),
  row("recent", "post_parts_change_delta", "CONDITIONAL", "race_equipment + exhibition_data", "partial_cache", "取得済み同日prior race間の変化は再構築可能", "forward蓄積が必要", "beforeinfo observations / recent form", "N3", "交換後の対象race結果を事前値に混入"),

  row("interaction", "course_tactic_tendency", "CONDITIONAL", "race_conditions.kimarite + race_entries", "prior_results_derived", "勝者本人の戦法傾向として再構築可能", "不要", "racer_style_features", "N4", "攻め手の同定を推測しない"),
  row("interaction", "adjacent_boat_drop_when_attacking", "BLOCKED", "1マークの攻め手telemetry無し", "unavailable", "着順共起proxyは作れるが因果的な攻め手を特定不可", "公式lap/turn telemetry等が必要", "racer_style_features", "M3", "着順共起を妨害効果と断定"),
  row("interaction", "outer_boat_rise_with_attack", "CONDITIONAL", "race_entries + kimarite", "prior_results_derived", "勝者戦法時の外艇上位共起proxyは再構築可能", "不要", "racer_style_features", "N4", "連動・因果と呼ばない"),
  row("interaction", "course1_loss_second_place_rate", "CONDITIONAL", "race_entries", "prior_results_derived", "prior resultsから再構築可能", "不要", "racer_style_features", "N4", "対象race混入"),
  row("interaction", "past_meetings_direct_results", "CONDITIONAL", "race_entries", "prior_results_derived", "既存処理がprior-day順で再構築済み", "不要", "原則派生。materialize時のみracer_pair_history", "N4", "同日未来race混入"),
  row("interaction", "adjacent_course_matchups", "CONDITIONAL", "race_entries.entry_course", "prior_results_derived", "過去同走の実進入差から再構築可能", "不要", "racer_pair_history", "N4", "枠と実進入を混同"),
  row("interaction", "same_event_rematch", "CONDITIONAL", "official_programs + race_entries", "prior_results_derived", "同日再戦は既存処理あり。開催全体はevent_id不足", "event_id正規化が必要", "racer_pair_history", "N4", "開催境界誤認"),
  row("interaction", "same_branch", "CONDITIONAL", "保存済みレース前HTML", "partial_cache", "cache範囲は当時支部で再構築可能", "未cache期間とforward sourceが必要", "racer_profile_snapshotsから導出", "N3", "同支部を私的関係と解釈しない"),
  row("interaction", "official_mentor_apprentice", "CONDITIONAL", "docs/official-racer-relationships.json", "exact_pre_race", "公式記事2組のみ、記事公開日以後に限定", "網羅的公式registryが必要", "source registryを正本。pair tableへ複製しない", "N3", "非網羅・公開日前利用"),
] as const;

export function isRacerSnapshotEligibleForRace(input: {
  raceDate: string;
  targetFeatureCutoffAt: string;
  asOfDate: string;
  observedAt: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}): boolean {
  const observedDate = input.observedAt.slice(0, 10);
  if (!isDate(input.raceDate) || !isDate(input.asOfDate) || !isDate(observedDate)) return false;
  if (input.effectiveFrom && !isDate(input.effectiveFrom)) return false;
  if (input.effectiveTo && !isDate(input.effectiveTo)) return false;
  const cutoffTimestamp = Date.parse(input.targetFeatureCutoffAt);
  const observedTimestamp = Date.parse(input.observedAt);
  if (!Number.isFinite(cutoffTimestamp) || !Number.isFinite(observedTimestamp)) return false;
  if (input.targetFeatureCutoffAt.slice(0, 10) !== input.raceDate) return false;
  if (input.asOfDate > input.raceDate || observedDate > input.raceDate) return false;
  if (observedTimestamp > cutoffTimestamp) return false;
  if (input.effectiveFrom && input.effectiveFrom > input.raceDate) return false;
  if (input.effectiveTo && input.effectiveTo < input.raceDate) return false;
  return true;
}

function row(
  category: RacerFeatureFeasibility["category"],
  feature: string,
  decision: FeasibilityDecision,
  canonicalSource: string,
  pointInTimeQuality: RacerFeatureFeasibility["pointInTimeQuality"],
  historicalReproduction: string,
  newAcquisition: string,
  recommendedStore: string,
  phase: RacerFeaturePhase,
  leakageRisk: string,
): RacerFeatureFeasibility {
  return { category, feature, decision, canonicalSource, pointInTimeQuality, historicalReproduction, newAcquisition, recommendedStore, phase, leakageRisk };
}

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}
