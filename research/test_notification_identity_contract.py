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

if __name__ == '__main__':
    unittest.main()
