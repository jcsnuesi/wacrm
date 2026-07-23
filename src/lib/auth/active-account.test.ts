import { afterEach, describe, expect, it } from 'vitest';

import {
  ACTIVE_ACCOUNT_COOKIE,
  isActiveAccountSwitchEnabled,
  isUuid,
} from './active-account';

afterEach(() => {
  delete process.env.WACRM_ENABLE_MULTI_ACCOUNT_SWITCH;
  delete process.env.NEXT_PUBLIC_WACRM_ENABLE_MULTI_ACCOUNT_SWITCH;
});

describe('active-account helpers', () => {
  it('exports the expected cookie name', () => {
    expect(ACTIVE_ACCOUNT_COOKIE).toBe('wacrm_active_account_id');
  });

  it('validates UUID v4 and rejects malformed values', () => {
    expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isUuid('11111111-1111-6111-8111-111111111111')).toBe(false);
    expect(isUuid('bad-id')).toBe(false);
  });

  it('defaults account switch flag to enabled', () => {
    expect(isActiveAccountSwitchEnabled()).toBe(true);
  });

  it('accepts true-ish values', () => {
    process.env.WACRM_ENABLE_MULTI_ACCOUNT_SWITCH = 'true';
    expect(isActiveAccountSwitchEnabled()).toBe(true);

    process.env.WACRM_ENABLE_MULTI_ACCOUNT_SWITCH = '1';
    expect(isActiveAccountSwitchEnabled()).toBe(true);

    process.env.WACRM_ENABLE_MULTI_ACCOUNT_SWITCH = 'yes';
    expect(isActiveAccountSwitchEnabled()).toBe(true);

    process.env.WACRM_ENABLE_MULTI_ACCOUNT_SWITCH = 'on';
    expect(isActiveAccountSwitchEnabled()).toBe(true);
  });

  it('treats non true-ish values as disabled', () => {
    process.env.WACRM_ENABLE_MULTI_ACCOUNT_SWITCH = 'false';
    expect(isActiveAccountSwitchEnabled()).toBe(false);

    process.env.WACRM_ENABLE_MULTI_ACCOUNT_SWITCH = '0';
    expect(isActiveAccountSwitchEnabled()).toBe(false);

    process.env.WACRM_ENABLE_MULTI_ACCOUNT_SWITCH = 'no';
    expect(isActiveAccountSwitchEnabled()).toBe(false);

    process.env.WACRM_ENABLE_MULTI_ACCOUNT_SWITCH = 'off';
    expect(isActiveAccountSwitchEnabled()).toBe(false);
  });

  it('falls back to NEXT_PUBLIC flag when server flag is unset', () => {
    process.env.NEXT_PUBLIC_WACRM_ENABLE_MULTI_ACCOUNT_SWITCH = 'false';
    expect(isActiveAccountSwitchEnabled()).toBe(false);

    process.env.NEXT_PUBLIC_WACRM_ENABLE_MULTI_ACCOUNT_SWITCH = 'true';
    expect(isActiveAccountSwitchEnabled()).toBe(true);
  });
});
