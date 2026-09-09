# Data model

- Session recovery checkpoint: explicit schema version, stable private HMAC key, clean/dirty lifecycle, bounded revocation digests with expiry. Only the auth owner reads/writes it; atomic/fsync and exclusive-owner semantics are part of integrity. Corruption, unknown version or missing key cannot mean an empty trusted store. Stored SQLite session identities are versioned HMACs; browser bearer cookies retain their shape. No new SQLite table/column is required.
- Mapping: existing account dialect + normalized path + version discriminator. Version1 uses existing serialized exact value; version2 path scope uses an empty canonical value and one of nine role labels. Params retain legacy meaning. Export schema2 explicitly roundtrips scope/version; unsupported versions fail before mutation.
- Resource manifest: current creative revision, resource URL/host/role references, selected state, bounded outcome and in-memory successful raster replacement. No persistent server cache or payload log.
- SChain inspection: structured chain copies with original locations, serialized source parse result, factual node count, source-linked findings and declared sender provenance. No URL fetch.
- Declared route: adapterId, direction, pinned revision and literal declared provenance. Evaluation returns known/unknown applicability and source-linked statement identities, without observed-traffic fields.
- Witness: stable historical ID, pinned file/source digest, trigger/control summary, declared oracle, observed outcome and generation. Old audit outcomes remain retained historical facts.
- Coverage record: actual browser/version/device/viewport/native zoom/locale/theme/journey and measured result. Missing prerequisite is a first-class open result, not a skip counted as success.

### Process ownership lock

The private recovery directory also contains a fixed-path SQLite ownership sidecar using the existing better-sqlite3 dependency. A lifetime `BEGIN EXCLUSIVE` transaction supplies an OS-released crash-safe lock on Linux and macOS; it contains no application tables or rows. Acquisition uses a bounded busy timeout and fails closed. No PID-file stale-lock recovery is used. Concurrent-owner and actual crash-release regressions cover the boundary. This is an ownership mechanism, not an additional application data store.
