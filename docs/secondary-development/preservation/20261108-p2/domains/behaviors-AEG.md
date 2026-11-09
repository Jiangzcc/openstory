# P2 AEG behavior review

Baseline: 2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0. Execution start: ce321c885f67e40fec1c8598bb759790d89359c9. The original 2026-11-08 partition contains 259 assigned net paths and 8 merge-resolution groups.

## Follow-up scope (2026-11-09)

This follow-up corrects 9 responsibility mismatches, registers 2 omitted schema changes and aligns 1 companion schema test. The 12 exact replacement records are [aeg-record-corrections.json](../followup-20261109/aeg-record-corrections.json); their original assertions, intentional replacements and evidence limits are in [assertion-trace-AEG.md](../followup-20261109/assertion-trace-AEG.md). The parent integrates the shared candidate manifest; this file does not assert that integration has already happened.

The eight original groups below remain a historical domain index. Their shared summaries are not a per-block proof for all 259 paths. The focused follow-up did not re-review every AEG source, historical assertion or F page. Continue billing is explicitly deferred by the user and is outside this document repair.

## AEG-01

- Upstream: Upstream session authentication, organization membership/roles, invitations, selection and shared wallets remain the authority.
- Current: Adds locale-aware auth/email presentation and identity-bound asynchronous admin cache invalidation; invitation recipients, actions and organization APIs remain.
- Requirement: AGENTS.md; docs/secondary-development/confirmation.md; localization-plan.md; system-prompt-localization.md; upstream-preservation-plan.md
- Disposition: preserve; the original path index is [candidates.jsonl](../candidates.jsonl).

## AEG-02

- Upstream: Workflow triggers use organization-scoped durable payloads, claim-guarded writes, named read hatches and child propagation.
- Current: Makes promptLocale and configuration snapshots explicit; carries actual LLM credential provenance across durable failures, without re-resolving a different current key.
- Requirement: AGENTS.md; docs/secondary-development/confirmation.md; localization-plan.md; system-prompt-localization.md; upstream-preservation-plan.md
- Disposition: preserve; the original path index is [candidates.jsonl](../candidates.jsonl).

## AEG-03

- Upstream: Assistant uses the shared MCP tools under the authenticated session, schema validation, approval/resume, SDK connection and tool billing contracts.
- Current: Adds model/capability routing and locale bridges; hardens transcript vision checks, approval identity and response/error preservation while retaining shared MCP tools and normal spending.
- Requirement: AGENTS.md; docs/secondary-development/confirmation.md; localization-plan.md; system-prompt-localization.md; upstream-preservation-plan.md
- Disposition: preserve; the original path index is [candidates.jsonl](../candidates.jsonl).

Focused schema/approval tracing: [retained auth/API/MCP/assistant assertions](../followup-20261109/assertion-trace-AEG.md#retained-auth-api-mcp-assistant-assertions).

## AEG-04

- Upstream: Authenticated API keys and OAuth/session principals retain distinct scope and production-access contracts; external MCP is retained.
- Current: Validates the key before classifying the principal, keeps admin API-key cross-organization access and session/OAuth organization scope, and propagates fixed external versus cookie internal prompt locale.
- Requirement: AGENTS.md; docs/secondary-development/confirmation.md; localization-plan.md; system-prompt-localization.md; upstream-preservation-plan.md
- Disposition: preserve; the original path index is [candidates.jsonl](../candidates.jsonl).

The sequence card belongs to AEG-09; the custom storyboard model refinement belongs to AEG-18. API-key classification is not a description of those changes.

## AEG-05

- Upstream: Upstream tooling, build/runtime compatibility date and local Cloudflare isolation remain the baseline.
- Current: Adds project-only Codex/i18n tooling and Windows support; keeps dependency upgrades, test-local DB guards, preview CAS/delete race protections and workflow-trigger checks.
- Requirement: AGENTS.md; docs/secondary-development/confirmation.md; localization-plan.md; system-prompt-localization.md; upstream-preservation-plan.md
- Disposition: preserve; the original path index is [candidates.jsonl](../candidates.jsonl).

The product player surface belongs to AEG-10 rather than this engineering group.

## AEG-06

- Upstream: Upstream English labels, arbitrary user/provider text and external protocol values remain the semantic source.
- Current: Introduces English-source translation keys, per-request/runtime locale, persisted cookie and namespace resources with default Simplified Chinese UI and external English prompts.
- Requirement: AGENTS.md; docs/secondary-development/confirmation.md; localization-plan.md; system-prompt-localization.md; upstream-preservation-plan.md
- Disposition: preserve; the original path index is [candidates.jsonl](../candidates.jsonl).

## AEG-07

- Upstream: Architecture documentation describes upstream capabilities and existing current source contracts.
- Current: Records implemented locale/model bridges, preservation history and evidence boundaries; cancelled personal-wallet/commercial-gift/admin-no-browsing proposals stay cancelled.
- Requirement: AGENTS.md; docs/secondary-development/confirmation.md; localization-plan.md; system-prompt-localization.md; upstream-preservation-plan.md
- Disposition: preserve; the original path index is [candidates.jsonl](../candidates.jsonl).

## AEG-08

- Upstream: Public create/enhance/upload/export/stitch flows retain organization scopes, validation, rights checks and publication checks.
- Current: Threads mandatory prompt locale and configured model defaults through existing handlers; localized stitch/player controls preserve media and URL semantics.
- Requirement: AGENTS.md; docs/secondary-development/confirmation.md; localization-plan.md; system-prompt-localization.md; upstream-preservation-plan.md
- Disposition: preserve; the original path index is [candidates.jsonl](../candidates.jsonl).

Public image-model input validation is recorded separately in AEG-17. Feedback/search belong to AEG-11/12; import guards and log-context tests belong to AEG-13 through AEG-16. They must not inherit the public-create summary.

## AEG-09

- Paths: `src/platform/server/mcp/ui/sequence-card.ts`, `src/platform/server/mcp/ui/sequence-card.test.ts`.
- Upstream: The MCP sequence card initializes with the host, renders result text and server diagnostics, polls status only when server tools are available, announces completion once, and opens the sequence through the host.
- Current: Adds host-locale labels, known status/count labels, mapped template-style names and poster alt text. Host-context changes repaint the current result and error without restarting polling or sending another completion message; user titles, unknown statuses/counts and protocol methods remain data.
- Requirement: docs/secondary-development/localization-plan.md; docs/secondary-development/extension-policy.md §4; docs/architecture/assistant.md (MCP App context).
- Disposition: preserve the documented bridge or intentional validation change; correct the prior unrelated summary.
- Evidence: [specific original assertions and limits](../followup-20261109/assertion-trace-AEG.md#aeg-09-mcp-sequence-card). Replaces the unrelated API-key/OAuth summary. Compared the six upstream card behaviors with current assertions, including the bilingual polling replacement. This is static source/assertion tracing plus archived unit evidence, not a new embedded-host browser run.

## AEG-10

- Paths: `packages/stitch/src/stitched-player-surface.tsx`.
- Upstream: StitchedPlayerSurface composes VideoPlayer, captions and the optional Download control. Playback, download and export-progress accessible labels are fixed English strings.
- Current: Adds optional playback/download/exporting labels and an I18nProvider around the existing VideoPlayer. Existing English fallback labels, media/cue inputs, download operation and event callbacks remain in the same implementation.
- Requirement: docs/secondary-development/localization-plan.md; docs/secondary-development/extension-policy.md §4.
- Disposition: preserve the documented bridge or intentional validation change; correct the prior unrelated summary.
- Evidence: [specific original assertions and limits](../followup-20261109/assertion-trace-AEG.md#aeg-10-stitched-player-surface). This is a product-player presentation bridge, not tooling or Worker configuration. The complete B-to-P2 surface diff was checked. A dedicated upstream/current rendering assertion was not established for this component in this follow-up; no media playback, export or browser acceptance is inferred.

## AEG-11

- Paths: `src/platform/ui/feedback/feedback-dialog.tsx`.
- Upstream: FeedbackDialog submits the entered message and optional contact through the existing feedback mutation, preserves pending/success/error states, and resets state when the dialog closes.
- Current: Translates fixed headings, labels, placeholders, button states and the non-Error failure fallback. The message, contact, mutation payload, actual Error.message and submit/reset handlers are unchanged.
- Requirement: docs/secondary-development/localization-plan.md; docs/secondary-development/extension-policy.md §4.
- Disposition: preserve the documented bridge or intentional validation change; correct the prior unrelated summary.
- Evidence: [specific original assertions and limits](../followup-20261109/assertion-trace-AEG.md#aeg-11-feedback-dialog). Replaces the unrelated public sequence/upload/publish summary with the feedback form contract. Net-diff inspection supports a presentation-only change; no dedicated upstream/current feedback interaction assertion was established or executed here.

## AEG-12

- Paths: `src/platform/ui/search/search-dialog.tsx`.
- Upstream: SearchDialog queries organization search by the trimmed term, retains debounce/cancellation and previous data, groups returned hits, and follows the existing hit links.
- Current: Translates fixed search headings, status/empty messages, group labels and input accessibility text. The raw term remains an interpolation value; query key/function, thresholds, hit data, target URLs and navigation handlers are unchanged.
- Requirement: docs/secondary-development/localization-plan.md; docs/secondary-development/extension-policy.md §4.
- Disposition: preserve the documented bridge or intentional validation change; correct the prior unrelated summary.
- Evidence: [specific original assertions and limits](../followup-20261109/assertion-trace-AEG.md#aeg-12-search-dialog). Replaces the unrelated public create/upload/publish summary with the search presentation contract. The B-to-P2 diff was checked against SearchDialog and hitLink. This does not certify live search, organization isolation or keyboard interaction in a browser.

## AEG-13

- Paths: `src/platform/client-server-boundary.test.ts`.
- Upstream: The client/server boundary test scans retained client imports, treats server directories/API routes and server-only packages as restricted, and requires no leaked server dependency from client roots.
- Current: Normalizes project-relative Windows paths, traverses script files rather than JSON resources, and allowlists only the official @tanstack/ai/client browser entry. Root @tanstack/ai, adapters and testing stay server-only; positive/negative classifier and traversal assertions are added.
- Requirement: AGENTS.md (client/server boundaries); docs/secondary-development/assistant-approval-fix.md §改动范围; docs/secondary-development/upstream-preservation-plan.md §4.2 G.
- Disposition: preserve the documented bridge or intentional validation change; correct the prior unrelated summary.
- Evidence: [specific original assertions and limits](../followup-20261109/assertion-trace-AEG.md#aeg-13-client-server-boundary). This is an architectural guard extension, not a public creation endpoint. Original retained-import and no-leak assertions remain; path formatting in diagnostic trails changes. The new explicit browser-entry, separator and script/resource assertions are located in the trace.

## AEG-14

- Paths: `src/platform/domain-blind.test.ts`.
- Upstream: The domain-blind guard reads composition roots from oxlint and rejects platform value imports of product domains outside those roots.
- Current: Normalizes backslashes to forward slashes in resolved import targets and repo-relative file paths. Composition-root selection, domain rules and original nonempty-roots/no-offenders assertions remain.
- Requirement: AGENTS.md (src/platform is domain-blind); docs/secondary-development/upstream-preservation-plan.md §4.2 G.
- Disposition: preserve the documented bridge or intentional validation change; correct the prior unrelated summary.
- Evidence: [specific original assertions and limits](../followup-20261109/assertion-trace-AEG.md#aeg-14-platform-domain-blind). This is Windows portability of the architecture test, not public API behavior. The two changed expressions are path normalization; no baseline expect assertion is removed or replaced.

## AEG-15

- Paths: `src/platform/log-context.test.ts`.
- Upstream: Log-context tests retain tracing-header extraction, contextLocalStorage configuration and nested context stamping across awaited work.
- Current: Adds a concurrent-request test with separate request/user/session markers and awaited interleaving. It asserts two records and each record retaining its own user and session identifiers; existing tests and the production log-context module are unchanged by this path.
- Requirement: docs/secondary-development/upstream-preservation-plan.md §4.1 and §4.2 G (preserve engineering and request-state contracts).
- Disposition: preserve the documented bridge or intentional validation change; correct the prior unrelated summary.
- Evidence: [specific original assertions and limits](../followup-20261109/assertion-trace-AEG.md#aeg-15-log-context). This is an additive isolation regression, not public sequence creation behavior. Original assertions remain; the new concurrent assertions are explicitly identified. Timing is synthetic test scheduling, not production concurrency acceptance.

## AEG-16

- Paths: `src/platform/server/db/db-access-allowlist.test.ts`.
- Upstream: The DB import guard compares all value-import users of raw DB handles and ScopedDb factories to explicit allowlists.
- Current: Normalizes Windows separators in resolved raw-DB imports, resolved ScopedDb imports and scanned file paths. The RAW_DB_ALLOWLIST/SCOPED_FACTORY_ALLOWLIST contracts and exact set-equality assertions are unchanged.
- Requirement: AGENTS.md (no-raw-db and no-scoped-factory); docs/secondary-development/upstream-preservation-plan.md §4.2 G.
- Disposition: preserve the documented bridge or intentional validation change; correct the prior unrelated summary.
- Evidence: [specific original assertions and limits](../followup-20261109/assertion-trace-AEG.md#aeg-16-db-access-allowlist). This is portability of the DB access guard, not the public create/upload contract. All three source changes normalize paths; the original allowlist assertions remain intact.

## AEG-17

- Paths: `src/platform/server/api-v1/input-schema.ts`, `src/platform/server/api-v1/input-schema.test.ts`.
- Upstream: apiCreateSequenceSchema accepts a nonempty imageModels array of strings at the public schema boundary; the original supplied-options fixture uses flux-pro. That schema-level acceptance does not establish that an arbitrary name could complete generation.
- Current: Uses imageModelIdSchema for each image model, admitting built-in and valid custom-image identities while rejecting unknown or empty custom identities. The supplied-options fixture uses flux_2_dev and new tests explicitly cover custom-image:qwen, no-such-model and custom-image:. Model descriptions also identify configured defaults.
- Requirement: docs/secondary-development/image-channels.md; docs/architecture/model-configuration.md; docs/secondary-development/upstream-preservation-plan.md §4.1 (intentional input-contract and assertion changes).
- Disposition: preserve the documented bridge or intentional validation change; correct the prior unrelated summary.
- Evidence: [specific original assertions and limits](../followup-20261109/assertion-trace-AEG.md#aeg-17-public-api-image-model-schema). Registers the previously omitted public input-validation change separately from locale/default propagation. The fixture replacement is deliberate valid-identity adaptation, not evidence that flux-pro was a routable upstream model. The linked trace distinguishes unchanged supplied-option assertions from new admission/rejection assertions.

## AEG-18

- Paths: `src/platform/server/mcp/tools/structure-edits.ts`.
- Upstream: The regenerate_storyboard MCP input refines analysisModel with the built-in analysis-model validator, then uses the existing organization-scoped shared create path. The module also exposes sequence creation and shot updates.
- Current: Extends the storyboard analysisModel refinement to recognize custom analysis-model identities. Threads promptLocale into shared sequence creation and shot-edit context. Resource access and downstream creation remain in existing services; namespace acceptance alone does not prove a configured provider binding is available.
- Requirement: docs/architecture/model-configuration.md; docs/secondary-development/text-channels.md; docs/secondary-development/system-prompt-localization.md.
- Disposition: preserve the documented bridge or intentional validation change; correct the prior unrelated summary.
- Evidence: [specific original assertions and limits](../followup-20261109/assertion-trace-AEG.md#aeg-18-mcp-storyboard-model-schema). Registers the custom-analysis schema branch separately from MCP authentication. The general MCP tools test only gains promptLocale fixtures, preserving original assertions; that is not direct evidence for the new custom-storyboard branch. This follow-up does not claim a dedicated MCP custom-model execution test; the parent should associate applicable C-domain evidence or leave that scenario explicitly unverified.

## Recorded evidence and current limits

The original 2026-11-08 owner record reported 50 unique test files and 817 passing cases (424 core, 271 assistant/engineering, 122 hooks). Those are historical results, not a new follow-up execution. Portable per-file cases are in [unit-verification.json](../unit-verification.json); this follow-up relies on actual source/assertion mapping rather than an absent execution-machine log.

The original record also reports 1117 P0 blob-pair equalities, 4541 resolved import-candidate edges and 10 unchanged core auth/org/API/MCP paths. These are structural checks, not a substitute for indirect runtime or per-block review. The guarded E2E burst window remains a separately recorded limitation; this owner did not repeat the parent's engineering/E2E review.

The focused follow-up found recording gaps and did not confirm a new code defect or loss of the explicitly traced upstream assertions. Source and assertion tracing are distinct from archived unit results and from browser acceptance. Dedicated player/feedback/search interactions and the MCP custom-storyboard execution branch are not promoted to passed here.

Organization roles, invitation and shared wallet behavior remain upstream reuse; full BYOK removal, CNY selling prices and default private assets are not implemented by this repair. The 2026-11-08 documentation corrections for the cancelled personal-wallet plan and the actual modelOptionsFor helper remain historical fixes.

This follow-up edits audit documents only. It performs no runtime test, browser/service launch, provider call, email, remote DB operation, commit, push or deployment. It does not certify every nontrivial behavior in the 259-path partition; the exact inspected behaviors and remaining scope are recorded in the linked trace.
