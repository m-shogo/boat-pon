import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { claimNotification, recoverStuckNotifications, releaseNotification, upsertPendingRow } from "../../scripts/lib/notificationLog";

function db() {
  const d = new DatabaseSync(":memory:");
  d.exec("CREATE TABLE notification_log (id INTEGER PRIMARY KEY, race_id TEXT, channel TEXT, status TEXT, title TEXT, body TEXT, official_url TEXT, sent_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
  d.exec("CREATE UNIQUE INDEX uq ON notification_log (race_id, channel)");
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

test("A が読んだ後に B が送信中にしても、A の作り直しは送信中・送信済みを巻き戻さない（Codex のレビューの再現）", () => {
  const d = db();
  const args = { raceId: "line-daily-2026-10-15", title: "t", body: "b", officialUrl: "u" };
  // B が押さえて送信中 → A が作り直そうとする
  assert.equal(claimNotification(d, 1), true);
  assert.equal(upsertPendingRow(d, args), null);
  assert.equal(status(d), "SENDING");
  // B が送り終えた後も同じ
  d.prepare("UPDATE notification_log SET status = 'SENT' WHERE id = 1").run();
  assert.equal(upsertPendingRow(d, args), null);
  assert.equal(status(d), "SENT");
  // まだ無い通知は作る。失敗した通知は作り直して送り直す
  assert.equal(upsertPendingRow(d, { ...args, raceId: "line-daily-2026-10-16" })?.status, "PENDING");
  d.prepare("UPDATE notification_log SET status = 'FAILED' WHERE id = 1").run();
  assert.equal(upsertPendingRow(d, args)?.status, "PENDING");
});

test("作られてから23時間を過ぎた通知は、作り直しても送らない（LINE の再試行キーは24時間で切れる）", () => {
  const d = db();
  d.prepare("UPDATE notification_log SET created_at = datetime('now', '-48 hours') WHERE id = 1").run();
  assert.equal(upsertPendingRow(d, { raceId: "line-daily-2026-10-15", title: "t", body: "b", officialUrl: "u" })?.status, "PENDING");
  assert.equal(claimNotification(d, 1), false);
  assert.equal(status(d), "PENDING");
});
