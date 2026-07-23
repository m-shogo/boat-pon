import assert from "node:assert/strict";
import test from "node:test";
import { shouldSendRealtimeBuyNotification } from "./buyNotification";

test("T-5到達後の未送信BUYだけをリアルタイム通知する", () => {
  assert.equal(shouldSendRealtimeBuyNotification({ notificationStatus: null, latestCheckpointLabel: "T-5", actualMinutesBeforeClose: 7 }), true);
  assert.equal(shouldSendRealtimeBuyNotification({ notificationStatus: "PENDING", latestCheckpointLabel: "T-5", actualMinutesBeforeClose: 5 }), true);
});

test("T-30/T-20/T-10の途中BUYは通知しない", () => {
  for (const checkpoint of ["T-30", "T-20", "T-10", null]) {
    assert.equal(shouldSendRealtimeBuyNotification({ notificationStatus: null, latestCheckpointLabel: checkpoint, actualMinutesBeforeClose: 7 }), false);
  }
});

test("送信済みBUYはT-5でも重複通知しない", () => {
  assert.equal(shouldSendRealtimeBuyNotification({ notificationStatus: "SENT", latestCheckpointLabel: "T-5", actualMinutesBeforeClose: 7 }), false);
});

test("締切5分未満のT-5は収集してもBUY通知しない", () => {
  assert.equal(shouldSendRealtimeBuyNotification({ notificationStatus: null, latestCheckpointLabel: "T-5", actualMinutesBeforeClose: 4 }), false);
  assert.equal(shouldSendRealtimeBuyNotification({ notificationStatus: null, latestCheckpointLabel: "T-5", actualMinutesBeforeClose: null }), false);
});
