/**
 * LINE の通知の記録（notification_log）を、送る前に押さえる処理。
 */
import type { DatabaseSync } from "node:sqlite";

// 21:30 は日次まとめ（daily-notify）と確定通知（daily-results）の2つのジョブが同時に notify-line を動かす。
// どちらも未送信（PENDING）の通知を拾うので、送る前に「送信中（SENDING）」で押さえ、押さえられた方だけが送る
// （Codex のレビューで二重送信を再現。LINE は月 200 通の枠がある）。押さえた時刻は sent_at に入れる。
// 作られてから23時間を過ぎた通知は送らない。LINE の再試行キーは24時間で切れるので、前の回で届いていた場合に二重になる
// （作られた通知は、その実行ですぐに送るので、23時間より古い未送信の通知は、すでに1回は送ろうとしている）。内容は日次まとめに載る。
export function claimNotification(db: DatabaseSync, id: number): boolean {
  return db.prepare(`UPDATE notification_log SET status = 'SENDING', sent_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('PENDING', 'FAILED') AND created_at >= datetime('now', '-23 hours')`).run(id).changes === 1;
}

export function releaseNotification(db: DatabaseSync, id: number) {
  db.prepare("UPDATE notification_log SET status = 'PENDING', sent_at = NULL WHERE id = ? AND status = 'SENDING'").run(id);
}

/** 送信中のまま15分たった通知（送っている途中でプロセスが止まった）を、送り直しの対象（PENDING）に戻す。 */
export function recoverStuckNotifications(db: DatabaseSync) {
  const changes = db.prepare("UPDATE notification_log SET status = 'PENDING', sent_at = NULL WHERE channel = 'line' AND status = 'SENDING' AND sent_at < datetime('now', '-15 minutes')").run().changes;
  if (changes > 0) console.log(`LINE notify recovered stuck SENDING: ${changes}`);
}

/**
 * 通知を「未送信（PENDING）」として作る・作り直す。読んでから書くまでの間に、別のジョブが送信中・送信済みにしているかもしれないので、
 * 書く側でも状態を条件にして SENDING・SENT を PENDING に巻き戻さない（Codex のレビューで巻き戻しと二重送信を再現）。
 * 作り直せなかった（送信中・送信済み）ときは null。
 */
export function upsertPendingRow(
  db: DatabaseSync,
  args: { raceId: string; title: string; body: string; officialUrl: string },
): Record<string, unknown> | null {
  db.prepare(`
INSERT INTO notification_log (race_id, channel, status, title, body, official_url)
VALUES (?, 'line', 'PENDING', ?, ?, ?)
ON CONFLICT(race_id, channel) DO UPDATE SET status = 'PENDING', title = excluded.title, body = excluded.body, official_url = excluded.official_url
WHERE notification_log.status NOT IN ('SENT', 'SENDING')
`).run(args.raceId, args.title, args.body, args.officialUrl);
  const row = db.prepare(`
SELECT id, race_id, status, title, body, official_url
FROM notification_log
WHERE race_id = ? AND channel = 'line'
`).get(args.raceId) as Record<string, unknown> | undefined;
  return row && row.status === "PENDING" ? row : null;
}
