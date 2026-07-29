# Primary identity 再分類（writer静止後2時点）

- primaryByteIdentity(vs phase0): **FAIL**（同時実行 racer-stats append のため）
- primaryStructuralIdentity: **PASS** / primarySchemaIdentity: **PASS** / appSettingsIdentity: **PASS**
- unexpectedPrimaryMutation: **0** / knownConcurrentMutation: racer-stats append
- backfillPrimaryWriteEvidence: **none**（boat.sqliteを一度も書込みで開かない）
- read-only probe: readOnly=true, query_only=true, writeSQL=0, writeConn=0
- 2点静止安定(size/mtime): true
- quiescent sha256: `4136cf135de892f77fb692fc2ed8f4a11665fc5f31015c8299d49944fed8fae3`
