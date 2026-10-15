/**
 * 本命予想: 締切5分前の市場で、いちばん当たりやすい買い目1点（市場補正の確率が最大の3連単）。
 * 購入の推奨ではない。v3 の BUY と並べて、当たり外れと回収率を比べるための記録（2026-10-15、ユーザーの選択）。
 * 7/1〜10/13 の 10,163 レースでは、いちばん人気の1点は 的中 9.5%・回収率 0.70（v3 の BUY は 約1.6%・0.58）。
 */
import { calibratedMarketProbabilities, type MarketCalibration } from "./accuracyScorecard";

export type FavoritePick = { raceId: string; selection: string; probability: number; t5Odds: number };

export function pickFavorite(
  raceId: string,
  t5Odds: Map<string, number>,
  earlierOdds: Map<string, number> | null,
  calibration: MarketCalibration,
): FavoritePick | null {
  const probabilities = calibratedMarketProbabilities(t5Odds, earlierOdds, calibration);
  if (!probabilities) return null;
  let best: FavoritePick | null = null;
  for (const [selection, probability] of probabilities) {
    // 同じ確率なら、オッズの低い方（市場の人気）、それでも同じなら買い目の文字列順で決める（毎回同じ結果にする）
    const odds = t5Odds.get(selection)!;
    if (!best || probability > best.probability || (probability === best.probability && (odds < best.t5Odds || (odds === best.t5Odds && selection < best.selection)))) {
      best = { raceId, selection, probability, t5Odds: odds };
    }
  }
  return best;
}
