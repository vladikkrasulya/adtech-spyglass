# Walkthrough — Priority #0: Privacy-safe product telemetry

Status: **CLOSED — live in production.**

| Step                          | State                                                      |
| ----------------------------- | ---------------------------------------------------------- |
| Code                          | `03a7fb5` + `ba91c3f` + `6503261` on `main`, pushed        |
| ClickHouse table              | created, verified, empty (verification rows removed)       |
| Production                    | `v1.6.1 (6503261)` live, full smoke passed, RestartCount=0 |
| `external` classification     | proven end-to-end through Cloudflare on the real domain    |
| Per-IP rate limits            | proven isolating real clients against the live server (§6) |
| Operator summary endpoint     | verified against live data (401 without token, 200 with)   |
| Pre-existing shim-removal WIP | untouched — parked and restored byte-for-byte, twice       |

Three commits. The first deploy shipped a real defect that only a production
request could reveal (§7), and chasing it down surfaced that the same broken
value keyed every rate limiter in the app (§6).

---

## 0. What the WIP check found

The plan's first instruction was to inspect the uncommitted changes in
`analytics` / `auth` / `db` and not duplicate or overwrite them.

**Those changes are not telemetry.** They are the removal of the legacy
"Spyglass" compatibility shims (the ~v1.6 wave):

| File                              | What the WIP removes                                                           |
| --------------------------------- | ------------------------------------------------------------------------------ |
| `auth.js`                         | reading the `spy_session` cookie, and expiring it in `Set-Cookie`              |
| `db.js`                           | `SPYGLASS_DATA_DIR` fallback + the `spyglass.db` → `ortbtools.db` rename       |
| `lib/analytics-enabled.js`        | the `SPYGLASS_ANALYTICS_DISABLED` opt-out                                      |
| `public/version.js`               | `window.SpyglassVersion` + migration of 5 localStorage / 1 sessionStorage keys |
| `public/modules/intel/storage.js` | migration of the `spyglass_intel_v1` IndexedDB                                 |
| `docker-compose.yml`              | the `adtech-spyglass` network alias on both networks                           |
| `scripts/deploy.sh`               | the `SPYGLASS_TAG` fallback when reading the rollback tag                      |
| `public/export.js`                | the duplicate `spyglass_version` key in the export bundle                      |
| `tests/brand-guard.test.js`       | the `legacy-spyglass-ok` escape hatch itself                                   |

So there was no telemetry work to avoid duplicating; this priority was built
from scratch. Those changes were left untouched and are still in the working
tree alongside the new work.

Two side effects of that WIP worth a decision before it ships (not part of this
priority): dropping the `spy_session` read will sign out sessions created before
the rename, and dropping the localStorage/IndexedDB migrations will lose local
history and the intel corpus for browsers that have not visited since
2026-07-13.

---

## 1. What was built

Anonymous product counters that separate **real external users** from the
owner, AI agents, CI, uptime monitors and crawlers, and make activation, repeat
usage and D1/D7/D30 retention computable — without storing any payload, IP
address or User-Agent string.

### Data flow

```
browser (public/telemetry.js)
  │  mints visitor_id (localStorage) + session_id (sessionStorage)
  │  honours ?__ot_optout / GPC / DNT / ?__ot_internal
  │  POST /api/v1/telemetry/event   {event, ids, locale, referrer host, utm_*, dnt, internal}
  ▼
modules/telemetry/handler.js
  │  Sec-Fetch-Site guard · 2 KB body cap · per-IP rate limit · always 204
  ▼
lib/product-telemetry.js  buildRow()      ← the privacy boundary
  │  rebuilds the row from a closed contract; validates every field
  │  calls lib/traffic-class.js with ip + headers, then DISCARDS both
  ▼
ClickHouse analytics.ortbtools_product_events   (TTL 180 days)
  ▲
  └── GET /api/v1/telemetry/summary (Bearer ADMIN_STATS_TOKEN)
      → traffic split · activation · repeat usage · D1/D7/D30 cohorts · daily
```

### One writer, on purpose

`public/telemetry.js` is the only thing that writes to this table. That was a
design decision, documented in `lib/product-telemetry.js`:

- Every row then carries the same anonymous `visitor_id`, so cohorts are
  computable. A server-side emitter has no visitor id to attach (the browser
  never sends it on ordinary API calls, by design), so its rows could be
  counted but never cohorted.
- Traffic that cannot run JavaScript — Docker health checks, Uptime Kuma, curl,
  most crawlers — is absent from the table **by construction**, not by
  filtering.
- Authoritative server-side volume already exists and is not duplicated:
  `analytics.validation_logs` counts every analyze including API/CLI callers,
  `analytics.ortbtools_events` counts requests.

Trade-off: a content blocker suppresses these counters. Because the whole funnel
travels one path, the ratios stay sound even when absolute totals under-count.
This is stated in `docs/PRIVACY.md`.

---

## 2. Files changed

### New

| File                                      | Purpose                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `lib/traffic-class.js`                    | pure classifier: external / owner / internal / bot / monitor / ci / agent |
| `lib/product-telemetry.js`                | the privacy boundary (`buildRow`) + buffered ClickHouse writer            |
| `modules/telemetry/handler.js`            | `POST /api/v1/telemetry/event`, `GET /api/v1/telemetry/summary`           |
| `public/telemetry.js`                     | browser client: ids, consent switches, beacon transport                   |
| `lib/client-ip.js`                        | the app-wide client-address rule (`ba91c3f`, §7; extended in `6503261`)   |
| `tests/traffic-class.test.js`             | 25 tests — the classification matrix                                      |
| `tests/product-telemetry.test.js`         | 33 tests — the field contract                                             |
| `tests/client-ip.test.js`                 | 16 tests — proxy trust, spoofing, and rate-limit bucketing                |
| `tests/product-telemetry-browser.test.js` | headless Chrome smoke test                                                |

### Modified

| File                                           | Change                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| `server.js`                                    | `telemetryLimiter` (120/min/IP) + `router.register(createTelemetryModule(…))` |
| `lib/http.js`                                  | `readJson(req, { maxBytes })` — optional tighter per-route body cap           |
| `public/ortbtools.app.js`                      | emits `analyze_success`, `verify_email`                                       |
| `public/modules/auth/index.js`                 | emits `register`                                                              |
| `public/modules/macros/index.js`               | emits `macro_use` (copy click + override input, once per session)             |
| `public/modules/share/index.js`                | emits `share_use` (once per session)                                          |
| `public/{index,about,account}.{en,uk,ru}.html` | `<script src="/telemetry.js?v=1">` after `version.js` (9 files)               |
| `docs/PRIVACY.md`                              | TL;DR bullet + "Product telemetry" section + self-host table/Option C         |
| `docs/OPERATIONS.md`                           | §4.10 — DDL, owner exclusions, analysis SQL, verify, pause                    |
| `.env.example`                                 | 5 new vars documented                                                         |
| `lib/traffic-class.js`                         | CIDR matcher lifted out and shared with `lib/client-ip.js` (`ba91c3f`)        |
| `modules/telemetry/handler.js`                 | uses `resolveClientIp()` (`ba91c3f`)                                          |
| `auth.js`                                      | `clientIp()` delegates to `lib/client-ip.js` (`6503261`, §6)                  |
| `modules/stream/handler.js`                    | SSE per-IP cap keys on the resolved address (`6503261`, §6)                   |
| `modules/sentry-ingest/handler.js`             | ingest limit keys on the resolved address (`6503261`, §6)                     |

**Zero overlap with the pre-existing WIP.** Not one file in the commit is a file
the shim-removal WIP touches, which is what made it possible to ship Priority #0
on its own.

This document is deliberately **not committed**. `tests/brand-guard.test.js`
scans every _tracked_ file (`git ls-files`) for the retired name, and section 0
above quotes those identifiers on purpose. Committing this note would therefore
need a `FILE_ALLOWLIST` entry — in a file the WIP is also editing. Keeping the
note untracked avoids touching that shared file at all. If it is ever committed,
add `'walkthrough.md'` to `FILE_ALLOWLIST` in the same commit.

---

## 3. Acceptance criteria vs evidence

### "Жодних BidRequest/BidResponse у telemetry"

Structural, not best-effort. `buildRow()` reads a closed set of keys, validates
each against an enum / regex / numeric range, and returns a **fresh object
literal** — the input is never spread. There is no column that accepts free-form
text: the only strings are enums, a 32-hex id, a hostname and three UTM slugs
capped at 48 chars of `[a-z0-9._-]`.

Evidence:

- `tests/product-telemetry.test.js` → _"a valid event produces exactly the
  declared key set"_ (asserts `Object.keys(row)` equals `ROW_KEYS`).
- → _"extra caller fields never reach the row"_ — passes `bidReq`, `bidRes`,
  `adm`, `payload`, `msg`, `email`, `ip_address`, `path`, and a spoofed
  `traffic_class`/`app_version`; asserts none appear in the serialized row.
- → _"a getter cannot pass validation and then change the stored value"_.
- `tests/product-telemetry-browser.test.js` step 5 — pastes a real BidRequest
  containing `SECRET-DEAL-ID-42` and `confidential-publisher.example`, runs a
  real analysis, then asserts no captured beacon body contains the marker, the
  domain, `bidfloor`, the page path, or any undeclared key.

Also absent by construction: the client IP and User-Agent are passed to the
classifier and discarded — `tests/product-telemetry.test.js` → _"the transient
IP and User-Agent are classified, never stored"_.

### "Monitoring не рахується як користувач"

Two independent layers.

1. Health probes cannot run JavaScript, so they never reach the table at all.
2. Anything that does reach it is classified. `tests/traffic-class.test.js`
   pins the matrix: Uptime-Kuma, UptimeRobot, Prometheus, Blackbox Exporter,
   kube-probe, Better Uptime and Zabbix → `monitor`; GitHub-Actions and the
   repo's own smoke UA → `ci`; ClaudeBot / GPTBot / PerplexityBot /
   OAI-SearchBot → `agent`; Googlebot, curl, wget, python-requests, node-fetch,
   Go-http-client, PostmanRuntime, HeadlessChrome, AhrefsBot, Slackbot → `bot`;
   a missing User-Agent → `bot`. All have `is_external === false`.

### "Owner/agent traffic можна виключити"

Three mechanisms, all tested:

- `ORTBTOOLS_OWNER_IPS` — exact IPv4, IPv4 CIDR, literal IPv6. Env re-read per
  call, so a change takes effect without a restart (_"owner env changes take
  effect without a process restart"_).
- `ORTBTOOLS_OWNER_USER_IDS` — signed-in owner accounts.
- `?__ot_internal=1` — sticky per-browser flag; proven end-to-end in the browser
  test (step 7, including stickiness on the next load without the parameter).
  Automated callers can use `X-Ortbtools-Traffic: ci|agent|monitor|internal|owner|bot`.

**Security property:** a hint can only move a request OUT of `external`.
`external` is exclusively the fall-through result and no hint value maps to it.
`tests/traffic-class.test.js` → _"no client-supplied hint can promote a request
into external"_ tries every hint value plus `'external'`, `'EXTERNAL'`,
`' external '`, `'human'`, a number, and an object with a lying `toString`.
`tests/product-telemetry.test.js` → _"a bot cannot claim to be an external
user"_ covers the same through the full row builder.

Private, loopback, link-local, ULA and CGNAT (Tailscale `100.64/10`) addresses
classify as `internal`. Any address that cannot be positively identified as
public — `'unknown'`, a spoofed XFF token, a hostname — also lands on the
internal side, so the numbers under-count rather than inflate.

### "Доступні activation, repeat usage та D1/D7/D30 retention"

`GET /api/v1/telemetry/summary?days=30` (Bearer `ADMIN_STATS_TOKEN`) returns:

- `traffic` — the class split, i.e. the exclusion proof
- `activation` — external visitors with ≥1 `analyze_success`, plus `registered`
- `repeat_usage` — external visitors active on ≥2 distinct days
- `retention` — per acquisition-day cohort: `cohort_size`, `d1`, `d7`, `d30`,
  each with a `mature` flag so a 3-day-old cohort is never misread as 0% D7
- `daily` — visitors, sessions and analyses per day

All aggregates filter `is_external = 1 AND visitor_id != ''`. The equivalent raw
SQL is in `docs/OPERATIONS.md` §4.10 for when the endpoint is unavailable.

Retention is 180 days, so a D30 cohort still has its acquisition row in range
with room to plot a trend.

**The DDL and all four queries were executed against the live ClickHouse
server**, in an isolated `tmp_ortbtools_telemetry_check` database that was
created and dropped in the same run — `analytics.*` was never touched. A
synthetic fixture with a known answer (three external visitors, one of them
returning on d0+1/+7/+30, one on d0+1 only, one never; plus a `monitor` visitor
and a DNT row with an empty id) produced exactly the expected numbers:

```
activation:  visitors=3  activated=2  repeat_visitors=2  registered=0
retention:   cohort 2026-07-12  size=3  d1=2  d7=1  d30=1
traffic:     external 13 events / monitor 2 events   ← reported separately
daily:       4 rows; the monitor and DNT rows excluded from all of them
```

That run also caught a real defect: the traffic-split query used
`uniqExact(visitor_id)`, which counted the empty id (DNT / blocked storage) as
one extra shared "visitor". It now uses
`uniqExactIf(visitor_id, visitor_id != '')` in both the handler and the runbook.

Two environment notes for whoever repeats this: the server has `async_insert`
enabled, so a SELECT immediately after an INSERT reads nothing — pass
`--async_insert 0` when verifying by hand. And the app itself issues no DDL, so
the table must be created before any row can land.

**Verified again on the real table after deploy.** `GET /api/v1/telemetry/summary`
against production returned 401 without a token and, with one, the full shape
over live rows: the traffic split separating `external` from `internal`,
activation and repeat usage computed over external traffic only, and today's
cohort reporting `mature: false` on D1/D7/D30 — the maturity flag correctly
refusing to present "0%" as a finding.

### "Документація Privacy оновлена"

`docs/PRIVACY.md` gained a TL;DR bullet and a "Product telemetry (anonymous
counters)" section: the complete event list, the complete column list, what is
deliberately absent, how the identifier works, the three opt-out paths, and the
operator-side exclusions. The self-hosting table gained the new row and an
Option C for disabling just this table.

### Minimal event list from the plan

| Plan item                   | Event                                             | Emitted from                                       |
| --------------------------- | ------------------------------------------------- | -------------------------------------------------- |
| landing / session           | `landing`, `session_start`                        | `public/telemetry.js` on document load             |
| успішний analyze            | `analyze_success`                                 | `public/ortbtools.app.js` on `j.success`           |
| Macro / Share               | `macro_use`, `share_use`                          | `public/modules/{macros,share}/index.js`           |
| Diff                        | `diff_use`                                        | **reserved** — Priority #3 not built yet           |
| gist create / open          | `gist_create`, `gist_open`                        | **reserved** — Priority #2 not built yet           |
| registration / verification | `register`, `verify_email`                        | `public/modules/auth/index.js`, `ortbtools.app.js` |
| sanitized referrer / UTM    | `referrer_host`, `utm_source/medium/campaign`     | every event                                        |
| bot / internal markers      | `traffic_class`, `is_external`, `ua_class`, `dnt` | every event                                        |

The three reserved names are in the vocabulary so Priorities #2 and #3 can emit
without touching the privacy contract. `tests/product-telemetry.test.js` →
_"every wired event name appears at a real emit site"_ fails the build if a name
is declared wired but has no emitter, and _"the browser client and the server
share one event vocabulary"_ fails if the two lists drift.

---

## 4. Test results

Targeted:

```
node --test tests/traffic-class.test.js \
            tests/product-telemetry.test.js \
            tests/product-telemetry-browser.test.js
  → 59 tests, 59 pass, 0 fail, 0 skipped
    (25 classifier + 33 contract + 1 real headless-Chrome smoke, ~7s)
```

Full suite — `npm run ci` (`format:check && lint && typecheck && test:coverage`):

```
BEFORE this work:                 exit 0 — 1775 tests, 1765 pass, 0 fail
AFTER telemetry      (03a7fb5):   exit 0 — 1836 tests, 1826 pass, 0 fail
AFTER client-ip fix  (ba91c3f):   exit 0 — 1849 tests, 1839 pass, 0 fail
AFTER limit hardening(6503261):   exit 0 — 1852 tests, 1842 pass, 0 fail
Restored tree (all three commits + the shim-removal WIP on top):
                                  exit 0 — 1853 tests, 1843 pass, 0 fail
```

All three pushes went through the `.githooks/pre-push` gate, which runs the same
suite before it will let the push proceed.

The browser smoke test is skipped automatically when no Chrome/Chromium is
present; on this machine it ran for real (`/usr/bin/google-chrome-stable`), so
the 0-skipped count above is the genuine result, not a silent skip.

The browser smoke test proves, against the real page in real Chrome:

1. a first load emits `landing` + `session_start`;
2. a reload re-emits `landing` but **not** `session_start`;
3. `visitor_id` and `session_id` survive the reload and are 32-hex;
4. a real analysis emits `analyze_success`;
5. no beacon body carries the payload, the page path, or an undeclared key;
6. every beacon is answered `204` with an empty body;
7. `?__ot_internal=1` sets the flag and it is sticky;
8. `?__ot_optout=1` silences the client completely, deletes the stored id, stays
   silent on later loads, and makes an explicit `ortbtoolsTrack()` call return
   `false`.

Two real defects were found by these tests during development and fixed:
`Blackbox Exporter/0.25.0` (a space, not a dash) was classifying as `external`,
and an unparseable IP string was falling through to `external`.

---

## 5. Known limitations

1. **The app never issues DDL.** The table now exists, but a future schema
   change — or a fresh self-host — needs the statement in
   `docs/OPERATIONS.md` §4.10 run by hand. Until a table exists the writer
   buffers and the flush fails into a throttled pino error: no crash, no data.
2. **`ORTBTOOLS_TRUSTED_PROXIES` must match the real hop.** It is set to
   `172.24.0.1` for this deployment. If the Docker network is recreated with a
   different subnet, or the front end stops being cloudflared → `127.0.0.1:8090`,
   the value goes stale — and since `6503261` that no longer only blanks the
   metrics, it also collapses every per-IP limiter back into one shared bucket.
   The check is one query, in `docs/OPERATIONS.md` §4.10, and it is worth adding
   to the deploy smoke if this ever bites twice.
3. **Content blockers suppress everything.** There is no server-side fallback,
   by design. Ratios stay valid; absolute totals under-count.
4. **`ORTBTOOLS_OWNER_IPS` supports IPv4 CIDR only.** IPv6 must be listed as
   literal addresses. Documented in both the module and `.env.example`. It is
   currently **unset** — the owner's address is dynamic, so the practical way to
   exclude your own browsing is `?__ot_internal=1` once per browser.
5. **`landing` fires per document load, not per SPA navigation.** In-app
   navigation between sections does not emit a new event. That makes `landing`
   "documents loaded", not "screens viewed".
6. **No opt-out UI.** The opt-out is a URL parameter plus a localStorage key,
   documented in `docs/PRIVACY.md`. GPC/DNT is automatic. A settings toggle was
   out of the stated scope for this priority.
7. **`surface` is always `web`.** The `api` and `cli` values are reserved; direct
   API and CLI callers emit nothing (their volume is already in
   `validation_logs`).
8. **Summary endpoint auth reuses `ADMIN_STATS_TOKEN`.** It is not separately
   scoped. Without that env var it returns 503.
9. **The `mature` flag is computed from the server clock**, not from a stored
   cohort watermark. Cohort ages are day-granular UTC.
10. **`analyze_success` is client-attested.** It fires when `/api/analyze`
    returned success to that tab. The authoritative per-analyze count remains
    `analytics.validation_logs`.

---

## 6. The same defect keyed every rate limiter — also fixed (`6503261`)

The address `ba91c3f` fixed for telemetry was never telemetry's alone: it is the
value the whole app throttles on. Auditing every reader turned up **two opposite
bugs**.

**Too strict.** `auth.clientIp()` had the identical loopback-only assumption, and
it keys the login, register, reset, verify, analyze, behavior, intel and read
limiters, plus the address written to `event_log` and `sessions`. Since the peer
is always the Docker gateway, every visitor resolved to one address: those
limiters were per-IP in name only, sharing a single bucket for the whole
internet.

**Too lax.** `modules/stream` (SSE connections per IP) and
`modules/sentry-ingest` (GlitchTip ingest limit) each took the **leftmost**
`X-Forwarded-For` entry from **any** peer. Cloudflare appends to that header
rather than replacing it, so the leftmost entry is whatever the caller sent — a
client rotating a fake value got a fresh allowance every request, making both
caps decorative. `modules/stream` even carried a comment asserting the opposite,
on two counts: the leftmost hop is not client-proof, and the origin is reachable
from the host as well as through the tunnel.

Both now route through `lib/client-ip.js`. Three tests were added that exercise
the _bucketing_, not just the parsing: two visitors behind one proxy must not
share a bucket; a spoofed header from an untrusted peer must not mint a fresh
allowance; a client-supplied XFF prefix through the trusted proxy must not
either.

**Proven against the live server** with the 20/min behaviour limiter:

```
client A (198.51.100.10) ×22 → 200 ×20, then 429, 429
client B (198.51.100.20) ×1  → 200      ← unaffected by A's exhausted quota
client A again           ×1  → 429      ← still throttled
```

Before the fix B would have been 429 as well; both shared the gateway's bucket.

Root cause behind the root cause: `docs/OPERATIONS.md` §1 claimed `ortbtools.com`
reaches the app through kyivtech-portal. cloudflared routes that hostname
straight to `localhost:8090`. The same stale topology claim was repeated in the
`auth.js` comment, which is how the assumption survived. Both corrected.

One consequence worth naming: `event_log` and session rows now record the
visitor's real address rather than the proxy's internal one. That is what
`docs/PRIVACY.md` already described — until now the recorded value simply was not
the one documented. Called out explicitly there.

---

## 7. The defect the first deploy shipped

Worth recording, because no test caught it and no amount of local verification
would have.

`03a7fb5` went to production green: full CI, a real headless-Chrome smoke, and an
end-to-end run against the live ClickHouse in which classification was correct
for eight different traffic shapes. Then a single beacon fired at
`https://ortbtools.com` came back **`traffic_class = internal`,
`is_external = 0`** — identical to a localhost call.

Every real visitor would have been filed as internal. Activation, repeat usage
and retention would have read zero forever, and the table would have looked like
it was working.

Cause: `auth.clientIp()` believes `X-Forwarded-For` only when the TCP peer is
loopback, on the assumption that the proxy dials `127.0.0.1:8090`. It does — but
the published port (`127.0.0.1:8090 -> 3000`) makes Docker's userland proxy
re-originate the connection, so the container's peer is the bridge gateway:

```
Cloudflare edge → cloudflared (host) → 127.0.0.1:8090 → docker-proxy → container
                                                          peer = 172.24.0.1
```

Confirmed rather than assumed: the same `/api/v1/telemetry/summary` 401 fired
publicly and locally both landed in `analytics.ortbtools_events` with
`ip = 172.24.0.1`, and seven days of http rows held zero public addresses.

Fixed in `ba91c3f` by `lib/client-ip.js`, which believes `CF-Connecting-IP`
(Cloudflare overwrites it at the edge, so a client cannot forge it) or the
rightmost untrusted `X-Forwarded-For` hop — but only from a peer in
`ORTBTOOLS_TRUSTED_PROXIES`. Unset, it behaves exactly like the old loopback-only
rule, so a self-host trusts nothing by default. 13 tests cover it, including that
an untrusted peer can never claim a different address.

Re-verified in production after the second deploy:

```
public  request via Cloudflare → traffic_class=external, is_external=1   ✓
local   request via 127.0.0.1  → traffic_class=internal, is_external=0   ✓
```

The lesson for the remaining priorities: a deployment-topology assumption
written in a code comment ("the portal binds the container on 127.0.0.1:8090")
had gone stale, and only a request from the real internet could show it. The
follow-up in §6 came from asking the obvious next question — _what else reads
that value?_ — which turned one telemetry bug into three real ones.

---

## 8. Session paused here — start of the next one

Priority #0 is closed and live. The agreed next step is **finish the legacy-shim
WIP first, then start #2 (Shareable Encrypted Gists)** — paused before either
began.

**Why the WIP goes first, and why it is safe.** Its two user-visible side effects
were flagged in §0 as needing a decision. They were then measured, and both are
effectively zero:

| Risk flagged in §0                               | Measured                                               |
| ------------------------------------------------ | ------------------------------------------------------ |
| Removing `spy_session` signs out old sessions    | 1 session exists, 0 created before the rename → nobody |
| `db.js` drops the `spyglass.db` rename migration | No `spyglass.db` on disk → the code is already dead    |
| Local history / intel corpus lost                | <10 real page loads a day, essentially the owner only  |

Practical reason for the order: #2 needs a schema migration in `db.js`, and
`db.js` is one of the ten files the WIP is holding. Landing the WIP first avoids
a third round of the stash-park-restore dance this session used twice.

**Review status of the WIP.** The backend half was read and looks correct:
`auth.js` (drops the `spy_session` read and the paired `Set-Cookie` expiry),
`db.js` (drops the env fallback and the rename migration), and
`lib/analytics-enabled.js` (drops the old opt-out). **Not reviewed:**
`public/version.js`, `public/modules/intel/storage.js`, `public/export.js`,
`docker-compose.yml`, `scripts/deploy.sh`, `tests/auth.test.js`,
`tests/brand-guard.test.js` — read those before committing.

**State to resume from:**

- `main` = `6b4e1ed`, pushed. Production runs `6503261` — one commit behind, and
  deliberately so: `6b4e1ed` only adds `scripts/usage-report.sh` and docs, no
  application code, so a redeploy would restart the container for no behaviour
  change. It ships with whatever lands next.
- Working tree holds the WIP exactly as found: 10 modified files, `18 insertions,
168 deletions`, plus `.specify/assessments/{macro-evaluator,shareable-url-gists}/`
  and this file, all untracked.
- ClickHouse: `ortbtools_product_events` and `ortbtools_usage_daily` both exist
  and are empty. Counting starts honestly at 2026-08-12.
- `.specify/assessments/shareable-url-gists/` still holds only `intake.md`. Its
  four open questions are already answered by the roadmap brief (storage,
  encryption, 30-day TTL, anonymous creation), so #2 needs no separate
  clarification phase.
- Outside this repo: the Prometheus probe fix is applied and live but sits
  **uncommitted** inside the grafana-stack dashboard-redesign WIP. If that WIP is
  ever discarded, re-add `scrape_interval: 60s` to the `blackbox-external` job.

---

## 9. Not done in this priority

- Priorities #2–#5 untouched. `.specify/assessments/shareable-url-gists/` still
  contains only `intake.md`.
- The pre-existing shim-removal WIP is still uncommitted, exactly as found, with
  its two user-visible side effects still awaiting a decision (§0).
- `STREAM_MAX_CONNS_PER_IP` and the sentry-ingest limit now actually bind, where
  before they could be bypassed. If either turns out to be tuned for a world
  where it never fired, the number — not the mechanism — is what to revisit.
