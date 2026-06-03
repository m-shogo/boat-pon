import type { MissReason } from "./pro-types.js";

export function inferMissReasons(input: {
  whatDiffered?: string[];
  missedSignals?: string[];
  improvedRuleIdeas?: string[];
  notes?: string;
}): MissReason[] {
  const text = [
    ...(input.whatDiffered ?? []),
    ...(input.missedSignals ?? []),
    ...(input.improvedRuleIdeas ?? []),
    input.notes ?? "",
  ].join(" ").toLowerCase();
  const reasons = new Set<MissReason>();

  if (/織り込み|priced|期待先行|材料出尽くし/.test(text)) reasons.add("already_priced_in");
  if (/本命|peer|競合|別銘柄|better/.test(text)) reasons.add("theme_right_company_wrong");
  if (/早すぎ|too_early|タイミング|押し目|高値/.test(text)) reasons.add("theme_right_timing_wrong");
  if (/利益|profit|業績|売上|接続しない|寄与/.test(text)) reasons.add("profit_not_connected");
  if (/valuation|per|pbr|バリュエーション|高すぎ/.test(text)) reasons.add("valuation_too_high");
  if (/流動性|出来高|薄い|liquidity/.test(text)) reasons.add("liquidity_bad");
  if (/決算|earnings|期待未達/.test(text)) reasons.add("earnings_miss");
  if (/ガイダンス|会社予想|下方|guidance/.test(text)) reasons.add("guidance_weak");
  if (/macro|金利|為替|地政学|市況|逆風/.test(text)) reasons.add("macro_headwind");
  if (/データ|missing|不足|未取得|品質/.test(text)) reasons.add("data_quality_bad");

  return [...reasons];
}
