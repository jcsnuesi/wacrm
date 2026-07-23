export const ACTIVE_ACCOUNT_COOKIE = 'wacrm_active_account_id';

const TRUEISH = /^(1|true|yes|on)$/i;

/**
 * Lightweight UUID shape validation for user-controlled input such as
 * query/body/cookies. Keeps obviously-invalid values out of DB filters.
 */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

/**
 * Rollout guard for multi-account session switching.
 *
 * Defaults to enabled to preserve current behavior. Set either
 * `WACRM_ENABLE_MULTI_ACCOUNT_SWITCH=false` (server) or
 * `NEXT_PUBLIC_WACRM_ENABLE_MULTI_ACCOUNT_SWITCH=false` (client/server)
 * to force legacy single-account behavior.
 */
export function isActiveAccountSwitchEnabled(): boolean {
  const raw =
    process.env.WACRM_ENABLE_MULTI_ACCOUNT_SWITCH ??
    process.env.NEXT_PUBLIC_WACRM_ENABLE_MULTI_ACCOUNT_SWITCH;

  if (raw == null) return true;
  return TRUEISH.test(raw.trim());
}
