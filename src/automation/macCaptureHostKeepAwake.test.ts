import assert from "node:assert/strict";
import test from "node:test";

import {
  MAC_CAPTURE_HOST_CAFFEINATE_PATH,
  MAC_CAPTURE_HOST_KEEPAWAKE_LABEL,
  auditMacCaptureHostKeepAwakePlist,
  buildMacCaptureHostKeepAwakePlist,
} from "./macCaptureHostKeepAwake.js";

test("keep-awake uses only AC-power system-sleep assertion", () => {
  const plist = buildMacCaptureHostKeepAwakePlist({
    stdoutPath: "/Users/test/boat-pon/data/private/trifecta-capture/logs/host-keepawake.stdout.log",
    stderrPath: "/Users/test/boat-pon/data/private/trifecta-capture/logs/host-keepawake.stderr.log",
  });
  const audit = auditMacCaptureHostKeepAwakePlist(plist);

  assert.equal(audit.status, "PASS");
  assert.deepEqual(audit.blockers, []);
  assert.equal(audit.label, MAC_CAPTURE_HOST_KEEPAWAKE_LABEL);
  assert.equal(audit.caffeinatePath, MAC_CAPTURE_HOST_CAFFEINATE_PATH);
  assert.equal(audit.acPowerOnly, true);
  assert.equal(audit.preventsSystemSleep, true);
  assert.equal(audit.preventsDisplaySleep, false);
  assert.equal(audit.preventsDiskIdle, false);
  assert.equal(audit.simulatesUserActivity, false);
  assert.equal(audit.changesPmset, false);
  assert.equal(audit.requiresSudo, false);
  assert.equal(audit.currentBuyChanged, false);
  assert.equal(audit.lineChanged, false);
  assert.equal(audit.publicPublished, false);
  assert.equal(audit.databaseWriteCount, 0);

  assert.match(plist, /<string>\/usr\/bin\/caffeinate<\/string>/u);
  assert.match(plist, /<string>-s<\/string>/u);
  assert.doesNotMatch(plist, /<string>-(?:i|d|m|u)<\/string>/u);
  assert.doesNotMatch(plist, /pmset|sudo|token|secret|password|LINE_CHANNEL|CURRENT_BUY/iu);
});

test("keep-awake escapes log paths and rejects empty paths", () => {
  const plist = buildMacCaptureHostKeepAwakePlist({
    stdoutPath: "/Users/a&b/out.log",
    stderrPath: "/Users/a&b/err.log",
  });
  assert.match(plist, /a&amp;b/u);
  assert.doesNotMatch(plist, /a&b/u);
  assert.throws(
    () => buildMacCaptureHostKeepAwakePlist({ stdoutPath: "", stderrPath: "/tmp/err" }),
    /KEEPAWAKE_LOG_PATH_EMPTY/u,
  );
});

test("audit blocks widened caffeinate or privileged power-management behavior", () => {
  const valid = buildMacCaptureHostKeepAwakePlist({
    stdoutPath: "/tmp/out",
    stderrPath: "/tmp/err",
  });
  const widened = valid
    .replace("<string>-s</string>", "<string>-i</string>")
    .replace("</array>", "<string>sudo pmset sleep 0</string>\n  </array>");
  const audit = auditMacCaptureHostKeepAwakePlist(widened);
  assert.equal(audit.status, "BLOCKED");
  assert.ok(audit.blockers.includes("AC_ONLY_SYSTEM_SLEEP_ASSERTION_MISSING"));
  assert.ok(audit.blockers.includes("UNSCOPED_CAFFEINATE_ASSERTION_PRESENT"));
  assert.ok(audit.blockers.includes("FORBIDDEN_KEEP_AWAKE_CONTENT"));
});
