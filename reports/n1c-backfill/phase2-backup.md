# PHASE 2 backup + restore drill

- result: **PASS**
- backup sha256: 8f3d25f7f31fb847e3e819f9639981b2970c628c323d0990a3c9eb1e6e03596e
- backup bytes: 430080
- restore integrity: ok / fk: 0 / hash match: true / rows match: true
- rollback: kill writer, restore backup file over data/research-replay.sqlite (both -wal/-shm removed), reopen read-only, verify quick_check
