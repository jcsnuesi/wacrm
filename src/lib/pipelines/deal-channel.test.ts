import { describe, expect, it } from 'vitest';

import { getChannelCustomerCounts, getDealChannel } from './deal-channel';
import type { Deal } from '@/types';

const deal = (overrides: Partial<Deal>): Deal => ({
  id: 'deal-1',
  user_id: 'user-1',
  pipeline_id: 'pipeline-1',
  stage_id: 'stage-1',
  contact_id: null,
  title: 'Deal',
  value: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('pipeline deal channels', () => {
  it('uses WhatsApp for legacy deals without an explicit source channel', () => {
    expect(getDealChannel(deal({}))).toBe('whatsapp');
  });

  it('counts each canonical customer once per channel', () => {
    expect(
      getChannelCustomerCounts([
        deal({
          id: 'deal-1',
          customer_id: 'customer-1',
          source_channel: 'instagram',
        }),
        deal({
          id: 'deal-2',
          customer_id: 'customer-1',
          source_channel: 'instagram',
        }),
        deal({
          id: 'deal-3',
          customer_id: 'customer-2',
          source_channel: 'facebook',
        }),
      ])
    ).toEqual([
      { channel: 'whatsapp', count: 0 },
      { channel: 'instagram', count: 1 },
      { channel: 'facebook', count: 1 },
    ]);
  });
});
