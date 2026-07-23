export function shouldSendRealtimeBuyNotification(args: {
  notificationStatus: string | null;
  latestCheckpointLabel: string | null;
  actualMinutesBeforeClose: number | null;
}): boolean {
  if (args.notificationStatus === "SENT") return false;
  return args.latestCheckpointLabel === "T-5"
    && args.actualMinutesBeforeClose != null
    && args.actualMinutesBeforeClose >= 5;
}
