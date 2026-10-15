/**
 * LINE の通知の記録（notification_log）を、送る前に押さえる処理。
 */
import type { DatabaseSync } from "node:sqlite";

// 21:30 は日次まとめ（daily-notify）と確定通知（daily-results）の2つのジョブが同時に notify-line を動かす。
// どちらも未送信（PENDING）の通知を拾うので、送る前に「送信中（SENDING）」で押さえ、押さえられた方だけが送る
// （Codex のレビューで二重送信を再現。LINE は月 200 通の枠がある）。押さえた時刻は sent_at に入れる。
export function claimNotification(db: DatabaseSync, id: number): boolean {
  return db.prepare("UPDATE notification_log SET status = 'SENDING', sent_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('PENDING', 'FAILED')").run(id).changes === 1;
}

export function releaseNotification(db: DatabaseSync, id: number) {
  db.prepare("UPDATE notification_log SET status = 'PENDING', sent_at = NULL WHERE id = ? AND status = 'SENDING'").run(id);
}

/** 送信中のまま15分たった通知（送っている途中でプロセスが止まった）を、送り直しの対象（PENDING）に戻す。 */
export function recoverStuckNotifications(db: DatabaseSync) {
  const changes = db.prepare("UPDATE notification_log SET status = 'PENDING', sent_at = NULL WHERE channel = 'line' AND status = 'SENDING' AND sent_at < datetime('now', '-15 minutes')").run().changes;
  if (changes > 0) console.log(`LINE notify recovered stuck SENDING: ${changes}`);
}
