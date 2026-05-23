export type RaceCategory =
  | "SG"
  | "PG1"
  | "G1"
  | "G2"
  | "G3"
  | "一般"
  | "女子"
  | "ルーキー"
  | "匠"
  | "進入固定"
  | "優勝戦"
  | "準優勝戦"
  | "企画"
  | "不明";

export type ProgramCategory = {
  primary: RaceCategory;
  tags: RaceCategory[];
  confidence: "high" | "medium" | "low";
  sourceText: string;
};

export function categorizeProgram(sourceText: string): ProgramCategory {
  const text = normalize(sourceText);
  const tags = new Set<RaceCategory>();
  if (/(SG|スペシャルグレード|グランプリ|ボートレースクラシック|オールスター|メモリアル|ダービー|チャレンジカップ|オーシャンカップ|グランドチャンピオン)/i.test(text)) tags.add("SG");
  if (/(PG1|プレミアムG1|プレミアムGI|クイーンズクライマックス|ヤングダービー|レディースチャンピオン|マスターズチャンピオン)/i.test(text)) tags.add("PG1");
  if (/(G1|GI(?!I)|周年|地区選手権|高松宮記念|ダイヤモンドカップ)/i.test(text)) tags.add("G1");
  if (/(G2|GII(?!I)|モーターボート大賞|秩父宮妃記念杯)/i.test(text)) tags.add("G2");
  if (/(G3|GIII|オールレディース|企業杯|イースタンヤング|ウエスタンヤング)/i.test(text)) tags.add("G3");
  if (/(女子|レディース|ヴィーナス|クイーン|オールレディース)/i.test(text)) tags.add("女子");
  if (/(ルーキー|新鋭|ヤング|若手)/i.test(text)) tags.add("ルーキー");
  if (/(匠|マスターズ|名人)/i.test(text)) tags.add("匠");
  if (/(進入固定|固定)/i.test(text)) tags.add("進入固定");
  if (/(優勝戦|ファイナル)/i.test(text)) tags.add("優勝戦");
  if (/(準優|準優勝戦)/i.test(text)) tags.add("準優勝戦");
  if (/(ドリーム|特賞|特選|記者選抜|選抜|予選特賞|シーモ|カステラ|サンライズ|モーニング|ランチ|アシ夢|なるちゃん|ゴゴイチ)/i.test(text)) tags.add("企画");

  const grade = firstTag(tags, ["SG", "PG1", "G1", "G2", "G3"]);
  const primary = grade ?? firstTag(tags, ["優勝戦", "準優勝戦", "女子", "ルーキー", "匠", "進入固定", "企画"]) ?? "一般";
  return {
    primary,
    tags: tags.size ? [...tags] : [primary],
    confidence: sourceText.trim() ? (tags.size ? "medium" : "low") : "low",
    sourceText: sourceText.trim(),
  };
}

function normalize(value: string) {
  return value
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/Ｇ/g, "G")
    .replace(/Ⅰ/g, "I")
    .replace(/Ⅱ/g, "II")
    .replace(/Ⅲ/g, "III")
    .replace(/　/g, " ");
}

function firstTag(tags: Set<RaceCategory>, order: RaceCategory[]) {
  return order.find((tag) => tags.has(tag));
}
