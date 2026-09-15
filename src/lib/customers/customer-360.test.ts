import { describe, expect, it } from 'vitest';

import {
  getCustomerDisplayName,
  getIdentityDisplayLabel,
  sortCustomerConversations,
} from './customer-360';

describe('Customer 360 presentation helpers', () => {
  it('chooses the canonical display name before split name fields', () => {
    expect(
      getCustomerDisplayName({
        id: 'customer-1',
        status: 'active',
        display_name: 'Ada Canonical',
        first_name: 'Ignored',
        last_name: 'Name',
      })
    ).toBe('Ada Canonical');
  });

  it('falls back through split names and the unnamed label', () => {
    expect(
      getCustomerDisplayName({
        id: 'customer-1',
        status: 'active',
        first_name: 'Ada',
        last_name: 'Lovelace',
      })
    ).toBe('Ada Lovelace');
    expect(getCustomerDisplayName({ id: 'customer-2', status: 'active' })).toBe(
      'Sin nombre'
    );
  });

  it('chooses username, display name, then external id for identities', () => {
    const base = {
      id: 'identity-1',
      channel: 'whatsapp',
      external_id: 'ext-1',
    };
    expect(getIdentityDisplayLabel({ ...base, username: 'ada' })).toBe('@ada');
    expect(
      getIdentityDisplayLabel({ ...base, display_name: 'Ada Lovelace' })
    ).toBe('Ada Lovelace');
    expect(getIdentityDisplayLabel({ ...base, phone: '+15550000000' })).toBe(
      'ext-1'
    );
  });

  it('sorts conversations newest-first and puts missing dates last', () => {
    const sorted = sortCustomerConversations([
      { id: 'old', status: 'closed', last_message_at: '2026-01-01T00:00:00Z' },
      { id: 'none', status: 'open', last_message_at: null },
      { id: 'new', status: 'open', last_message_at: '2026-09-01T00:00:00Z' },
    ]);

    expect(sorted.map((conversation) => conversation.id)).toEqual([
      'new',
      'old',
      'none',
    ]);
  });
});
