# Multi-account switch rollout

This runbook describes how to roll out session-level account switching safely while preserving the legacy single-account behavior.

## Goal

Enable account switching gradually and keep a fast fallback to legacy mode if regressions appear.

## Feature flag

Use one of these environment variables:

- `WACRM_ENABLE_MULTI_ACCOUNT_SWITCH` (preferred for server control)
- `NEXT_PUBLIC_WACRM_ENABLE_MULTI_ACCOUNT_SWITCH` (optional client-visible override)

Behavior:

- Default (unset): enabled
- Enabled values: `true`, `1`, `yes`, `on`
- Any other value: disabled

## Rollout strategy

1. Stage A - disabled in production

- Set `WACRM_ENABLE_MULTI_ACCOUNT_SWITCH=false`
- Deploy and verify no change for current users
- Confirm APIs return legacy-safe behavior (`/api/account/active` still resolves account context)

2. Stage B - enable in staging

- Set `WACRM_ENABLE_MULTI_ACCOUNT_SWITCH=true` in staging
- Validate switching for users with multiple memberships
- Validate non-membership rejection (403)
- Validate cookie clear and fallback to profile account

3. Stage C - limited production enablement

- Enable flag in production during low-traffic window
- Monitor logs and support tickets for 24h
- Keep rollback path ready (flip flag to `false` and redeploy)

4. Stage D - full production enablement

- Keep enabled by default
- Maintain regression tests in CI for both enabled and disabled modes

## Operational checks

Before enabling:

- Migrations 029 and 030 applied on target database
- Account membership rows backfilled and readable by RLS
- Smoke tests pass
- On-call contact aware of rollout window

After enabling:

- GET `/api/account/active` returns `account_switch_enabled: true`
- POST `/api/account/active` rejects unauthorized account IDs with 403
- DELETE `/api/account/active` clears active-account cookie
- Existing single-account users can still navigate and operate normally

## Rollback

If issues are detected:

1. Set `WACRM_ENABLE_MULTI_ACCOUNT_SWITCH=false`
2. Redeploy
3. Verify:

- Account context resolves from `profiles.account_id`
- `POST` and `DELETE` on `/api/account/active` return 404
- No account-membership query required for normal requests

## Test commands

Run focused regression tests:

```bash
npm run -s test -- src/lib/auth/active-account.test.ts src/lib/auth/account.test.ts src/app/api/account/active/route.test.ts src/middleware.test.ts
```

Run full suite before production rollout:

```bash
npm test
```
