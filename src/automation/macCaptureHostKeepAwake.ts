export const MAC_CAPTURE_HOST_KEEPAWAKE_LABEL =
  "com.boatpon.capture-host-keepawake" as const;
export const MAC_CAPTURE_HOST_CAFFEINATE_PATH = "/usr/bin/caffeinate" as const;

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export type MacCaptureHostKeepAwakePlistInput = {
  stdoutPath: string;
  stderrPath: string;
};

export function buildMacCaptureHostKeepAwakePlist(
  input: MacCaptureHostKeepAwakePlistInput,
): string {
  if (!input.stdoutPath.trim() || !input.stderrPath.trim()) {
    throw new Error("KEEPAWAKE_LOG_PATH_EMPTY");
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${MAC_CAPTURE_HOST_KEEPAWAKE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${MAC_CAPTURE_HOST_CAFFEINATE_PATH}</string>
    <string>-s</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(input.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(input.stderrPath)}</string>
</dict>
</plist>
`;
}

export type MacCaptureHostKeepAwakeAudit = {
  status: "PASS" | "BLOCKED";
  blockers: string[];
  label: typeof MAC_CAPTURE_HOST_KEEPAWAKE_LABEL;
  caffeinatePath: typeof MAC_CAPTURE_HOST_CAFFEINATE_PATH;
  acPowerOnly: true;
  preventsSystemSleep: true;
  preventsDisplaySleep: false;
  preventsDiskIdle: false;
  simulatesUserActivity: false;
  changesPmset: false;
  requiresSudo: false;
  currentBuyChanged: false;
  lineChanged: false;
  publicPublished: false;
  databaseWriteCount: 0;
};

export function auditMacCaptureHostKeepAwakePlist(plist: string): MacCaptureHostKeepAwakeAudit {
  const blockers: string[] = [];
  if (!plist.includes(`<string>${MAC_CAPTURE_HOST_KEEPAWAKE_LABEL}</string>`)) {
    blockers.push("KEEPAWAKE_LABEL_MISSING");
  }
  if (!plist.includes(`<string>${MAC_CAPTURE_HOST_CAFFEINATE_PATH}</string>`)) {
    blockers.push("CAFFEINATE_PATH_MISSING");
  }
  if (!/<string>-s<\/string>/u.test(plist)) {
    blockers.push("AC_ONLY_SYSTEM_SLEEP_ASSERTION_MISSING");
  }
  if (/<string>-(?:i|d|m|u)<\/string>/u.test(plist)) {
    blockers.push("UNSCOPED_CAFFEINATE_ASSERTION_PRESENT");
  }
  if (!/<key>RunAtLoad<\/key>\s*<true\/>/u.test(plist)) {
    blockers.push("RUN_AT_LOAD_MISSING");
  }
  if (!/<key>KeepAlive<\/key>\s*<true\/>/u.test(plist)) {
    blockers.push("KEEP_ALIVE_MISSING");
  }
  if (!/<key>ProcessType<\/key>\s*<string>Background<\/string>/u.test(plist)) {
    blockers.push("BACKGROUND_PROCESS_TYPE_MISSING");
  }
  if (/pmset|sudo|token|secret|password|LINE_CHANNEL|CURRENT_BUY|AUTOMATED_BETTING/iu.test(plist)) {
    blockers.push("FORBIDDEN_KEEP_AWAKE_CONTENT");
  }
  const normalized = [...new Set(blockers)].sort();
  return {
    status: normalized.length === 0 ? "PASS" : "BLOCKED",
    blockers: normalized,
    label: MAC_CAPTURE_HOST_KEEPAWAKE_LABEL,
    caffeinatePath: MAC_CAPTURE_HOST_CAFFEINATE_PATH,
    acPowerOnly: true,
    preventsSystemSleep: true,
    preventsDisplaySleep: false,
    preventsDiskIdle: false,
    simulatesUserActivity: false,
    changesPmset: false,
    requiresSudo: false,
    currentBuyChanged: false,
    lineChanged: false,
    publicPublished: false,
    databaseWriteCount: 0,
  };
}
