import { MODEL_VERSION } from "./modelVersion";

export const LIVE_MONITOR_FROM = "2026-01-01";
export const LIVE_MONITOR_MODEL_VERSION = MODEL_VERSION;

export function liveMonitorFilterText() {
  return `decision='BUY' AND date>='${LIVE_MONITOR_FROM}' AND model_version='${LIVE_MONITOR_MODEL_VERSION}'`;
}
