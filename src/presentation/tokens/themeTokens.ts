/**
 * デザイントークン（Phase F）。
 *
 * ここには値の定義のみを置く。CSS・アニメーション・コンポーネント実装は
 * 一切含めない。React実装（styleオブジェクトやCSS変数への変換）・将来の
 * Fable実装のどちらも、この同じトークンを参照する想定。
 */

export const SPACING = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const RADIUS = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  full: 9999,
} as const;

export const TYPOGRAPHY = {
  fontFamily: "system-ui, -apple-system, \"Segoe UI\", sans-serif",
  size: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 20,
    xl: 24,
  },
  weight: {
    regular: 400,
    medium: 500,
    bold: 700,
  },
} as const;

export const ELEVATION = {
  flat: "none",
  raised: "0 1px 2px rgba(0, 0, 0, 0.08)",
  overlay: "0 4px 12px rgba(0, 0, 0, 0.16)",
} as const;

/** ブランド非依存のプレースホルダーカラー。実配色は導入時に置き換える。 */
export const COLOR = {
  background: "#ffffff",
  surface: "#f5f5f7",
  border: "#d9d9df",
  textPrimary: "#111114",
  textSecondary: "#5a5a63",
} as const;

/** WarningSeverity（src/presentation/presentationModel.ts）に対応する配色。 */
export const STATUS_COLOR = {
  info: "#3366ff",
  warning: "#e0a300",
  critical: "#d13b3b",
} as const;

/** RiskLevel（src/presentation/presentationModel.ts）に対応する配色。 */
export const RISK_COLOR = {
  low: "#2f9e44",
  medium: "#e0a300",
  high: "#d13b3b",
  unknown: "#8a8a94",
} as const;

/** confidence（0-1）を3段階に区分した配色。閾値はMIN_PRODUCTION_CONFIDENCE(0.8)に合わせる。 */
export const CONFIDENCE_COLOR = {
  high: "#2f9e44", // >= 0.8
  medium: "#e0a300", // >= 0.5
  low: "#d13b3b", // < 0.5
} as const;
