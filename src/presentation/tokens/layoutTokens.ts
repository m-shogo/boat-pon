/**
 * レイアウトトークン（Phase G）。
 *
 * ブレークポイント・カードサイズ・グリッド/ギャップのルールを値として
 * 定義するのみ。レンダラー実装（グリッドCSS・Flexboxコンポーネント等）は
 * ここには置かない。
 */

export const BREAKPOINT = {
  mobile: 0,
  tablet: 768,
  desktop: 1200,
} as const;

export type BreakpointName = keyof typeof BREAKPOINT;

export const CARD_SIZE = {
  ruleCard: { minWidth: 280, maxWidth: 360, minHeight: 220 },
  opportunityCard: { minWidth: 160, maxWidth: 220, minHeight: 120 },
  warningBadge: { minWidth: 0, maxWidth: 320, minHeight: 32 },
} as const;

/** ブレークポイントごとのResearch Summary/Daily Reportのグリッド列数。 */
export const GRID_COLUMNS: Record<BreakpointName, number> = {
  mobile: 1,
  tablet: 2,
  desktop: 3,
};

export const GAP = {
  cardGap: 16,
  sectionGap: 32,
  badgeGap: 8,
} as const;
