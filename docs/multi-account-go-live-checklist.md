# Multi-account Go-Live checklist

Use this checklist during the production activation window.

## 0. Session metadata

- Date:
- Environment:
- Release owner:
- QA verifier:
- On-call engineer:
- Commit hash:

## 1. Pre-flight

- [ ] Migrations 029 and 030 are applied.
- [ ] Focused regression suite passed on target commit.
- [ ] Current flag value is documented.
- [ ] Rollback owner confirmed.
- [ ] Monitoring dashboards/logs open.

Suggested test command:

```bash
npm run -s test -- src/lib/auth/active-account.test.ts src/lib/auth/account.test.ts src/app/api/account/active/route.test.ts src/middleware.test.ts
```

## 2. Activate

- [ ] Set WACRM_ENABLE_MULTI_ACCOUNT_SWITCH=true.
- [ ] Deploy/reload environment configuration.
- [ ] Record activation timestamp.

## 3. Smoke checks (immediately after activation)

- [ ] GET /api/account/active returns account_switch_enabled=true.
- [ ] POST /api/account/active returns 403 for unauthorized account.
- [ ] DELETE /api/account/active clears active-account cookie.
- [ ] UI switch appears only for users with multiple accounts.
- [ ] Single-account user flow remains unchanged.

## 4. Observe (30 min)

- [ ] 4xx/5xx rates stable.
- [ ] No abnormal auth/account errors in logs.
- [ ] No high-severity support incidents reported.

## 5. Decision

- [ ] Go
- [ ] No-Go (rollback)

Decision notes:

## 6. Rollback (if needed)

- [ ] Set WACRM_ENABLE_MULTI_ACCOUNT_SWITCH=false.
- [ ] Redeploy/reload environment configuration.
- [ ] Re-run legacy smoke checks.
- [ ] Confirm stabilization.

Legacy verification:

- [ ] account context resolves from profiles.account_id.
- [ ] POST/DELETE /api/account/active return 404.
- [ ] Core account-scoped pages operate normally.
