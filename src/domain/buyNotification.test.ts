import assert from "node:assert/strict";
import test from "node:test";
import { realtimeBuyNotSentReason, shouldSendRealtimeBuyNotification } from "./buyNotification";

test("T-10 か T-5 で BUY になった未送信の BUY を、締切 5 分以上前なら通知する", () => {
  assert.equal(shouldSendRealtimeBuyNotification({ notificationStatus: null, latestCheckpointLabel: "T-5", actualMinutesBeforeClose: 7 }), true);
  assert.equal(shouldSendRealtimeBuyNotification({ notificationStatus: "PENDING", latestCheckpointLabel: "T-5", actualMinutesBeforeClose: 5 }), true);
  assert.equal(shouldSendRealtimeBuyNotification({ notificationStatus: null, latestCheckpointLabel: "T-10", actualMinutesBeforeClose: 11 }), true);
});

test("T-30/T-20 の途中の BUY は通知しない", () => {
  for (const checkpoint of ["T-30", "T-20", null]) {
    assert.equal(shouldSendRealtimeBuyNotification({ notificationStatus: null, latestCheckpointLabel: checkpoint, actualMinutesBeforeClose: 20 }), false);
  }
});

test("送信済みの BUY は重複通知しない", () => {
  assert.equal(shouldSendRealtimeBuyNotification({ notificationStatus: "SENT", latestCheckpointLabel: "T-5", actualMinutesBeforeClose: 7 }), false);
});

test("締切 5 分未満は通知しない", () => {
  assert.equal(shouldSendRealtimeBuyNotification({ notificationStatus: null, latestCheckpointLabel: "T-5", actualMinutesBeforeClose: 4.9 }), false);
  assert.equal(shouldSendRealtimeBuyNotification({ notificationStatus: null, latestCheckpointLabel: "T-5", actualMinutesBeforeClose: null }), false);
});

test("送らなかった理由をログ用に返す", () => {
  assert.equal(realtimeBuyNotSentReason({ notificationStatus: null, latestCheckpointLabel: "T-5", actualMinutesBeforeClose: 7 }), null);
  assert.equal(realtimeBuyNotSentReason({ notificationStatus: null, latestCheckpointLabel: "T-5", actualMinutesBeforeClose: 4.94 }), "too-late minutes=4.9");
  assert.equal(realtimeBuyNotSentReason({ notificationStatus: null, latestCheckpointLabel: "T-20", actualMinutesBeforeClose: 18 }), "checkpoint=T-20");
  assert.equal(realtimeBuyNotSentReason({ notificationStatus: "SENT", latestCheckpointLabel: "T-5", actualMinutesBeforeClose: 7 }), "already-sent");
});
