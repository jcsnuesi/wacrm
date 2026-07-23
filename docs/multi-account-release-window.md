# Multi-account release window playbook

This playbook is for the production activation window of session-level account switching.

Use this together with the release notes document:

- ./multi-account-release-notes.md
- ./multi-account-go-live-checklist.md

## Scope

- Feature: active account switching in session context.
- Flag: WACRM_ENABLE_MULTI_ACCOUNT_SWITCH.
- Safety model: fail back to legacy account context when disabled.

## Owners

- Release owner: assign one person responsible for go or no-go.
- On-call engineer: handles rollback and incident response.
- QA verifier: executes post-deploy checks.

## Preconditions

- Migrations 029 and 030 are applied in production.
- Regression suite is green.
- Rollback owner and communication channel are confirmed.
- Monitoring dashboard and application logs are accessible.

## Recommended rollout window

- Choose a low-traffic period.
- Reserve 60 to 90 minutes:
  1. 15 min pre-checks
  2. 15 min deploy
  3. 30 min smoke and monitoring
  4. 15 to 30 min observation

## Step-by-step execution

1. Pre-deploy checks

- Confirm current production flag value.
- Confirm current app version and commit hash.
- Confirm DB migration state.

2. Deploy with flag disabled

- Ensure WACRM_ENABLE_MULTI_ACCOUNT_SWITCH=false.
- Deploy baseline build.
- Verify no behavior change for single-account users.

3. Activate in production

- Set WACRM_ENABLE_MULTI_ACCOUNT_SWITCH=true.
- Redeploy or reload env config according to your platform.

4. Smoke tests after activation

- GET /api/account/active returns account_switch_enabled: true.
- POST /api/account/active rejects unauthorized account IDs with 403.
- DELETE /api/account/active clears active account cookie.
- Header and sidebar account switch are available only when user has multiple accounts.
- Single-account users remain operational with unchanged flows.

5. Observe for 30 minutes

- Watch 4xx and 5xx error rates.
- Watch auth/account-related logs.
- Watch support channel for user-reported anomalies.

## Rollback plan

Trigger rollback if any of these happen:

- Unexpected account-context mismatches.
- Elevated 5xx from account-auth routes.
- Broad user-impacting navigation/data-scope issues.

Rollback actions:

1. Set WACRM_ENABLE_MULTI_ACCOUNT_SWITCH=false.
2. Redeploy or reload env config.
3. Re-run smoke checks in legacy mode:

- account context resolves from profiles.account_id.
- POST and DELETE on /api/account/active return 404.
- Standard account-scoped pages continue working.

## Evidence log template

Use this during release:

- Date/time start:
- Date/time end:
- Release owner:
- App version:
- Migration state verified:
- Flag before:
- Flag after:
- Smoke checks result:
- Monitoring notes:
- Rollback required: yes/no
- Final status: success/partial/rollback
