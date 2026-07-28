# Primary identity 再分類（writer静止後2時点）

- primaryByteIdentity(vs phase0): **FAIL**（同時実行 racer-stats append のため）
- primaryStructuralIdentity: **PASS** / primarySchemaIdentity: **PASS** / appSettingsIdentity: **PASS**
- unexpectedPrimaryMutation: **0** / knownConcurrentMutation: racer-stats append
- backfillPrimaryWriteEvidence: **none**（boat.sqliteを一度も書込みで開かない）
- read-only probe: readOnly=true, query_only=true, writeSQL=0, writeConn=0
- 2点静止安定(size/mtime): true
- quiescent sha256: `30df0dae19cab42b3d556c6c6703aa1643aab63717ab107270e5f8083dadf3cb`
