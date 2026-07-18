export type EventContextCategory = { id: string; label: string; test: (title: string, date: string) => boolean };

/** タイトル個別探索を避けるための、事前に固定した開催文脈カテゴリ。 */
export const EVENT_CONTEXT_CATEGORIES: EventContextCategory[] = [
  { id: "venue_anniversary", label: "競走場の開設周年らしい開催", test: title => /開設\s*\d+\s*周年/.test(title) && !/(BTS|ボートピア|オラレ|チケットショップ|外向発売所|市制|町制|創刊|放送|新聞|会社)/i.test(title) },
  { id: "satellite_anniversary", label: "BTS・場外発売所の周年", test: title => /(BTS|ボートピア|オラレ|チケットショップ|外向発売所).{0,16}(周年|開設)|(?:周年|開設).{0,16}(BTS|ボートピア|オラレ|チケットショップ|外向発売所)/i.test(title) },
  { id: "women", label: "女子・ヴィーナス・レディース", test: title => /(女子|ヴィーナス|レディース|クイーン)/.test(title) },
  { id: "rookie", label: "ルーキー・若手", test: title => /(ルーキー|若獅子|新鋭|ヤング)/.test(title) },
  { id: "masters", label: "マスターズ・名人・匠", test: title => /(マスターズ|名人|匠)/.test(title) },
  { id: "new_year_title", label: "正月・新春タイトル", test: title => /(正月|新春|迎春|初夢|ニューイヤー)/.test(title) },
  { id: "local_civic", label: "自治体・地元冠", test: title => /(市制|町制|市長杯|町長杯|県知事|地元)/.test(title) },
  { id: "new_year_calendar", label: "暦上の年始1月1〜7日", test: (_title, date) => /^\d{4}-01-0[1-7]$/.test(date) },
  { id: "golden_week", label: "ゴールデンウィーク4月29日〜5月6日", test: (_title, date) => /-04-(29|30)$/.test(date) || /-05-0[1-6]$/.test(date) },
  { id: "obon", label: "お盆8月10〜16日", test: (_title, date) => /-08-(10|11|12|13|14|15|16)$/.test(date) },
  { id: "weekend", label: "土日", test: (_title, date) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()) },
];

export function eventContextFlags(title: string, date: string) {
  return EVENT_CONTEXT_CATEGORIES.filter(category => category.test(title, date)).map(category => category.id);
}
