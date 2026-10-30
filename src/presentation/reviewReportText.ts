/** Text-only presentation. Never mutate report rows or JSON payloads. */
export function reportCell(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(3);
  return String(value).replace(/\r?\n/g, " / ").replaceAll("|", "／");
}

export function compactTable<T>(title: string, rows: readonly T[], columns: readonly (readonly [string, (row: T) => unknown])[]): void {
  console.log(`\n${title}`);
  console.log(`| ${columns.map(([label]) => label).join(" | ")} |`);
  console.log(`| ${columns.map(() => "---").join(" | ")} |`);
  for (const row of rows.slice(0, 10)) console.log(`| ${columns.map(([, get]) => reportCell(get(row))).join(" | ")} |`);
  if (rows.length > 10) console.log(`残り ${rows.length - 10} 件（取得済み一覧内）。全件・詳細は --detail または --json。`);
  if (rows.length === 0) console.log("該当データなし。");
}

export function outcomeConclusion(rows: readonly { decision?: string; settled: number; hits: number; roi: number | null }[]): string {
  const row = rows.find((item) => item.decision === "BUY") ?? rows[0];
  return row ? `${row.decision ?? "先頭区分"} 確定 ${row.settled}件 → 的中 ${row.hits}件。実払戻ROI ${row.roi == null ? "未算出" : `${(row.roi * 100).toFixed(1)}%`}。` : "確定データがなく、判定できません。";
}
