const venueCodes: Readonly<Record<string, string>> = Object.freeze({
  桐生: "01",
  戸田: "02",
  江戸川: "03",
  平和島: "04",
  多摩川: "05",
  浜名湖: "06",
  蒲郡: "07",
  常滑: "08",
  津: "09",
  三国: "10",
  びわこ: "11",
  住之江: "12",
  尼崎: "13",
  鳴門: "14",
  丸亀: "15",
  児島: "16",
  宮島: "17",
  徳山: "18",
  下関: "19",
  若松: "20",
  芦屋: "21",
  福岡: "22",
  唐津: "23",
  大村: "24",
});

const canonicalVenueCodePattern = /^(0[1-9]|1\d|2[0-4])$/;

export function officialVenueCode(venue: string): string | null {
  const normalized = venue.trim();
  if (canonicalVenueCodePattern.test(normalized)) return normalized;
  return venueCodes[normalized] ?? null;
}

export function officialOddsUrl(date: string, venue: string, raceNo: number): string {
  const jcd = officialVenueCode(venue);
  const hd = date.replaceAll("-", "");
  if (!jcd) return "https://www.boatrace.jp/";
  return `https://www.boatrace.jp/owpc/pc/race/odds3t?rno=${raceNo}&jcd=${jcd}&hd=${hd}`;
}

export function teleBoatUrl(_date: string, _venue: string, _raceNo: number): string {
  // 公式に案内されている投票サイト入口を使う。
  // 会場・レース指定のdeep linkは公開仕様を確認できないため組み立てない。
  return "https://bu.tbbr.jp/";
}
