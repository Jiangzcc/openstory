# P2 F-AEG page and settings preservation

Reviewed 86 assigned net paths against 2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0 at ce321c885f67e40fec1c8598bb759790d89359c9; all 3 assigned merge-resolution groups reviewed.

## F-AEG-01

- Upstream: Authentication, device grants, OAuth and invitation acceptance retain session guards, organization selection and existing server calls.
- Requirement: AGENTS.md; docs/secondary-development/localization-plan.md; latest user instruction excludes a language switch on login.
- Current change: per-path concrete observations in review-F-AEG.jsonl.
- Decision: preserve; no confirmed runtime-code defect found in this subpartition.

## F-AEG-02

- Upstream: Organization membership, shared wallets, provider keys, public API keys, grants, gift codes and passkeys use existing organization/auth/billing interfaces.
- Requirement: AGENTS.md; docs/secondary-development/confirmation.md; localization-plan.md. Personal wallets and commercial gift-code redesign are cancelled; BYOK ban is unimplemented.
- Current change: per-path concrete observations in review-F-AEG.jsonl.
- Decision: preserve; no confirmed runtime-code defect found in this subpartition.

## F-AEG-03

- Upstream: Product route URL/search/auth/query state, admin support access and arbitrary user content remain the upstream business source.
- Requirement: AGENTS.md; docs/secondary-development/localization-plan.md; extension-policy.md.
- Current change: per-path concrete observations in review-F-AEG.jsonl.
- Decision: preserve; no confirmed runtime-code defect found in this subpartition.

## F-AEG-04

- Upstream: Public content, documentation, static legal English and metadata URLs/identity remain upstream behavior.
- Requirement: AGENTS.md; docs/secondary-development/localization-plan.md; login language selector excluded by latest user instruction.
- Current change: per-path concrete observations in review-F-AEG.jsonl.
- Decision: preserve; no confirmed runtime-code defect found in this subpartition.

## F-AEG-05

- Upstream: Built-in model selection/capabilities and admin parent guard remain; configurable model management is secondary development.
- Requirement: AGENTS.md; docs/secondary-development/model-configuration-assessment.md; docs/architecture/model-configuration.md.
- Current change: per-path concrete observations in review-F-AEG.jsonl.
- Decision: preserve; no confirmed runtime-code defect found in this subpartition.

## F-AEG-06

- Upstream: Error routing, diagnostics, retry action, Radix primitives and upload state machine remain the base.
- Requirement: AGENTS.md; docs/secondary-development/localization-plan.md; extension-policy.md.
- Current change: per-path concrete observations in review-F-AEG.jsonl.
- Decision: preserve; no confirmed runtime-code defect found in this subpartition.

## Evidence and limits

The parent F suite passed 47 files / 635 tests. This is shared test evidence, not an additional run by this owner. Directly assigned tests include 6 real device-route SSR assertions and 3 error-fallback SSR assertions with request/router functions mocked. Other page behaviors remain statically reviewed unless separately covered by parent browser evidence.

An additional isolated actual React SSR check compared the full Privacy and Terms pages to upstream: English text, tag order and all 23 hrefs are equal; Chinese preserves the links and has no unresolved placeholders. No fetch/side-effect calls were added: source call inventory adds only t/useTranslation/localizeMeta. The router registration and Link were render adapters, and no browser/network ran in that check.

Organization invitation, role mutation, member permission gates, organization switching, shared wallet, USD gift amounts/limits/expiry, Stripe, API/MCP and OAuth/developer access remain. No personal wallet, CNY conversion, commercial gift-code redesign or full BYOK removal is inferred. Model admin route/catalog and aspect-ratio filtering are actual model-configuration bridges, not pure label changes. Error retry now resets query errors before the existing route reset/invalidation; this is explicitly distinguished from translation.

Latest user correction excludes a language switch on login. The temporary proposed layout addition was fully reverted and the path is clean. Its absence is not a defect or pending item. Git reachability did not show a committed LanguageSwitcher under the auth routes; no historical merge-loss claim is made.

No own browser services, login/OTP, real credentials, gift redemption, payments, paid generation, remote DB or deployment were executed. Parent-owned browser evidence must stay separate.

## P2 inherited docs-session correction

The parent app desktop run caught a loading-button to anonymous-sign-in-link hydration mismatch under DocsAppSidebar. The isolated actual B/current Chromium probe reproduces it in both versions when an unseeded server snapshot is followed by a session that settles before footer hydration. Both seeded controls pass, and the baseline footer has no localization hook. This is an inherited upstream snapshot gap, not a missed merge or an auth/i18n business regression. The probe forces that timing; it is not a full baseline-app browser reproduction.

The local P2 correction is only docs.tsx awaiting the existing session query in beforeLoad. Anonymous null remains valid with no redirect. The footer/loading UI and auth/cache mechanisms are unchanged. The new docs-session.test.tsx executes actual route, router, query/cache and footer code with external auth I/O mocked: 4/4 pass for anonymous, signed-in, delayed and unseeded negative-control behavior. SSR/cache equality and actual browser hydration evidence are separate. See SSR-footer-tests.json, SSR-footer-quality.json, footer-hydration-probe.json and supplemental-F-AEG.json; parent-owned post-fix full app desktop/mobile acceptance is still separate.

The original 86-path manifest is unchanged. Docs and footer are upgraded to reviewed-tested, yielding 78 static / 8 tested; the new test and architecture change are listed as P2 supplements.
