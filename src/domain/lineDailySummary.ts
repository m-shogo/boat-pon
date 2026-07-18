export type NoBuyReasonSummary = {
  reason: string;
  count: number;
};

function normalizeNoBuyReason(reason: string): string {
  if (reason.startsWith("シャープマネー逆行")) return "シャープマネー逆行";
  if (reason.startsWith("1着候補級別が対象外")) return "1着候補級別が対象外";
  if (reason.startsWith("1着候補全国勝率が下限未満")) return "1着候補全国勝率が下限未満";
  if (reason.startsWith("1着候補モーター2連率が")) return "1着候補モーター条件未達";
  if (reason.startsWith("除外会場")) return "除外会場";
  if (reason.startsWith("除外レース番号")) return "除外レース番号";
  if (reason.includes("はS帯のみBUY候補")) return "会場別S帯条件未達";
  return reason;
}

export function summarizeNoBuyReasons(values: Array<string | null>, limit = 5): NoBuyReasonSummary[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    const reasons = new Set(parsed.map(String).map(normalizeNoBuyReason).filter(Boolean));
    for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason, "ja"))
    .slice(0, Math.max(0, limit));
}

export function formatNoBuyReasonSummary(summary: NoBuyReasonSummary[]): string {
  if (summary.length === 0) return "見送り理由: 記録なし";
  return [
    "見送り理由TOP5（1レース複数理由あり）:",
    ...summary.map((row) => `・${row.reason}: ${row.count}件`),
  ].join("\n");
}
