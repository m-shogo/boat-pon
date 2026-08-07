# N2 Daily Readiness — Source Integrity Note

The daily-readiness builder treats the private market day index as untrusted derived input until both checks pass:

1. the stored JSON body reproduces its own `indexDigest` after excluding only the digest field;
2. rebuilding the day index from verified v2 private feature artifacts at the stored `generatedAt` reproduces that same digest.

A file whose digest string is well-formed but whose body was modified fails closed. Rebuilding source evidence is not a substitute for validating the stored artifact itself.

This integrity check does not read outcomes, validation or holdout data and does not connect to Current BUY, LINE, public projection, automated betting, database writes, or production.
