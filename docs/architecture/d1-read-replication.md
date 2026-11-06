# D1 read replication (#2233)

Production D1's primary is in Oceania. Before this, every query from a Worker
outside Australia paid a 200–340 ms round trip for ~0.3 ms of SQL. Read
replication puts replicas near the user; the Sessions API keeps a user's reads
consistent with their own writes.

## How a request reads

- `src/start.ts` installs `d1SessionMiddleware` as a request middleware, so it
  wraps every server route, server function and SSR render.
- The middleware opens `env.DB.withSession(start)` and keeps it in an
  `AsyncLocalStorage` (`src/platform/server/db/d1-session.ts`). The drizzle
  handle from `#db-client` delegates `prepare` / `batch` to that session while
  one is open, else to the primary. Nothing else changes: `scopedDb`, Better
  Auth and the raw-handle readers all go through the same handle, so the
  db-access allowlists are untouched.
- `start` is the `d1_bookmark` cookie when the browser sends one. Without it,
  a request carrying `Authorization` or `x-api-key` (API, MCP, CLI, which keep
  no cookies) starts `first-primary`, so its first query already sees the
  call before it; a bare browser request starts `first-unconstrained`.
- When the session's bookmark moved, the response sets `d1_bookmark` (5 min,
  HttpOnly). The next request reads at or after it: read-your-writes and
  monotonic reads across requests, with no change to any handler.
- A write inside a session is forwarded to the primary by D1 itself.

## What stays on the primary

- Anything outside an HTTP request: Workflows, cron, `scheduled()`. No
  session is open, so the handle is the primary. Workflows already take no
  mid-run reads (`WorkflowScopedDb`); the `liveRead` hatches run on the
  primary for the same reason.
- Money reads, in any context: `billing.getBalance` / `getAvailable` / `redeemGiftToken` /
  `hasEnoughCredits` wrap themselves in `onPrimary`, which pins the handle to
  the primary for that call. A replica can lag by seconds, which is enough to
  pass a spend another session just made.

Pin a new read with `onPrimary(() => …)` only when a few seconds of lag would
let two sessions both pass a guard. Everything else reads from the replica.

## Secondary-development model settings

Default-model configuration, text-channel metadata, catalog validation and encrypted channel credentials also use `onPrimary`. They determine the route for a new operation: an old read must not revive a channel after it was disabled. Concurrent responses can overwrite the browser bookmark out of order, and a fresh browser session has no bookmark from the administrator's earlier save. The narrow primary boundary is in the model DB modules; workflow execution continues to use its recorded routing and immutable credential IDs. The adversarial review and mock-versus-remote evidence boundary are recorded in `docs/secondary-development/adversarial-review-20261105.md`.

## Turning it on

Replication is a per-database setting, not code: enable it on `openstory-prd`
(dashboard → D1 → Settings → Read replication, or `PUT
/accounts/{id}/d1/database/{id}` with `read_replication.mode: "auto"`). With
it off, the session code runs unchanged against the primary alone. Local
Miniflare has no replicas; the Sessions API still works.

## Measure

Re-run the per-location D1 wall-time query on `posthog.trace_spans`
(`name LIKE 'd1_%'`, joined to the root span's `cloudflare.colo`). The
`served_by_region` / `served_by_primary` fields on each D1 result say which
side answered.

## Known lag

Session, API-key and membership lookups read the replica like everything
else, so a revoked session or key can pass for the replica's lag (seconds)
after the revocation. Pinning auth to the primary would put the Australia
round trip back on every request, which is what this change removes; the
lag is accepted. A keyed request is on `first-primary` whatever cookie it
sends, so it is not affected.
