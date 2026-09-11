import { describe, expect, it } from 'vitest';

import { isChannel } from '@/lib/channels/types';
import { normalizeIdentityExternalId } from './identities';

describe('contact identities', () => {
  it('recognizes the supported CRM channels', () => {
    expect(isChannel('whatsapp')).toBe(true);
    expect(isChannel('instagram')).toBe(true);
    expect(isChannel('telegram')).toBe(false);
  });

  it('normalizes only WhatsApp phone identities', () => {
    expect(normalizeIdentityExternalId('whatsapp', '+1 (555) 123-4567', 'phone')).toBe(
      '15551234567'
    );
    expect(normalizeIdentityExternalId('whatsapp', ' BSUID_123 ', 'bsuid')).toBe('BSUID_123');
    expect(normalizeIdentityExternalId('instagram', ' 17841400000000000 ')).toBe(
      '17841400000000000'
    );
  });
});
