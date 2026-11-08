# P2 AEG behavior review

Baseline: 2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0. Execution start: ce321c885f67e40fec1c8598bb759790d89359c9. Reviewed 259 assigned net paths and 8 merge-resolution groups.

## AEG-01

- Upstream: Upstream session authentication, organization membership/roles, invitations, selection and shared wallets remain the authority.
- Current: Adds locale-aware auth/email presentation and identity-bound asynchronous admin cache invalidation; invitation recipients, actions and organization APIs remain.
- Requirement: AGENTS.md; docs/secondary-development/confirmation.md; localization-plan.md; system-prompt-localization.md; upstream-preservation-plan.md
- Disposition: preserve; per-path source and test links are in review-AEG.jsonl.

## AEG-02

- Upstream: Workflow triggers use organization-scoped durable payloads, claim-guarded writes, named read hatches and child propagation.
- Current: Makes promptLocale and configuration snapshots explicit; carries actual LLM credential provenance across durable failures, without re-resolving a different current key.
- Requirement: AGENTS.md; docs/secondary-development/confirmation.md; localization-plan.md; system-prompt-localization.md; upstream-preservation-plan.md
- Disposition: preserve; per-path source and test links are in review-AEG.jsonl.

## AEG-03

- Upstream: Assistant uses the shared MCP tools under the authenticated session, schema validation, approval/resume, SDK connection and tool billing contracts.
- Current: Adds model/capability routing and locale bridges; hardens transcript vision checks, approval identity and response/error preservation while retaining shared MCP tools and normal spending.
- Requirement: AGENTS.md; docs/secondary-development/confirmation.md; localization-plan.md; system-prompt-localization.md; upstream-preservation-plan.md
- Disposition: preserve; per-path source and test links are in review-AEG.jsonl.

## AEG-04

- Upstream: Authenticated API keys and OAuth/session principals retain distinct scope and production-access contracts; external MCP is retained.
- Current: Validates the key before classifying the principal, keeps admin API-key cross-organization access and session/OAuth organization scope, and propagates fixed external versus cookie internal prompt locale.
- Requirement: AGENTS.md; docs/secondary-development/confirmation.md; localization-plan.md; system-prompt-localization.md; upstream-preservation-plan.md
- Disposition: preserve; per-path source and test links are in review-AEG.jsonl.

## AEG-05

- Upstream: Upstream tooling, build/runtime compatibility date and local Cloudflare isolation remain the baseline.
- Current: Adds project-only Codex/i18n tooling and Windows support; keeps dependency upgrades, test-local DB guards, preview CAS/delete race protections and workflow-trigger checks.
- Requirement: AGENTS.md; docs/secondary-development/confirmation.md; localization-plan.md; system-prompt-localization.md; upstream-preservation-plan.md
- Disposition: preserve; per-path source and test links are in review-AEG.jsonl.

## AEG-06

- Upstream: Upstream English labels, arbitrary user/provider text and external protocol values remain the semantic source.
- Current: Introduces English-source translation keys, per-request/runtime locale, persisted cookie and namespace resources with default Simplified Chinese UI and external English prompts.
- Requirement: AGENTS.md; docs/secondary-development/confirmation.md; localization-plan.md; system-prompt-localization.md; upstream-preservation-plan.md
- Disposition: preserve; per-path source and test links are in review-AEG.jsonl.

## AEG-07

- Upstream: Architecture documentation describes upstream capabilities and existing current source contracts.
- Current: Records implemented locale/model bridges, preservation history and evidence boundaries; cancelled personal-wallet/commercial-gift/admin-no-browsing proposals stay cancelled.
- Requirement: AGENTS.md; docs/secondary-development/confirmation.md; localization-plan.md; system-prompt-localization.md; upstream-preservation-plan.md
- Disposition: preserve; per-path source and test links are in review-AEG.jsonl.

## AEG-08

- Upstream: Public create/enhance/upload/export/stitch flows retain organization scopes, validation, rights checks and publication checks.
- Current: Threads mandatory prompt locale and configured model defaults through existing handlers; localized stitch/player controls preserve media and URL semantics.
- Requirement: AGENTS.md; docs/secondary-development/confirmation.md; localization-plan.md; system-prompt-localization.md; upstream-preservation-plan.md
- Disposition: preserve; per-path source and test links are in review-AEG.jsonl.

## Findings and evidence

No confirmed production-code regression was found in this partition. Two authorized documentation repairs close stale current-source/planning descriptions: the personal wallet/space plan is cancelled, and the assistant helper is modelOptionsFor. Both documents pass diff whitespace and formatting checks.

Fresh runs: 50 unique files, 817/817 tests (424 core, 271 assistant/engineering, 122 hooks), using actual local modules and isolated SQLite/BetterAuth where described, with external supplier/process/network I/O mocked. JSON reports are in AEG-logs.

Important retained boundaries: admin API-key cross-organization MCP access is retained; cookie sessions and OAuth remain scoped. Org switching, invitation, roles and shared-wallet code are not removed. Full platform BYOK removal, CNY selling prices and default private assets remain plans, not behavior asserted here. promptLocale is mandatory by explicit pre-launch policy.

The public API E2E harness retains assertions for 10/1000 defaults but uses a guarded 60-second burst window for synthetic E2E owner/key isolation, so no claim of real one-second timing acceptance is made. Historical merge test hunks were inspected together with the final net contract; historical revisions were not each executed.

Static integrity: 1117 candidate blob pairs match their exact Git sources; 4541 import-candidate edges resolve; 10 unchanged auth/org/API/MCP core paths are blob-identical to upstream. This does not replace indirect runtime validation.

No browser service, real provider, real email, remote DB, push or deploy was performed by this owner. Parent-owned runtime results must be reported separately.
