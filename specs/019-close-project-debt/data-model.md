# Data model

No application schema or saved payload identity changes.

Inventory records contain ID, source, required result, disposition, evidence and owner dependency. Allowed states are pending, implementing, verified, owner-declined and preserved/archived. A cancellation is never a passing experiment.

Resource identities distinguish a canonical final-byte asset version from a coupled module version. Only a supported exact identity may advertise immutable caching; absent versions revalidate and invalid/stale versions reject without cache storage.

Recovery archives retain original Git objects, tracked/untracked drafts, source names and checksums outside the repository with owner-only access. Tracked inventory carries only non-sensitive summaries and restoration pointers.
