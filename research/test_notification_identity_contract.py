#!/usr/bin/env python3
"""Research-only schema-valid notification identity regression; synthetic SQLite only."""
import sqlite3
import unittest

REPORT_SQL = "SELECT (SELECT n.sent_at FROM notification_log n WHERE n.race_id = ? AND n.channel = 'line' AND n.status = 'SENT')"
BUY_SQL = "SELECT (SELECT n.sent_at FROM notification_log n WHERE n.race_id = ? AND n.channel = 'line' AND n.status = 'SENT' AND n.title LIKE '% ' || ? || '%')"

class NotificationIdentityContract(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('CREATE TABLE notification_log (race_id TEXT, channel TEXT, status TEXT, title TEXT, sent_at TEXT, UNIQUE(race_id, channel))')

    def tearDown(self):
        self.db.close()

    def add(self, title, status='SENT'):
        self.db.execute('INSERT INTO notification_log VALUES (?, ?, ?, ?, ?)', ('race-a', 'line', status, title, '2026-11-21 09:00:00'))

    def test_matching_buy_title(self):
        self.add('BUY 2-3-4')
        self.assertEqual(self.db.execute(REPORT_SQL, ('race-a',)).fetchone()[0], self.db.execute(BUY_SQL, ('race-a', '2-3-4')).fetchone()[0])

    def test_mismatched_buy_title(self):
        self.add('RESULT 1-2-3')
        self.assertEqual(self.db.execute(REPORT_SQL, ('race-a',)).fetchone()[0], '2026-11-21 09:00:00')
        self.assertIsNone(self.db.execute(BUY_SQL, ('race-a', '2-3-4')).fetchone()[0])

    def test_non_sent_is_not_counted(self):
        self.add('BUY 2-3-4', 'FAILED')
        self.assertIsNone(self.db.execute(REPORT_SQL, ('race-a',)).fetchone()[0])
        self.assertIsNone(self.db.execute(BUY_SQL, ('race-a', '2-3-4')).fetchone()[0])

    def test_unique_race_channel(self):
        self.add('BUY 2-3-4')
        with self.assertRaises(sqlite3.IntegrityError):
            self.add('BUY 1-2-3')

    def test_success_transition_refreshes_sent_at_after_claim(self):
        # Mirrors claimNotification -> awaited successful send -> markNotificationSent.
        # Fixed synthetic timestamps avoid dependence on wall-clock or LINE.
        self.db.execute("INSERT INTO notification_log VALUES (?, ?, ?, ?, ?)",
                        ('race-a', 'line', 'PENDING', 'BUY 2-3-4', None))
        self.db.execute("UPDATE notification_log SET status = 'SENDING', sent_at = ? WHERE race_id = ? AND status = 'PENDING'",
                        ('2026-11-21 08:59:50', 'race-a'))
        self.assertIsNone(self.db.execute(REPORT_SQL, ('race-a',)).fetchone()[0])
        self.db.execute("UPDATE notification_log SET status = 'SENT', sent_at = ? WHERE race_id = ? AND status = 'SENDING'",
                        ('2026-11-21 09:00:10', 'race-a'))
        self.assertEqual(self.db.execute(REPORT_SQL, ('race-a',)).fetchone()[0], '2026-11-21 09:00:10')
        self.assertEqual(self.db.execute(BUY_SQL, ('race-a', '2-3-4')).fetchone()[0], '2026-11-21 09:00:10')

    def test_failed_attempt_release_clears_claim_time(self):
        # Mirrors releaseNotification after a failed send, not actual LINE delivery.
        self.db.execute("INSERT INTO notification_log VALUES (?, ?, ?, ?, ?)",
                        ('race-a', 'line', 'SENDING', 'BUY 2-3-4', '2026-11-21 08:59:50'))
        self.db.execute("UPDATE notification_log SET status = 'PENDING', sent_at = NULL WHERE race_id = ? AND status = 'SENDING'", ('race-a',))
        self.assertIsNone(self.db.execute("SELECT sent_at FROM notification_log WHERE race_id = ?", ('race-a',)).fetchone()[0])
        self.assertIsNone(self.db.execute(REPORT_SQL, ('race-a',)).fetchone()[0])

    def test_recovered_stuck_attempt_clears_claim_time(self):
        # Mirrors recoverStuckNotifications for one synthetic stale SENDING row.
        self.db.execute("INSERT INTO notification_log VALUES (?, ?, ?, ?, ?)",
                        ('race-a', 'line', 'SENDING', 'BUY 2-3-4', '2026-11-21 08:40:00'))
        self.db.execute("UPDATE notification_log SET status = 'PENDING', sent_at = NULL WHERE channel = 'line' AND status = 'SENDING' AND sent_at < ?",
                        ('2026-11-21 08:45:00',))
        self.assertEqual(self.db.execute("SELECT status FROM notification_log WHERE race_id = ?", ('race-a',)).fetchone()[0], 'PENDING')
        self.assertIsNone(self.db.execute("SELECT sent_at FROM notification_log WHERE race_id = ?", ('race-a',)).fetchone()[0])

if __name__ == '__main__':
    unittest.main()
