# Verification guide

All further browser execution must run on vkbox under the owner’s2026-09-09 instruction; do not launch or control browsers on the laptop. Keep native Safari/VoiceOver prerequisites explicit when the server cannot supply them.

Use an isolated application data directory and synthetic users/fixtures. Production account/sample data is never a test fixture. Keep artifacts outside Git except bounded synthetic manifests.

1. Run focused auth/recovery tests with actual child-process restart/crash and controlled DB/journal failures; confirm old-cookie refusal and another user's orderly continuity.
2. Run the deterministic held-sample browser regression and original Clear/error assertions through the owned runner.
3. Run real temporary SQLite mapping CRUD/import/export -> validate/suggest -> browser readback tests, including account isolation and immediate cache invalidation.
4. Run resource parser/rewriter and current SSRF tests, then real-browser loaded-pixel/style/cancellation/partial-retry journeys.
5. Run Core and HTTP SChain/declared-route contract tests and all nineteen frozen adapter witnesses in the prepared network-none environment. Preserve hashes and original outcomes.
6. Execute the committed saved/history/account mapping matrix and native browser/zoom/screen-reader/device checks; record each actual environment and any missing prerequisite.
7. Run format, lint, typecheck, full Linux `npm run ci`, package/Docker and complete normative corpus against the settled source; independently converge and address gaps.
8. Wait exact hosted CI, verify a fresh canonical backup, deploy through `scripts/deploy.sh`, and read back immutable image/version/health/public smoke. Read back Cloudflare configuration and fresh browser responses after the single-site injection change.

Counts come from each runner execution. An unrun environment remains open. Original failures and retries are retained rather than overwritten by a later success.
