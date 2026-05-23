import type { RaceResult } from "./types";

export type PropellerRegime = "mochipera" | "propeller-transition" | "owner-propeller";

export type RaceRegime = {
  propeller: PropellerRegime;
  isModernComparable: boolean;
  notes: string[];
};

export const PROPELLER_TRANSITION_START = "2012-04-01";
export const OWNER_PROPELLER_STABLE_START = "2012-05-01";

export function getRaceRegime(date: string): RaceRegime {
  if (date < PROPELLER_TRANSITION_START) {
    return {
      propeller: "mochipera",
      isModernComparable: false,
      notes: [
        "選手持ちプロペラ制の時代。公開データに出にくいペラ技術・人脈差が結果へ入りやすい。",
      ],
    };
  }
  if (date < OWNER_PROPELLER_STABLE_START) {
    return {
      propeller: "propeller-transition",
      isModernComparable: false,
      notes: [
        "新プロペラ制度への移行月。浜名湖は4月12日先行、他場は4月27日以降初日の開催から順次適用。",
      ],
    };
  }
  return {
    propeller: "owner-propeller",
    isModernComparable: true,
    notes: [
      "場所有のプロペラをモーターとセットで貸し出す現代寄りの制度。",
    ],
  };
}

export function filterComparableResultsForDate(results: RaceResult[], targetDate: string): RaceResult[] {
  const target = getRaceRegime(targetDate);
  if (target.propeller === "owner-propeller") {
    return results.filter((row) => getRaceRegime(row.date).propeller === "owner-propeller");
  }
  if (target.propeller === "mochipera") {
    return results.filter((row) => row.date < targetDate && getRaceRegime(row.date).propeller === "mochipera");
  }
  return results.filter((row) => row.date < targetDate && getRaceRegime(row.date).propeller !== "owner-propeller");
}

export function raceRegimeLabel(date: string): string {
  const regime = getRaceRegime(date);
  if (regime.propeller === "mochipera") return "持ちペラ時代";
  if (regime.propeller === "propeller-transition") return "新ペラ移行期";
  return "貸出ペラ時代";
}
