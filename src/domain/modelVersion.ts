export const MODEL_VERSION = "boatpon-v3-alpha15";

export type ModelVersionInfo = {
  version: string;
  description: string;
  features: string[];
};

export function getModelVersionInfo(): ModelVersionInfo {
  return {
    version: MODEL_VERSION,
    description: "プロペラ制度レジーム、番組カテゴリ、強めのLaplace平滑化を前提にした期待値モデル",
    features: [
      "2012-05-01以降の貸出ペラ時代を現代学習の主対象にする",
      "2012年4月の新プロペラ移行期を現代モデルから外す",
      "番組カテゴリを履歴に保存し、後続分析で母集団を分ける",
      "オッズ履歴がない場合はBUYではなく必要オッズ提示に寄せる",
      "3連単120通りのLaplace平滑化をalpha=15に強め、少数ヒットの過大推定を抑える",
    ],
  };
}
