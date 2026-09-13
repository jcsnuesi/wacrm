import { describe, expect, it } from 'vitest';

import { resolveIdentity } from './identity-resolution';

describe('resolveIdentity', () => {
  it('keeps a known WhatsApp identity on its existing customer', () => {
    expect(
      resolveIdentity({ externalIdentityCustomerId: 'customer-1' }, [])
    ).toEqual({
      action: 'existing_identity',
      customerId: 'customer-1',
      method: 'external_id',
    });
  });

  it('reuses the customer for an Instagram identity with the same normalized phone', () => {
    expect(
      resolveIdentity({ phone: '+1 (809) 555-1212' }, [
        { customerId: 'customer-1', phone: '18095551212' },
      ])
    ).toEqual({
      action: 'auto_match',
      customerId: 'customer-1',
      method: 'phone',
    });
  });

  it('creates a customer for an unknown Instagram identity', () => {
    expect(resolveIdentity({ phone: '+1 809 555 1212' }, [])).toEqual({
      action: 'new_customer',
    });
  });

  it('uses an exact normalized email only after phone has no match', () => {
    expect(
      resolveIdentity({ email: ' HECTOR@EXAMPLE.COM ' }, [
        { customerId: 'customer-1', email: 'hector@example.com' },
      ])
    ).toEqual({
      action: 'auto_match',
      customerId: 'customer-1',
      method: 'email',
    });
  });
});
