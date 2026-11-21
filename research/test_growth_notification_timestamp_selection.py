#!/usr/bin/env python3
"""Research-only synthetic regression for growth notification timestamp ambiguity.

No repository DB, network, secrets, production paths, or notification services.
Run: python3 research/test_growth_notification_timestamp_selection.py
"""
import sqlite3
import unittest


class GrowthNotificationSelectionFixture(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute(
            "CREATE TABLE notification_log (race_id TEXT, channel TEXT, status TEXT, sent_at TEXT)"
        )
        self.db.executemany(
            "INSERT INTO notification_log VALUES (?, ?, ?, ?)",
            [
                ("race-a", "line", "SENT", "2026-11-21T10:00:00"),
                ("race-a", "line", "SENT", "2026-11-21T09:00:00"),
                ("race-a", "line", "FAILED", "2026-11-21T08:00:00"),
                ("race-a", "email", "SENT", "2026-11-21T07:00:00"),
                ("race-b", "line", "SENT", "2026-11-21T06:00:00"),
            ],
        )

    def tearDown(self):
        self.db.close()

    def test_successful_line_candidates_are_multiple(self):
        rows = self.db.execute(
            "SELECT sent_at FROM notification_log WHERE race_id=? AND channel='line' AND status='SENT'",
            ("race-a",),
        ).fetchall()
        self.assertEqual(len(rows), 2)
        self.assertEqual({r[0] for r in rows}, {"2026-11-21T09:00:00", "2026-11-21T10:00:00"})

    def test_first_and_last_success_differ_at_cutoff(self):
        earliest, latest = self.db.execute(
            "SELECT MIN(sent_at), MAX(sent_at) FROM notification_log "
            "WHERE race_id=? AND channel='line' AND status='SENT'",
            ("race-a",),
        ).fetchone()
        cutoff = "2026-11-21T09:30:00"
        self.assertLess(earliest, cutoff)
        self.assertGreater(latest, cutoff)

    def test_current_scalar_query_has_no_explicit_order(self):
        # This is the current report's SQL expression, not a guarantee of which row wins.
        sql = (
            "SELECT (SELECT n.sent_at FROM notification_log n "
            "WHERE n.race_id = 'race-a' AND n.channel = 'line' AND n.status = 'SENT')"
        )
        chosen = self.db.execute(sql).fetchone()[0]
        self.assertIn(chosen, {"2026-11-21T09:00:00", "2026-11-21T10:00:00"})


if __name__ == "__main__":
    unittest.main()
