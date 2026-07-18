/**
 * exacta historical closing oddsで「局所的に市場と実着がズレる理由」を分解するread-only研究。
 * 発見期=2024、forward=2025。T-5ではないため仮説生成専用で、BUY条件へ接続しない。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { UnconventionalBoat, UnconventionalProgram } from "../src/domain/unconventionalRaceFeatures";

type RawRace = {
  race_id: string; date: string; venue: string; race_no: number; overround: number;
  odds12: number; odds13: number; odds14: number; winner: string | null; payout_yen: number | null;
  wind_speed_mps: number | null; wind_dir: string | null; wave_height_cm: number | null; stable_plate: number | null; raw_json: string;
};
type Observation = RawRace & { period: "discovery" | "forward"; combo: string; odds: number; implied: number; hit: boolean; program: UnconventionalProgram };
type Metric = { n: number; hits: number; actualRate: number; impliedRate: number; edgePp: number; roi: number; max1HitExclRoi: number; max2HitExclRoi: number; zScore: number };
type Flag = { id: string; label: string; applies: (row: Observation) => boolean };

const db = new DatabaseSync(process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite", { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");

try {
  const raw = db.prepare(`
    SELECT h.race_id, h.race_date AS date, h.venue, h.race_no,
      SUM(1.0 / h.odds) AS overround,
      MAX(CASE WHEN h.combination='1-2' THEN h.odds END) AS odds12,
      MAX(CASE WHEN h.combination='1-3' THEN h.odds END) AS odds13,
      MAX(CASE WHEN h.combination='1-4' THEN h.odds END) AS odds14,
      p.combination AS winner, p.payout_yen,
      w.wind_speed_mps, c.wind_dir, w.wave_height_cm, w.stable_plate, op.raw_json
    FROM historical_alternative_odds h
    JOIN official_programs op ON op.race_id=h.race_id
    LEFT JOIN race_payouts p ON p.race_id=h.race_id AND p.bet_type='exacta'
    LEFT JOIN race_weather w ON w.race_id=h.race_id
    LEFT JOIN race_conditions c ON c.race_id=h.race_id
    WHERE h.bet_type='exacta'
      AND h.race_date >= '2024-01-01' AND h.race_date <= '2025-12-31'
      AND json_type(op.raw_json, '$.boats')='array'
      AND NOT EXISTS (SELECT 1 FROM race_entries re WHERE re.race_id=h.race_id AND re.status_code='F')
    GROUP BY h.race_id
    HAVING COUNT(*)=30 AND odds12 IS NOT NULL AND odds13 IS NOT NULL AND odds14 IS NOT NULL
    ORDER BY h.race_date, h.race_id
  `).all() as RawRace[];
  const exhibition = new Map<string, Map<number, number>>();
  for (const row of db.prepare(`SELECT race_id, course, exhibition_time FROM exhibition_data WHERE exhibition_time IS NOT NULL`).all() as Array<{ race_id: string; course: number; exhibition_time: number }>) {
    const courses = exhibition.get(row.race_id) ?? new Map<number, number>();
    courses.set(row.course, row.exhibition_time); exhibition.set(row.race_id, courses);
  }

  const observations: Observation[] = [];
  for (const race of raw) {
    const program = JSON.parse(race.raw_json) as UnconventionalProgram;
    const period = race.date <= "2024-12-31" ? "discovery" : "forward";
    for (const [combo, odds] of [["1-2", race.odds12], ["1-3", race.odds13], ["1-4", race.odds14]] as const) {
      observations.push({ ...race, period, combo, odds, implied: (1 / odds) / race.overround, hit: race.winner === combo, program });
    }
  }

  const anomalies = [
    { id: "marugame_12", label: "丸亀 × 1-2", combo: "1-2", filter: (r: Observation) => r.venue === "丸亀" },
    { id: "omura_12", label: "大村 × 1-2", combo: "1-2", filter: (r: Observation) => r.venue === "大村" },
    { id: "tokoname_12", label: "常滑 × 1-2", combo: "1-2", filter: (r: Observation) => r.venue === "常滑" },
    { id: "wind23_14", label: "風速2〜3m × 1-4", combo: "1-4", filter: (r: Observation) => r.wind_speed_mps != null && r.wind_speed_mps >= 2 && r.wind_speed_mps < 4 },
    { id: "wind23_sw_14", label: "風速2〜3m・南西風 × 1-4", combo: "1-4", filter: (r: Observation) => r.wind_speed_mps != null && r.wind_speed_mps >= 2 && r.wind_speed_mps < 4 && r.wind_dir === "南西" },
  ];
  const flags: Flag[] = [
    { id: "head_gap15", label: "1号艇が他艇より勝率1.5以上上", applies: r => gapFromRivals(r.program, 1) >= 1.5 },
    { id: "head_national6", label: "1号艇全国勝率6以上", applies: r => value(r.program, 1, "nationalWinRate") >= 6 },
    { id: "head_local_up", label: "1号艇当地勝率が全国より0.5以上高い", applies: r => localGap(r.program, 1) >= 0.5 },
    { id: "head_local_down", label: "1号艇当地勝率が全国より0.5以上低い", applies: r => localGap(r.program, 1) <= -0.5 },
    { id: "target_national55", label: "相手艇全国勝率5.5以上", applies: r => value(r.program, targetCourse(r.combo), "nationalWinRate") >= 5.5 },
    { id: "target_local_up", label: "相手艇当地勝率が全国より0.5以上高い", applies: r => localGap(r.program, targetCourse(r.combo)) >= 0.5 },
    { id: "target_motor40", label: "相手艇モーター2連率40%以上", applies: r => value(r.program, targetCourse(r.combo), "motorTop2Rate") >= 40 },
    { id: "target_boat40", label: "相手艇ボート2連率40%以上", applies: r => value(r.program, targetCourse(r.combo), "boatTop2Rate") >= 40 },
    { id: "target_top_rival", label: "相手艇が1号艇以外で全国勝率最上位", applies: r => isTopRival(r.program, targetCourse(r.combo)) },
    { id: "target_exh_top2", label: "相手艇が展示タイム上位2艇", applies: r => exhibitionRank(exhibition.get(r.race_id), targetCourse(r.combo)) <= 2 },
    { id: "head_exh_top2", label: "1号艇が展示タイム上位2艇", applies: r => exhibitionRank(exhibition.get(r.race_id), 1) <= 2 },
    { id: "target_over_inner", label: "相手艇が内側隣接艇より全国勝率1以上上", applies: r => targetOverInner(r.program, targetCourse(r.combo)) >= 1 },
    { id: "early_race", label: "1〜4R", applies: r => r.race_no <= 4 },
    { id: "late_race", label: "9〜12R", applies: r => r.race_no >= 9 },
    { id: "wave5plus", label: "波高5cm以上", applies: r => (r.wave_height_cm ?? -1) >= 5 },
    { id: "stable_plate", label: "安定板あり", applies: r => r.stable_plate === 1 },
    { id: "target_local_motor", label: "相手艇が当地上振れかつ良モーター", applies: r => localGap(r.program, targetCourse(r.combo)) >= 0.5 && value(r.program, targetCourse(r.combo), "motorTop2Rate") >= 40 },
    { id: "target_exh_early", label: "相手艇展示上位2艇かつ1〜4R", applies: r => exhibitionRank(exhibition.get(r.race_id), targetCourse(r.combo)) <= 2 && r.race_no <= 4 },
    ...["冬(12-2)", "春(3-5)", "夏(6-8)", "秋(9-11)"].map(season => ({
      id: `season_${season}`, label: season, applies: (r: Observation) => seasonOf(r.date) === season,
    })),
    ...[...new Set(raw.map(r => r.venue))].sort().map(venue => ({
      id: `venue_${venue}`, label: `会場${venue}`, applies: (r: Observation) => r.venue === venue,
    })),
    ...["北", "北東", "東", "南東", "南", "南西", "西", "北西", "無風"].map(direction => ({
      id: `wind_dir_${direction}`, label: `風向${direction}`, applies: (r: Observation) => r.wind_dir === direction,
    })),
  ];

  const results = anomalies.map(anomaly => {
    const candidates = observations.filter(row => row.combo === anomaly.combo && anomaly.filter(row));
    const base = byPeriod(candidates);
    const mechanisms = flags.map(flag => {
      const subset = candidates.filter(flag.applies);
      const control = candidates.filter(row => !flag.applies(row));
      const candidateMetrics = byPeriod(subset); const controlMetrics = byPeriod(control);
      return {
        id: flag.id, label: flag.label, candidate: candidateMetrics, control: controlMetrics, robustness: robustnessByPeriod(subset),
        persistent: candidateMetrics.discovery.n >= 20 && candidateMetrics.forward.n >= 20 && candidateMetrics.discovery.edgePp > 0 && candidateMetrics.forward.edgePp > 0,
        explainsBoth: candidateMetrics.discovery.n >= 20 && candidateMetrics.forward.n >= 20
          && controlMetrics.discovery.n >= 20 && controlMetrics.forward.n >= 20
          && candidateMetrics.discovery.edgePp > controlMetrics.discovery.edgePp
          && candidateMetrics.forward.edgePp > controlMetrics.forward.edgePp,
        forwardAmplifier: candidateMetrics.forward.n >= 30 && controlMetrics.forward.n >= 30
          && candidateMetrics.forward.edgePp >= controlMetrics.forward.edgePp + 1
          && candidateMetrics.forward.edgePp > base.forward.edgePp,
      };
    }).sort((a, b) => Math.min(b.candidate.discovery.edgePp, b.candidate.forward.edgePp) - Math.min(a.candidate.discovery.edgePp, a.candidate.forward.edgePp));
    return { ...anomaly, base, mechanisms };
  });
  const oneFour = observations.filter(row => row.combo === "1-4");
  const wind23 = (row: Observation) => row.wind_speed_mps != null && row.wind_speed_mps >= 2 && row.wind_speed_mps < 4;
  const southwest = (row: Observation) => row.wind_dir === "南西";
  const topRival4 = (row: Observation) => isTopRival(row.program, 4);
  const interactionCells = [
    { id: "all_three", label: "風2〜3m・南西風・4号艇最強ライバル", filter: (row: Observation) => wind23(row) && southwest(row) && topRival4(row) },
    { id: "environment_only", label: "風2〜3m・南西風・4号艇最強ではない", filter: (row: Observation) => wind23(row) && southwest(row) && !topRival4(row) },
    { id: "ability_other_wind", label: "4号艇最強ライバル・風2〜3mだが南西以外", filter: (row: Observation) => wind23(row) && !southwest(row) && topRival4(row) },
    { id: "ability_all_weather", label: "4号艇最強ライバル・全天候", filter: (row: Observation) => topRival4(row) },
    { id: "environment_all_ability", label: "風2〜3m・南西風・能力不問", filter: (row: Observation) => wind23(row) && southwest(row) },
  ].map(cell => ({ ...cell, metrics: byPeriod(oneFour.filter(cell.filter)) }));
  const gridDirections = ["北", "北東", "東", "南東", "南", "南西", "西", "北西", "無風"];
  const gridBands = ["0-1m", "1-2m", "2-3m", "4-5m", "6m+"];
  const gridCells = gridBands.flatMap(band => gridDirections.flatMap(direction => [true, false].map(top => {
    const filter = (row: Observation) => windBand(row.wind_speed_mps) === band && row.wind_dir === direction && topRival4(row) === top;
    return { id: `${band}|${direction}|${top ? "top" : "not_top"}`, band, direction, topRival4: top,
      discovery: metric(oneFour.filter(row => row.period === "discovery" && filter(row))),
      forward: metric(oneFour.filter(row => row.period === "forward" && filter(row))), filter };
  })));
  const eligibleGrid = gridCells.filter(cell => cell.discovery.n >= 30).sort((a, b) => b.discovery.zScore - a.discovery.zScore);
  const discoveryRobustGate = eligibleGrid.filter(cell => cell.discovery.zScore >= 1.5 && cell.discovery.max2HitExclRoi >= 1);
  const targetGridId = "2-3m|南西|top";
  const targetGridRank = eligibleGrid.findIndex(cell => cell.id === targetGridId) + 1;
  const gridSimulation = simulateGridMultiplicity(oneFour.filter(row => row.period === "discovery"), eligibleGrid, targetGridId, 1000);
  const monthlyTarget = [...new Set(oneFour.map(row => row.date.slice(0, 7)))].sort().map(month => ({
    month, ...metric(oneFour.filter(row => row.date.startsWith(month) && wind23(row) && southwest(row) && topRival4(row))),
  })).filter(row => row.n > 0);
  const matchSpecs = [
    { id: "venue_season", label: "会場・季節", key: (row: Observation) => `${row.venue}|${seasonOf(row.date)}` },
    { id: "plus_race_head", label: "会場・季節・R帯・1号艇能力帯", key: (row: Observation) => `${row.venue}|${seasonOf(row.date)}|${raceBand(row.race_no)}|${rateBand(value(row.program, 1, "nationalWinRate"))}` },
    { id: "plus_target", label: "会場・季節・R帯・1/4号艇能力帯", key: (row: Observation) => `${row.venue}|${seasonOf(row.date)}|${raceBand(row.race_no)}|${rateBand(value(row.program, 1, "nationalWinRate"))}|${rateBand(value(row.program, 4, "nationalWinRate"))}` },
  ];
  const treatment = (row: Observation) => wind23(row) && southwest(row) && topRival4(row);
  const matchedContrasts = [
    { id: "environment", label: "風環境の寄与（4号艇最強は共通）", control: (row: Observation) => topRival4(row) && !(wind23(row) && southwest(row)) },
    { id: "ability", label: "4号艇相対能力の寄与（風環境は共通）", control: (row: Observation) => wind23(row) && southwest(row) && !topRival4(row) },
    { id: "combined", label: "組合せ全体（どちらも満たさない対照）", control: (row: Observation) => !(wind23(row) && southwest(row)) && !topRival4(row) },
  ].flatMap(contrast => matchSpecs.map(spec => ({
    id: `${contrast.id}_${spec.id}`, label: contrast.label, adjustment: spec.label,
    discovery: matchedResidual(oneFour.filter(row => row.period === "discovery"), treatment, contrast.control, spec.key),
    forward: matchedResidual(oneFour.filter(row => row.period === "forward"), treatment, contrast.control, spec.key),
  })));

  const report = {
    generatedAt: new Date().toISOString(),
    safety: { readOnly: true, historicalClosingOdds: true, t5: false, profitClaim: false, productionConnected: false },
    scope: { races: raw.length, discovery: raw.filter(r => r.date <= "2024-12-31").length, forward: raw.filter(r => r.date >= "2025-01-01").length },
    caveats: ["多重探索を含むため仮説生成専用", "historical closing oddsでありT-5再現ではない", "原因ではなく構成差・交絡候補"],
    interactionCells: interactionCells.map(({ filter: _filter, ...cell }) => cell), matchedContrasts,
    discoveryGridAudit: {
      family: "1-4 × 風速5帯 × 風向9種 × 4号艇最強/非最強。2024 n>=30",
      eligibleCells: eligibleGrid.length, targetGridId, targetGridRank, simulations: 1000, ...gridSimulation,
      retrospectiveRobustGate: { definition: "2024 n>=30, z>=1.5, max2HitExclRoi>=100%", selected: discoveryRobustGate.map(({ filter: _filter, ...cell }) => cell) },
      topDiscovery: eligibleGrid.slice(0, 10).map(({ filter: _filter, ...cell }) => cell), monthlyTarget,
    },
    anomalies: results.map(({ filter: _filter, ...result }) => ({
      ...result,
      mechanisms: result.mechanisms.filter(row => row.explainsBoth || row.forwardAmplifier),
    })),
  };
  mkdirSync("reports", { recursive: true });
  writeFileSync("reports/local-market-anomaly-deep-dive.json", `${JSON.stringify(report, null, 2)}\n`);
  const strongest = results.find(result => result.id === "wind23_sw_14")?.mechanisms.find(row => row.id === "target_top_rival");
  const lines = [
    "# 局所市場異常の理由分解", "",
    "> 2024発見→2025 forward。exacta historical closing oddsによる仮説生成で、T-5の利益edge確認ではない。", "",
    `対象: ${report.scope.races}レース（2024=${report.scope.discovery} / 2025=${report.scope.forward}）`, "",
    "## 異常の再現状況", "", "| 異常 | 2024 n / edge / z / ROI / max2除外 | 2025 n / edge / z / ROI / max2除外 | 読み |", "|---|---:|---:|---|",
    ...results.map(result => `| ${result.label} | ${metricCell(result.base.discovery)} | ${metricCell(result.base.forward)} | ${interpretBase(result.base)} |`),
    "", "## 『ここだけおかしい』の構成候補", "",
    ...results.flatMap(result => {
      const top = result.mechanisms.filter(row => row.explainsBoth || row.forwardAmplifier).slice(0, 6);
      return [
        `### ${result.label}`, "",
        top.length ? "| 条件 | 2024 n / edge / z / ROI / max2除外 | 2025 n / edge / z / ROI / max2除外 | 条件外との差 | 判定 |" : "再現する構成候補なし。現状は会場・風そのものか未観測要因。",
        ...(top.length ? ["|---|---:|---:|---:|---|", ...top.map(row => `| ${row.label} | ${shortCell(row.candidate.discovery)} | ${shortCell(row.candidate.forward)} | ${edgeDelta(row)} | ${row.explainsBoth ? "両期で説明候補" : "2025増幅のみ"} |`)] : []),
        "",
      ];
    }),
    "## 現時点の理由仮説", "",
    "- **丸亀1-2**: 2号艇が展示上位2艇のときだけ条件外より両期のedgeが高い。内2艇の当日気配が揃う局面を市場が少し割り引いている可能性。丸亀は潮位と風向で決まり手が変わる公式説明があり、DBに潮位がないため未観測交絡も残る。",
    "- **大村1-2**: 2号艇展示上位、序盤R、1号艇の当地成績低下で強い。公式にもインが強くダッシュ勢が攻めづらいとあり、1着を1号艇に固定した後の2着争いで、2号艇の当日気配が十分に価格へ反映されない構造が候補。",
    "- **常滑1-2**: 2号艇が3号艇より全国勝率1以上高い条件と序盤Rが両期で残る。公式のイン優位・短期決戦ではモーター性能が着順に反映するという特徴と整合するが、機力単独は再現しないため『内側2艇の相対能力差』が主候補。",
    "- **風2〜3mの1-4**: 4号艇の当地上振れ、良モーター、序盤Rで2025に増幅。ただし2024は条件全体ROI78.3%で、安定edgeではなくレジーム変化。過去結果の風向も分解したが、live締切前経路では風向未保存なのでproduction特徴にはまだできない。",
    "- **風2〜3m・南西風の1-4**: 全体で最も強い局所異常。会場・季節・4号艇の当地/機力で再分解し、南西風自体なのか特定開催の代理なのかを確認する。これは今回のpost-hoc発見であり、同じ2025内の細分化は独立検証ではない。",
    "", "## 最有力局所仮説の崩し確認", "",
    "条件: 風速2〜3m・南西風・4号艇が1号艇以外で全国勝率最上位 → exacta 1-4", "",
    "| 期間 | n / hit / edge / z / ROI / max2除外 | 1会場ずつ除外した最悪max2 | 1か月ずつ除外した最悪max2 |", "|---|---:|---:|---:|",
    ...(strongest ? (["discovery", "forward"] as const).map(period => {
      const m = strongest.candidate[period]; const robust = strongest.robustness[period];
      return `| ${period} | ${m.n} / ${m.hits} / ${m.edgePp >= 0 ? "+" : ""}${m.edgePp.toFixed(2)}pt / ${m.zScore.toFixed(2)} / ${pct(m.roi)} / ${pct(m.max2HitExclRoi)} | ${pct(robust.minLeaveOneVenueMax2Roi)}（${robust.worstVenue}除外） | ${pct(robust.minLeaveOneMonthMax2Roi)}（${robust.worstMonth}除外） |`;
    }) : ["| - | - | - | - |"]),
    "", "このleave-one-group-outが100%を割る場合、特定会場・月への依存が残る。100%超でもpost-hoc選択とT-5非同等性は解消しない。",
    "", "## 多因子の組合せ比較", "",
    "| 条件セル | 2024 n / edge / z / ROI / max2除外 | 2025 n / edge / z / ROI / max2除外 |", "|---|---:|---:|",
    ...interactionCells.map(cell => `| ${cell.label} | ${shortCell(cell.metrics.discovery)} | ${shortCell(cell.metrics.forward)} |`),
    "", "## 2024限定の探索多重度監査", "",
    `探索族: 1-4 × 風速5帯 × 風向9種 × 4号艇最強/非最強。2024 n≥30は${eligibleGrid.length}セル。`, "",
    `対象セル（2-3m・南西・4号艇最強）の2024順位: ${targetGridRank > 0 ? `${targetGridRank}/${eligibleGrid.length}` : "n不足"}`, "",
    `市場確率を真とした1000回simulation: raw p≈${gridSimulation.rawP.toFixed(3)} / family-wise p≈${gridSimulation.familyWiseP.toFixed(3)}`, "",
    `後付け頑健性ゲート（2024 n≥30・z≥1.5・max2除外ROI≥100%）の通過数: ${discoveryRobustGate.length}セル`, "",
    ...(discoveryRobustGate.length ? ["| ゲート通過条件 | 2024 n / edge / z / ROI / max2 | 固定条件の2025 n / edge / z / ROI / max2 |", "|---|---:|---:|", ...discoveryRobustGate.map(cell => `| ${cell.band}・${cell.direction}・4号艇${cell.topRival4 ? "最強" : "非最強"} | ${shortCell(cell.discovery)} | ${shortCell(cell.forward)} |`), ""] : []),
    "| 2024順位 | 条件 | 2024 n / edge / z / ROI / max2 | 同条件2025 n / edge / z / ROI / max2 |", "|---:|---|---:|---:|",
    ...eligibleGrid.slice(0, 10).map((cell, index) => `| ${index + 1} | ${cell.band}・${cell.direction}・4号艇${cell.topRival4 ? "最強" : "非最強"} | ${shortCell(cell.discovery)} | ${shortCell(cell.forward)} |`),
    "", "### 対象セルの月別", "", "| 月 | n | hit | edge | ROI |", "|---|---:|---:|---:|---:|",
    ...monthlyTarget.map(row => `| ${row.month} | ${row.n} | ${row.hits} | ${row.edgePp >= 0 ? "+" : ""}${row.edgePp.toFixed(2)}pt | ${pct(row.roi)} |`),
    "", "## 交絡を揃えた市場残差比較", "",
    "> treatmentは「風2〜3m・南西風・4号艇最強ライバル」。edge差は actual - normalized implied の差で、プラスほど条件群側に市場未説明分が残る。", "",
    "| 比較目的 | 調整 | 2024 matched / coverage / edge差 | 2025 matched / coverage / edge差 |", "|---|---|---:|---:|",
    ...matchedContrasts.map(row => `| ${row.label} | ${row.adjustment} | ${matchedCell(row.discovery)} | ${matchedCell(row.forward)} |`),
    "", "## 多面的な理由判断", "",
    "1. **物理環境**: 会場・季節を揃えても南西風環境の市場残差差が両期でプラス。現時点では最も一貫した説明軸。ただし方位が各会場で向かい風か追い風かは別途変換が必要。",
    "2. **選手構成との相互作用**: 4号艇最強ライバル単独・全天候は両期ROI100%未満で、風2〜3mでも南西風以外は2025 edgeがマイナス。選手能力単独ではなく環境との組合せ。",
    "3. **交絡調整の限界**: 4号艇能力の寄与は会場・季節だけならプラスだが、R帯と能力帯まで揃えると差が消え、matched coverageも低い。独立した能力効果とは断定できない。",
    "4. **市場価格**: edgeは正規化市場確率控除後なので、単なる的中率上昇だけではない。一方historical closing oddsとfuture T-5は同じ価格時点ではない。",
    "5. **配当集中と開催依存**: 最大2的中除外では候補セルが両期100%超でも、2024のleave-one-venue/monthは100%割れ。特定開催の寄与が残る。",
    "6. **時間レジーム**: 南西風・能力不問セルは2024のmax2除外90.6%から2025は126.6%へ変化。2025固有の気象・選手編成・市場挙動の可能性がある。",
    "7. **実運用可能性**: 過去風向は結果取得系にしかなく、締切前liveで同じ特徴を作れない。予測力があっても現状は実行可能なedgeではない。",
    "8. **探索多重度**: 対象セルの2024 raw pは小さめでも、32セル中の最大値探索を考慮したfamily-wise pは高い。偶然候補を拾った可能性を排除できない。後付け頑健性ゲートでは唯一残り2025も再現したが、ゲート自体を次期間で前向き検証する必要がある。",
    "", "結論は単一原因ではなく、**南西風環境を主軸に、4号艇相対能力が相互作用し、会場・季節・開催単位の交絡と価格時点差が残る**というもの。因果確定やBUY採用ではなく、必要データと反証条件を持つ監視仮説とする。",
    "", "## 公式情報との突合", "",
    "- 丸亀: https://www.boatrace.jp/owsp/sp/site/place/stadium/br15/index.html — 干満と風向でまくり・差しが変わる。",
    "- 大村: https://www.boatrace.jp/owpc/pc/site/place/stadium/br24/ — インが強く、風向変化でダッシュ勢が攻めづらい。",
    "- 常滑: https://www.boatrace.jp/owpc/pc/site/place/stadium/br08/index.html — イン優位、短期決戦ではモーター性能が着順に反映。",
    "- 風一般: https://www.boatrace.jp/owsp/sp/extra/enjoy/guide/level2/l2_01_05_01.html — 追い風はイン・差し、向かい風はまくりに影響。",
    "## 判断", "",
    "- edgeは市場正規化確率との差。プラスでも控除後ROIが100%未満なら価格優位とはまだ言えない。",
    "- 2024と2025で同方向でも標本が小さいため、採用ではなく監視仮説。市場期待との差の近似z値と最大2的中除外ROIも併記した。",
    "- 過去の風向はrace_conditionsにあるが結果取得経路由来。live締切前のrace_weatherには風向がなく、point-in-time同等性がない。",
    "- 丸亀の潮位、開催日程・企画番組、モーター交換時期も未分解で、会場差を因果とは扱わない。",
    "- 次の判定はfuture-only T-5全市場で行い、同じ条件を結果確認前に固定する。",
  ];
  writeFileSync("reports/local-market-anomaly-deep-dive.md", `${lines.join("\n")}\n`);
  console.log(`races=${report.scope.races} discovery=${report.scope.discovery} forward=${report.scope.forward}`);
  for (const result of results) console.log(`${result.label}: 2024 edge=${result.base.discovery.edgePp.toFixed(2)} ROI=${pct(result.base.discovery.roi)} / 2025 edge=${result.base.forward.edgePp.toFixed(2)} ROI=${pct(result.base.forward.roi)}`);
} finally { db.close(); }

function byPeriod(rows: Observation[]) { return { discovery: metric(rows.filter(r => r.period === "discovery")), forward: metric(rows.filter(r => r.period === "forward")) }; }
function robustnessByPeriod(rows: Observation[]) { return { discovery: leaveOneOut(rows.filter(r => r.period === "discovery")), forward: leaveOneOut(rows.filter(r => r.period === "forward")) }; }
function matchedResidual(rows: Observation[], treatment: (row: Observation) => boolean, control: (row: Observation) => boolean, key: (row: Observation) => string) {
  const treated = rows.filter(treatment); const controls = new Map<string, Observation[]>();
  for (const row of rows.filter(control)) controls.set(key(row), [...(controls.get(key(row)) ?? []), row]);
  let matched = 0; let treatedResidual = 0; let controlResidual = 0;
  for (const row of treated) {
    const peers = controls.get(key(row)); if (!peers?.length) continue;
    matched += 1; treatedResidual += residual(row); controlResidual += peers.reduce((sum, peer) => sum + residual(peer), 0) / peers.length;
  }
  return { treated: treated.length, matched, coverage: treated.length ? matched / treated.length : 0,
    treatedResidualPp: matched ? treatedResidual / matched * 100 : 0,
    controlResidualPp: matched ? controlResidual / matched * 100 : 0,
    deltaPp: matched ? (treatedResidual - controlResidual) / matched * 100 : 0 };
}
function simulateGridMultiplicity(rows: Observation[], cells: Array<{ id: string; discovery: Metric; filter: (row: Observation) => boolean }>, targetId: string, iterations: number) {
  const random = mulberry32(20260718); const memberships = cells.map(cell => rows.map((row, index) => cell.filter(row) ? index : -1).filter(index => index >= 0));
  const targetIndex = cells.findIndex(cell => cell.id === targetId); const observedTargetZ = targetIndex >= 0 ? cells[targetIndex].discovery.zScore : 0;
  let rawExceed = 0; let familyExceed = 0;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const hits = rows.map(row => random() < row.implied ? 1 : 0); let targetZ = 0; let maxZ = Number.NEGATIVE_INFINITY;
    memberships.forEach((indices, index) => {
      const expected = indices.reduce((sum, i) => sum + rows[i].implied, 0); const variance = indices.reduce((sum, i) => sum + rows[i].implied * (1 - rows[i].implied), 0);
      const z = variance > 0 ? (indices.reduce((sum, i) => sum + hits[i], 0) - expected) / Math.sqrt(variance) : 0;
      if (index === targetIndex) targetZ = z; if (z > maxZ) maxZ = z;
    });
    if (targetZ >= observedTargetZ) rawExceed += 1; if (maxZ >= observedTargetZ) familyExceed += 1;
  }
  return { observedTargetZ, rawP: (rawExceed + 1) / (iterations + 1), familyWiseP: (familyExceed + 1) / (iterations + 1) };
}
function mulberry32(seed: number) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function residual(row: Observation) { return (row.hit ? 1 : 0) - row.implied; }
function leaveOneOut(rows: Observation[]) {
  const worstAfterDropping = (groups: string[], key: (row: Observation) => string) => groups.map(group => ({ group, value: metric(rows.filter(row => key(row) !== group)).max2HitExclRoi })).sort((a, b) => a.value - b.value)[0] ?? { group: "-", value: 0 };
  const venue = worstAfterDropping([...new Set(rows.map(row => row.venue))], row => row.venue);
  const month = worstAfterDropping([...new Set(rows.map(row => row.date.slice(0, 7)))], row => row.date.slice(0, 7));
  return {
    minLeaveOneVenueMax2Roi: venue.value, worstVenue: venue.group,
    minLeaveOneMonthMax2Roi: month.value, worstMonth: month.group,
  };
}
function metric(rows: Observation[]): Metric {
  const payouts = rows.filter(r => r.hit).map(r => r.payout_yen ?? 0).sort((a, b) => b - a);
  const payout = payouts.reduce((sum, value) => sum + value, 0); const n = rows.length; const hits = payouts.length;
  const expectedHits = rows.reduce((sum, row) => sum + row.implied, 0);
  const variance = rows.reduce((sum, row) => sum + row.implied * (1 - row.implied), 0);
  return { n, hits, actualRate: n ? hits / n : 0, impliedRate: n ? expectedHits / n : 0,
    edgePp: n ? ((hits / n) - expectedHits / n) * 100 : 0,
    roi: n ? payout / (n * 100) : 0,
    max1HitExclRoi: n > 1 ? (payout - (payouts[0] ?? 0)) / ((n - 1) * 100) : 0,
    max2HitExclRoi: n > 2 ? (payout - (payouts[0] ?? 0) - (payouts[1] ?? 0)) / ((n - 2) * 100) : 0,
    zScore: variance > 0 ? (hits - expectedHits) / Math.sqrt(variance) : 0 };
}
function boats(program: UnconventionalProgram) { return [...program.boats].sort((a, b) => a.course - b.course); }
function boat(program: UnconventionalProgram, course: number) { return boats(program).find(row => row.course === course); }
function value(program: UnconventionalProgram, course: number, key: keyof UnconventionalBoat) { const v = boat(program, course)?.[key]; return typeof v === "number" ? v : Number.NEGATIVE_INFINITY; }
function localGap(program: UnconventionalProgram, course: number) { return value(program, course, "localWinRate") - value(program, course, "nationalWinRate"); }
function gapFromRivals(program: UnconventionalProgram, course: number) { const own = value(program, course, "nationalWinRate"); const rivals = boats(program).filter(b => b.course !== course).map(b => b.nationalWinRate).filter((v): v is number => v != null); return rivals.length ? own - Math.max(...rivals) : Number.NEGATIVE_INFINITY; }
function targetCourse(combo: string) { return Number(combo.split("-")[1]); }
function isTopRival(program: UnconventionalProgram, course: number) { const own = value(program, course, "nationalWinRate"); return boats(program).filter(b => b.course !== 1 && b.course !== course).every(b => own >= (b.nationalWinRate ?? Number.POSITIVE_INFINITY)); }
function targetOverInner(program: UnconventionalProgram, course: number) { if (course <= 2) return value(program, course, "nationalWinRate") - value(program, 3, "nationalWinRate"); return value(program, course, "nationalWinRate") - Math.max(value(program, 2, "nationalWinRate"), value(program, 3, "nationalWinRate")); }
function exhibitionRank(times: Map<number, number> | undefined, course: number) { if (!times?.has(course)) return Number.POSITIVE_INFINITY; return [...times.values()].sort((a, b) => a - b).indexOf(times.get(course)!) + 1; }
function pct(value: number) { return `${(value * 100).toFixed(1)}%`; }
function metricCell(m: Metric) { return `${m.n} / ${m.edgePp >= 0 ? "+" : ""}${m.edgePp.toFixed(2)}pt / ${m.zScore.toFixed(2)} / ${pct(m.roi)} / ${pct(m.max2HitExclRoi)}`; }
function shortCell(m: Metric) { return `${m.n} / ${m.edgePp >= 0 ? "+" : ""}${m.edgePp.toFixed(2)}pt / ${m.zScore.toFixed(2)} / ${pct(m.roi)} / ${pct(m.max2HitExclRoi)}`; }
function edgeDelta(row: { candidate: ReturnType<typeof byPeriod>; control: ReturnType<typeof byPeriod> }) { const d = row.candidate.discovery.edgePp - row.control.discovery.edgePp; const f = row.candidate.forward.edgePp - row.control.forward.edgePp; return `2024 ${d >= 0 ? "+" : ""}${d.toFixed(2)}pt / 2025 ${f >= 0 ? "+" : ""}${f.toFixed(2)}pt`; }
function matchedCell(row: ReturnType<typeof matchedResidual>) { return `${row.matched}/${row.treated} / ${pct(row.coverage)} / ${row.deltaPp >= 0 ? "+" : ""}${row.deltaPp.toFixed(2)}pt`; }
function interpretBase(base: ReturnType<typeof byPeriod>) { if (base.discovery.edgePp > 0 && base.forward.edgePp > 0) return "両期で市場過小評価。ただし標本不足"; if (base.forward.edgePp > base.discovery.edgePp) return "2025だけ増幅。レジーム変化疑い"; return "再現せず"; }
function seasonOf(date: string) { const month = Number(date.slice(5, 7)); if (month === 12 || month <= 2) return "冬(12-2)"; if (month <= 5) return "春(3-5)"; if (month <= 8) return "夏(6-8)"; return "秋(9-11)"; }
function windBand(speed: number | null) { if (speed == null) return "不明"; if (speed < 1) return "0-1m"; if (speed < 2) return "1-2m"; if (speed < 4) return "2-3m"; if (speed < 6) return "4-5m"; return "6m+"; }
function raceBand(raceNo: number) { return raceNo <= 4 ? "1-4" : raceNo <= 8 ? "5-8" : "9-12"; }
function rateBand(rate: number) { return rate < 5 ? "<5" : rate < 6 ? "5-6" : rate < 7 ? "6-7" : "7+"; }
