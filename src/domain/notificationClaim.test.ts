import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { claimNotification, recoverStuckNotifications, releaseNotification } from "../../scripts/lib/notificationLog";

function db() {
  const d = new DatabaseSync(":memory:");
  d.exec("CREATE TABLE notification_log (id INTEGER PRIMARY KEY, race_id TEXT, channel TEXT, status TEXT, sent_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
  d.prepare("INSERT INTO notification_log (id, race_id, channel, status) VALUES (1, 'line-daily-2026-10-15', 'line', 'PENDING')").run();
  return d;
}
const status = (d: DatabaseSync) => (d.prepare("SELECT status FROM notification_log WHERE id = 1").get() as { status: string }).status;

test("同時に動く2つのジョブのうち、先に押さえた方だけが送る（二重送信しない）", () => {
  const d = db();
  assert.equal(claimNotification(d, 1), true);
  assert.equal(claimNotification(d, 1), false);
  assert.equal(status(d), "SENDING");
});

test("送信に失敗したら送り直しの対象に戻し、次の回に押さえ直せる", () => {
  const d = db();
  claimNotification(d, 1);
  releaseNotification(d, 1);
  assert.equal(status(d), "PENDING");
  assert.equal(claimNotification(d, 1), true);
});

test("送信中のまま15分たったものだけを、送り直しの対象に戻す", () => {
  const d = db();
  claimNotification(d, 1);
  recoverStuckNotifications(d);
  assert.equal(status(d), "SENDING");
  d.prepare("UPDATE notification_log SET sent_at = datetime('now', '-20 minutes') WHERE id = 1").run();
  recoverStuckNotifications(d);
  assert.equal(status(d), "PENDING");
});
