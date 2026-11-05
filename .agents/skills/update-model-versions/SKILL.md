---
name: update-model-versions
description: Check existing AI model registries for genuine successor versions and, when authorized, update supported model IDs, schemas, pricing and tests. Use for model freshness checks or version bumps, not new model families or general dependency upgrades.
---

# Update model versions

Preserve the original workflow: check the TanStack AI adapter family, detect
candidate successors, verify their identity and contracts, apply one focused
upgrade, validate, and publish a PR only within the user's authorization.

## Scope and authorization

A request to check freshness is read-only. Dependency or model edits require
an update task; commits, pushes, PRs and issues require authorization covering
those actions in the current session. Honor authorization already given.
If only a report is requested, report prerequisite adapter updates instead of
installing them. This skill does not create a scheduled daily routine.

Use the shell/file, web research/HTTP, and repository capabilities actually
available in the session. Use a connected repository integration or an
available, authenticated `gh` CLI for GitHub work. Do not assume a fal MCP,
`genmedia`, Claude-specific tool, or permission grant exists. Do not install
or configure a CLI globally, persist provider keys, activate Ark models,
record paid fixtures, run paid generation, deploy, or write remote databases
as an implicit part of checking versions. Report a missing capability and
continue useful work within scope.

Read root `AGENTS.md` and `docs/secondary-development/extension-policy.md`.
Before changing the relevant area read `docs/architecture/media-vias.md`,
`docs/architecture/byteplus-ark.md` and, for configured/default text models,
`docs/architecture/model-configuration.md`. Follow their documentation update
rules when making a real model change. Keep upstream behavior, secondary
development and unverified behavior distinct.

## Current local sources

Recheck these paths and exports before each run; the migration baseline is
2026-11-05, not a promise that later checkouts have the same structure.

| Area                                | Source                                                                                                 | Contract                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Built-in text                       | `src/models/models.config.ts`                                                                          | `SCRIPT_ANALYSIS_MODELS` and text default constants      |
| Image                               | `src/models/models.ts`                                                                                 | `IMAGE_MODELS` and `EDIT_ENDPOINTS`                      |
| Video/motion                        | `src/models/models.ts`                                                                                 | `IMAGE_TO_VIDEO_MODELS` and `MOTION_REFERENCE_ENDPOINTS` |
| Audio/music                         | `src/models/models.ts`                                                                                 | `AUDIO_MODELS`                                           |
| Native Ark                          | `src/models/models.ts`                                                                                 | `byteplusId` alongside a fal endpoint `id`               |
| Native Google/xAI                   | `src/models/gemini-native.ts`, `src/models/grok-native.ts`                                             | Native mappings, capabilities and rates                  |
| Secondary-development defaults/text | `src/models/model-configuration.ts`, `src/models/text-model-catalog.ts`, `src/models/text-channels.ts` | Default slots, merged catalog and administrator bindings |

The static registries are the check script's input, not the entire live model
configuration. Do not rewrite administrator bindings, credentials, saved
selections or workflow snapshots as a side effect of a catalog bump.

## 1. Check the adapter prerequisites

From the repository root:

```sh
bun outdated '@tanstack/ai*'
```

For an authorized upgrade, inspect current Latest releases and changelogs,
then update the installed `@tanstack/ai`/`@tanstack/ai-*` family coherently
with its peer dependencies, including the `@tanstack/ai-devtools-core`
override. Do not assume independently released packages share a version.
Keep this dependency upgrade separate from a model upgrade. Other dependency
bumps are outside scope except an actual adapter compatibility requirement.

- `@openrouter/sdk` is exactly pinned in `package.json` and currently matches
  `@tanstack/ai-openrouter`'s dependency. Keep the adapter and SDK types
  compatible; check the installed manifest/lockfile rather than inventing a pin.
- The old `patches/@tanstack%2Fai-grok@...patch` reference is stale: there is
  currently no `patches/` directory or `patchedDependencies` configuration.
  Do not recreate a patch by habit. Check the installed adapter and
  `src/models/server/grok-prompt-cap-patch.test.ts` if upgrading Grok.
- Existing `CATALOG_LAG_MODELS`, `GROK_CATALOG_LAG_MODELS` and
  `GEMINI_CATALOG_LAG_MODELS` are in `src/models/server/create-adapter.ts`.
  Prune only entries now supplied by the adapter, following the actual
  `src/models/server/catalog-lag.test.ts` checks. Do not add bridges, casts
  or adapter patches to make a new successor pass the support gate.

After an authorized dependency edit run `bun install`, `bun typecheck`,
`bun lint` and `bun run test`. If adapter migration needs unrelated changes,
stop that upgrade and report the blocker; create an issue only if authorized.
The model check can still run against installed adapters, with that limit
stated. If a dependency PR is authorized, model PRs needing it must use its
validated branch/base; do not silently test against an older adapter base.

## 2. Detect candidates

```sh
bun models:check
bun models:check --json
```

Both commands exist in `package.json` and run
`scripts/check-model-updates.ts`. It queries public fal/OpenRouter catalogs
without provider keys and compares Ark IDs offline with installed
`@tanstack/ai-byteplus` catalogs. With a proxy configured it uses system
`curl`; investigate connectivity without printing secrets or changing global
proxy/trust settings.

Inspect `ok`, `errorCount`, `hasUpdates` and `models`. A nonzero exit code,
`ok: false` or any lookup error means incomplete evidence. Diagnose and retry
when there is a concrete fix; if access remains unavailable, report the
failed sources rather than retrying indefinitely or claiming freshness.

Candidates are heuristics, not confirmed upgrades. Even `ok: true` and
`hasUpdates: false` mean only that the scanned static IDs had no detected
successors. The script does not audit administrator-configured/custom text
bindings or independently establish native Google/xAI/ElevenLabs freshness;
Ark freshness is limited by the installed adapter catalog.

## 3. Verify genuine successors

For each candidate record the current ID, proposed ID, source and retrieval
date. Use live official catalogs/docs and the installed adapter's types.

- **fal:** read `https://fal.ai/models/{model-path}/llms.txt` and the OpenAPI
  document at
  `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id={encoded-id}`.
  Compare parameters, reference/edit routes, limits and pricing. HTTP 200
  confirms a schema exists, not that the account can generate successfully.
  A connected provider tool may supply discovery/schema/pricing only when
  its real tools and read permissions are available; it is optional.
- **Text:** confirm the ID in `https://openrouter.ai/api/v1/models` and the
  applicable native provider docs. Verify context/output limits, vision,
  tools and structured output; a configured compatible endpoint is a
  separate contract, not proof of native adapter support.
- **Ark:** compare the installed BytePlus catalog/model metadata with live
  ModelArk model docs and the official rate table
  `https://docs.byteplus.com/en/docs/ModelArk/1544106`. Compare actual
  resolution/duration tiers and billing units. Snapshot dates and tier
  suffixes need interpretation; `-fast`/`-mini`/`-lite`/`-pro` are different
  products. Console activation/`ModelNotOpen` and real-account availability
  remain unverified without a separately authorized account check.

Reject a tier/product/modality switch, trainer/LoRA/edit-only variant, or
preview replacing stable. Skip ambiguous or materially incompatible changes
and explain the decision. A newly adopted ID must already be supported by
the relevant installed adapter. Existing lag bridges do not authorize new
ones. Do not introduce provider fallback to make a bump appear to work.

## 4. Apply one authorized upgrade

Check local branches/worktree changes and existing PRs for this exact
old-ID/new-ID pair before editing. Search the actual target repository
inferred from remotes; `origin` and `upstream` serve different purposes.
If `gh` is available, `gh pr list --state open --search "in:title model"`
is a starting point, not a complete duplicate check. Reuse an existing PR
branch only when working on it is authorized. Preserve unrelated edits.

**Media keys stay stable.** Change endpoint IDs/metadata, never object keys
in `IMAGE_MODELS`, `IMAGE_TO_VIDEO_MODELS` or `AUDIO_MODELS`: those keys are
persisted selections. Text is different: `SCRIPT_ANALYSIS_MODELS` is an
array and its `id` is the identity. `DEFAULT_ANALYSIS_MODEL` directly holds
a model ID, not an unaffected alias. Inspect references, native mappings,
code defaults and saved/configured selection compatibility before replacing
an ID. If the compatibility policy is unclear, report it for a decision;
do not invent a migration or silently remap stored data.

- **Text:** update the real metadata fields, including `contextWindow`,
  `maxOutputTokens` and capabilities when applicable. Check Google/xAI native
  mappings and rates if the built-in model has them. The existing
  `bun scripts/update-openrouter-pricing.ts` regenerates
  `src/billing/openrouter-pricing-data.ts` for static models; it writes a
  source estimate table, not live billing or configured-channel rates.
- **Image:** update ID, label, description and supported limits; follow
  `EDIT_ENDPOINTS` and verify reference/edit support. `maxPromptLength` is
  generally a recommendation; preserve the separate enforced-limit contract.
- **Motion:** update ID/metadata and affected `MOTION_REFERENCE_ENDPOINTS`,
  including text-to-video routes where applicable. Run `bun motion:codegen`
  instead of hand-writing schemas. It runs `scripts/pull-motion-schemas.ts`
  and creates `json/fal.models.motion.json` as an intermediate (absent in
  this checkout until generation), then writes `src/motion/server/generated/`
  and `src/motion/server/endpoint-map.ts`.
  Inspect the diff and prompt limits; codegen fetches public schemas and
  does not validate real generation. Ark requests do not use fal codegen.
- **Audio:** update ID, metadata and actual `capabilities` fields such as
  durations/formats against the new schema. Do not infer voice/music support
  from a shared brand.
- **Ark-routed media:** preserve the paired fal `id` and `byteplusId` upgrade
  under the same stable key. If no verified equivalent exists for both,
  defer the bump instead of silently leaving routes on different versions.
  Update `src/billing/byteplus-pricing.ts` at the exact Ark ID and correct
  tier; date and label advertised rates as unverified against invoices.
  Check `applyBytePlusRouteAliases` in
  `src/billing/server/fal-pricing-live.ts` and any matching
  `ENDPOINT_STRATEGY` entries in `src/billing/fal-cost.ts`. Recheck
  `src/motion/server/build-byteplus-video-request.ts` and
  `src/stills/build-byteplus-image-request.ts` for frame/reference-role,
  resolution and watermark assumptions. Do not add a user-owned Ark key.
- **Fixtures:** inspect `e2e/fixtures/recorded/fal/` endpoint-keyed paths and
  each fixture's `match.model`. Reuse/rename recordings only if their request
  and response contracts still fit; disclose replay reuse and do not present
  it as a live result from the successor. Re-recording can spend money.

**fal pricing correction:** `scripts/update-fal-pricing.ts` does not exist,
and its old manual-override fallback is not a current documented interface.
The real `bun scripts/refresh-fal-pricing.ts` requires `FAL_KEY`, fetches
provider data and writes the default local D1 `model_pricing` cache/history;
`--test` selects local test D1. An optional billing key enables billed-rate
verification. Run it only when the task authorizes that local data write.
Do not turn it into a remote write or invent a replacement override. If
pricing cannot be verified, state the gap; do not report a ready upgrade.
Keep supplier currency/units intact; a version bump does not implement CNY
sales pricing, wallet rules or currency conversion.

## 5. Validate and deliver

For an implemented model bump, before calling it ready:

```sh
bun typecheck
bun lint
bun run test src/models src/motion
bun run test src/billing
```

Run affected image/audio/request-builder tests and the checks required by
`AGENTS.md` as appropriate. Billing tests are necessary for changed rates
or pricing routes. Report baseline failures separately; never bypass hooks,
cast away unsupported IDs or broaden the diff to force green. Substantial
schema/pricing/product changes require a scoped follow-up, not a disguised
version bump. An issue draft can be returned in the report when external
issue creation is not authorized.

For an authorized PR, use the project's current branch conventions and
secondary-development base (`develop` unless the actual authorized work
requires another base). The old `auto/model-update-*` and
`auto/tanstack-ai-*` branch examples are not this project's branch policy.
Stage only reviewed files, never blanket `git commit -am` over a shared
worktree. Do not add AI/tool co-author trailers or the old daily-automation
signature. Push/open or update the PR only within the session's authorization;
attach the created PR with the available app capability when required.
Do not auto-merge. Required gates must pass for ready-for-review; unresolved
verification may be described in an authorized draft PR.

The report/PR body must state each registry key or text identity, old/new
IDs, successor evidence links and dates, adapter support, supplier pricing
delta and verification level, generated/fixture changes, checks actually
run, skipped candidates and remaining limits. Distinguish local unit/replay
checks from real provider, database, account and deployment acceptance.
