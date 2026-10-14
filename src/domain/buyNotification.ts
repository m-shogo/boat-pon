/**
 * リアルタイムの BUY 通知を送るか。
 * - T-10（締切 10〜15 分前）か T-5（10 分前以内）のスナップショットで BUY になり、まだ締切 5 分以上前なら送る。
 *   以前は T-5 のときだけだった。T-10 で BUY になっても、次の実行の判定（オッズ取得に 1〜3 分かかる）が
 *   締切 5 分前を過ぎることが多く、通知されないまま固定されていた（2026-10-10〜14 の BUY 10件中4件）。
 * - 送ったら、そのレースの判定はそこで固定する（auto-fetch-odds）。通知した内容がそのまま記録になる。
 */
export const REALTIME_NOTIFY_CHECKPOINTS: ReadonlySet<string> = new Set(["T-10", "T-5"]);

export function shouldSendRealtimeBuyNotification(args: {
  notificationStatus: string | null;
  latestCheckpointLabel: string | null;
  actualMinutesBeforeClose: number | null;
}): boolean {
  if (args.notificationStatus === "SENT") return false;
  return args.latestCheckpointLabel != null
    && REALTIME_NOTIFY_CHECKPOINTS.has(args.latestCheckpointLabel)
    && args.actualMinutesBeforeClose != null
    && args.actualMinutesBeforeClose >= 5;
}

/** 送らなかった理由（ログ用）。送るときは null。 */
export function realtimeBuyNotSentReason(args: {
  notificationStatus: string | null;
  latestCheckpointLabel: string | null;
  actualMinutesBeforeClose: number | null;
}): string | null {
  if (shouldSendRealtimeBuyNotification(args)) return null;
  if (args.notificationStatus === "SENT") return "already-sent";
  if (args.latestCheckpointLabel == null || !REALTIME_NOTIFY_CHECKPOINTS.has(args.latestCheckpointLabel)) return `checkpoint=${args.latestCheckpointLabel ?? "-"}`;
  return `too-late minutes=${args.actualMinutesBeforeClose == null ? "-" : args.actualMinutesBeforeClose.toFixed(1)}`;
}
