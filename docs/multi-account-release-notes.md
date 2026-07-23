# Multi-account switch release notes

This document provides ready-to-send release notes and a Go/No-Go checklist for the production rollout of session-level account switching.

## Release summary

- Feature: session-level active account switching.
- Scope: users with multiple account memberships can switch account context without signing out.
- Safety: legacy fallback remains available through feature flag disable.
- Flag: WACRM_ENABLE_MULTI_ACCOUNT_SWITCH.

## User impact

- Multi-account users:
  - Can switch active account from the existing header/sidebar UI.
  - Account-scoped data refreshes in the selected context.
- Single-account users:
  - No behavioral change expected.

## Technical changes included

- Active account cookie override with membership validation.
- Server-side account context resolution with legacy fallback.
- Feature-flag guardrails for enable and disable modes.
- API behavior hardening for /api/account/active (GET/POST/DELETE).
- Regression coverage for enabled and disabled rollout paths.

## Known safe fallback

If risk is detected, disable rollout:

1. Set WACRM_ENABLE_MULTI_ACCOUNT_SWITCH=false.
2. Redeploy or reload environment configuration.
3. Validate legacy mode smoke checks.

## Go or No-Go checklist

Mark each item before enabling the flag in production.

### Pre-Go

- [ ] Migrations 029 and 030 are applied in production.
- [ ] Regression tests are green on target commit.
- [ ] Release owner, QA verifier, and on-call engineer are assigned.
- [ ] Monitoring dashboards and logs are available.
- [ ] Rollback path is confirmed and tested in non-production.

### Go checks (right after enable)

- [ ] GET /api/account/active returns account_switch_enabled: true.
- [ ] POST /api/account/active returns 403 for unauthorized account IDs.
- [ ] DELETE /api/account/active clears active-account cookie.
- [ ] Header/sidebar switch appears only for users with multiple accounts.
- [ ] Single-account users remain on stable legacy behavior.

### No-Go triggers

- [ ] Unexpected account-context mismatches.
- [ ] Sustained increase in 5xx on account/auth routes.
- [ ] Broad user-facing navigation or data-scope regressions.

If any No-Go trigger is hit, execute rollback immediately.

## Internal announcement template

Use this message in your internal channel.

Subject: Production rollout - multi-account session switch

We are enabling session-level multi-account switching in production today.

What changes:

- Users with multiple account memberships can switch active account in the existing UI.
- Single-account users should experience no changes.

Safety controls:

- Feature flag: WACRM_ENABLE_MULTI_ACCOUNT_SWITCH.
- Immediate rollback path available by disabling the flag and redeploying.

Window:

- Start: [TIME]
- End: [TIME]
- Owner: [NAME]
- On-call: [NAME]

Validation checklist will be executed during rollout and monitored for 30 minutes post-enable.

## Sign-off record

- Date:
- Release owner:
- QA verifier:
- On-call engineer:
- Decision: Go or No-Go
- Notes:
