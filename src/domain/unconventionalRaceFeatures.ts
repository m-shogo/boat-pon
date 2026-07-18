export type UnconventionalBoat = {
  course: number;
  registrationNo?: string;
  className?: string;
  nationalWinRate?: number;
  localWinRate?: number;
  motorTop2Rate?: number;
  boatTop2Rate?: number;
};

export type UnconventionalProgram = {
  raceTitle?: string;
  category?: { primary?: string; tags?: string[] };
  boats: UnconventionalBoat[];
};

const classRank: Record<string, number> = { B2: 0, B1: 1, A2: 2, A1: 3 };

/** 出走表に当時掲載された値だけで作れる、仮説生成用の珍しい切り口。 */
export function staticUnconventionalFlags(program: UnconventionalProgram): string[] {
  const boats = [...program.boats].sort((a, b) => a.course - b.course);
  const head = boats.find(boat => boat.course === 1);
  if (!head) return [];
  const rivals = boats.filter(boat => boat.course !== 1);
  const title = program.raceTitle ?? "";
  const tags = new Set([program.category?.primary, ...(program.category?.tags ?? [])].filter(Boolean));
  const flags: string[] = [];
  const national = head.nationalWinRate;
  const local = head.localWinRate;
  if (national != null && local != null && local - national >= 1) flags.push("当地覚醒_1号艇");
  if (national != null && local != null && national - local >= 1) flags.push("当地苦手_1号艇");
  if (national != null && head.motorTop2Rate != null && national >= 6 && head.motorTop2Rate < 25) flags.push("強い選手_弱いモーター");
  if (national != null && head.motorTop2Rate != null && national < 5 && head.motorTop2Rate >= 40) flags.push("弱い選手_強いモーター");
  if ((head.motorTop2Rate ?? -1) >= 40 && (head.boatTop2Rate ?? -1) >= 40) flags.push("モーター艇ダブル良機");
  const rivalNational = rivals.map(boat => boat.nationalWinRate).filter((v): v is number => v != null);
  if (national != null && rivalNational.length === rivals.length && national - Math.max(...rivalNational) >= 1.5) flags.push("1号艇能力断層");
  const inner = boats.filter(boat => boat.course <= 3).map(boat => boat.nationalWinRate).filter((v): v is number => v != null);
  const outer = boats.filter(boat => boat.course >= 4).map(boat => boat.nationalWinRate).filter((v): v is number => v != null);
  if (inner.length === 3 && outer.length === 3 && Math.max(...outer) > Math.max(...inner)) flags.push("外枠に最強選手");
  if (head.className && rivals.every(boat => classRank[head.className!] > (classRank[boat.className ?? ""] ?? -1))) flags.push("1号艇単独上位級");
  if (/周年|開設\d+周年/.test(title)) flags.push("周年記念");
  if (/女子|ヴィーナス|レディース/.test(title)) flags.push("女子戦");
  if (/ルーキー|若獅子|新鋭/.test(title)) flags.push("若手戦");
  if (/優勝戦/.test(title)) flags.push("優勝戦");
  if (tags.has("企画")) flags.push("企画レース");
  if (tags.has("G1") || tags.has("G2") || tags.has("SG")) flags.push("高格付け開催");
  return flags;
}
