# Contract: Sentry Local Configuration and Health

## Logger Initialization

`lib/logger.js` may initialize server-side `@sentry/node` only when `SENTRY_DSN` is present and
`NODE_ENV` is not `test`. Source comments and operator copy describe a generic Sentry-compatible
destination and must not claim that a particular self-hosted service or filesystem path is active.
Initialization retains the existing settings:

- environment derived from `NODE_ENV`;
- release derived from `BUILD_SHA` with a development fallback;
- `tracesSampleRate: 0`; and
- `sendDefaultPii: false`.

The wrapper is ready only when the active SDK client exposes a parsed DSN after initialization. An
absent DSN, malformed DSN, missing usable client/DSN API, or thrown initialization error leaves it
not ready. Observability failure must never crash application boot or callers.

## Public Wrapper Contract

The existing exports remain compatible:

- `logger` and `child(component)` provide Pino logging;
- `captureException(error, context?)` never throws and no-ops when not configured;
- `flushSentry(timeout?)` resolves without failing the caller and no-ops successfully when not
  configured; and
- `sentryReady()` returns the local configuration boolean.

Context must remain explicitly selected by callers. This feature does not add request bodies,
headers, cookies, IP addresses, consent strings, credentials, or automatic PII capture.

## Health Contract

`GET /api/health` retains:

```json
{
  "sentry": { "ready": false }
}
```

The boolean means exactly:

> This server process initialized the SDK and retained a syntactically valid local Sentry-compatible
> destination.

It does not mean that the destination is reachable, credentials are accepted, an envelope was
ingested, events are retained, alerts are configured, or delivery is healthy. The health handler
must not expose the DSN host, project identifier, credentials, or initialization error. Database
health remains the source of the endpoint's HTTP status.

## Deterministic Test Contract

- Disabled state is covered in an isolated production-shaped child process with `SENTRY_DSN`
  explicitly removed, regardless of the parent shell environment.
- Malformed configuration is evaluated in an isolated production-shaped child process and reports
  false without crashing.
- Valid configuration uses a synthetic `.invalid` destination and replaces SDK transport with an
  in-memory implementation before the logger loads.
- The valid case exercises SDK initialization options, scope/context attachment, capture, bounded
  flush, and readiness; it asserts one in-memory envelope and performs no network request.
- The health handler is tested with injected true and false states.

## Operations Boundary

`.env.example` and `docs/OPERATIONS.md` must use the same local-only meaning. End-to-end delivery is a
separate controlled operator check against the configured target after an explicitly authorized
deployment/configuration change. Telegram remains independent of the Sentry state.

This feature does not alter tracing, browser ingest, process-level capture call sites, payload
retention, deployment readiness gates, or production configuration.
