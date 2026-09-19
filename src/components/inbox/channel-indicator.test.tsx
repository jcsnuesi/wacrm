import { describe, expect, it } from 'vitest';

import type { Conversation } from '@/types';
import { getInboxChannel, getInboxChannelLabel } from './channel-indicator';

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conversation-1',
    user_id: 'user-1',
    contact_id: 'contact-1',
    status: 'open',
    unread_count: 0,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('getInboxChannel', () => {
  it('uses the connected Instagram account instead of the legacy contact field names', () => {
    expect(
      getInboxChannel(
        conversation({
          channel_account: {
            channel: 'instagram',
            display_name: 's7venthcapilar',
            username: 's7venthcapilar',
          },
        })
      )
    ).toBe('instagram');
    expect(getInboxChannelLabel('instagram')).toBe('Instagram');
  });

  it('keeps existing WhatsApp conversations on the WhatsApp presentation', () => {
    expect(
      getInboxChannel(
        conversation({
          whatsapp_config: {
            id: 'config-1',
            provider: 'meta',
            phone_number_id: 'phone-1',
            sender_phone: '+18095551234',
            status: 'connected',
          },
        })
      )
    ).toBe('whatsapp');
  });
});
