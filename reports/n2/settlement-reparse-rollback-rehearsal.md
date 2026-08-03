# Settlement reparse rollback / backup-restore rehearsal

- generated: 2026-08-03T06:27:36.929Z
- as-of: 2026-08-01T00:00:00.000Z
- target (temp copy): /Users/m-shogo/Developer/personal/boat-pon/data/tmp/reparse-full.sqlite
- scope: resolver-only rollback + append-only reversal + backup/restore on a temp copy; no production/source write
- digest: bb95f227105906b998d1fa46c7a3512580ba8aae22ed658810ea728c2a66cca7
- result: REHEARSED

## (1) Operational disable (resolver-only rollback)

- corrected active: {"partially_refunded":1,"refunded":1554,"settled":8216200}
- rolled-back active (ignore reparse parse_run): {"partially_refunded":1,"refunded":319301,"settled":7833297}
- rolled-back restores v1 original settlement shape (refunded ≈319,301 等)

## (2) Append-only reversal

- rollback_started / completed appended: 1 / 1
- double rollback idempotent (second insert changes=0): true
- audit UPDATE blocked: true / audit DELETE blocked: true
- physical settlement rows unchanged by rollback: true (8539698 → 8539698)

## (3) Backup / restore

- backup: /Users/m-shogo/Developer/personal/boat-pon/data/tmp/reparse-rollback-backup.sqlite
- backup quick_check: ok
- backup sha256: 065ca8c70807458c6b81b769f732e84064120199e255255eff016c73be713fbb
- restore sha256 matches backup: true
- restore resolver result matches target: true

> append-only rollback: 既存 row を UPDATE/DELETE せず、resolver 切替と監査追記だけで v1 original を復元する。
> source / production DB には触れていない。
