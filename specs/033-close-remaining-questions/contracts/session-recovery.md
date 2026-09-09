# Session recovery contract

The security property is rejection of a revoked raw cookie across supported process restarts and old-image hydration, including a failed SQLite deletion. Preserve30-day expiry and ordinary orderly restart continuity. Existing reset/wipe data transactions remain atomic.

Before hydration or issuing sessions, durably establish the dirty recovery fence and trusted checkpoint/key. Persist revocation intent before deleting a known active session. Clear its hot identity and cookie even on error. Unknown/malformed cookies produce no journal growth. A clean checkpoint is permitted only after requests drain, new auth mutations are gated and every revocation has durable accounting.

Missing/incompatible/corrupt state or an uncertain previous exit requires durable invalidation of old session rows before new auth becomes available. If this cannot complete, fail closed. First installation and uncertain recovery can therefore require users to log in again. Do not silently restore raw-token rows.

Versioned keyed DB lookup identifiers are not browser bearer tokens; old code cannot authenticate newly issued raw cookies. The key is private, stable across ordinary restart and never logged. Unknown versions, lost keys and concurrent writers cannot fall back to unsafe hydration.

Password-reset/account invalidation shares the same boundary; stale credential proof held across password change cannot mint a new session. Journal operations, errors and diagnostics carry no raw cookie, email, payload, key or exception details. Backup/restore documentation must explicitly describe the checkpoint and session invalidation consequences without weakening canonical backup verification.

## Explicit resource bounds

The recovery record has at most 16,384 unexpired revocation entries and at most 4 MiB serialized bytes; read checks enforce the byte cap before parsing. Expired entries may be pruned. An unexpired intent is never evicted to make room. Overflow is a persistence failure: local denial remains, DB deletion is still attempted, and an intent that cannot be durably accounted for prevents a clean checkpoint. An uncertain subsequent boot must durably invalidate prior sessions before issuing or hydrating any session, or remain unavailable. Deterministic tests may inject smaller bounds; production defaults cannot be loosened through request input. Tests cover oversized-state read and entry-cap exhaustion, plus controlled login→reset→mint and in-flight shutdown ordering.
