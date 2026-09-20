import { describe, expect, it } from 'vitest';

import { getDealContactLabel } from './deal-contact';
import type { Deal } from '@/types';

const deal = (overrides: Partial<Deal>): Deal => ({
  id: 'deal-1',
  user_id: 'user-1',
  pipeline_id: 'pipeline-1',
  stage_id: 'stage-1',
  contact_id: null,
  title: 'Instagram - Customer',
  value: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('getDealContactLabel', () => {
  it('uses the canonical customer display name when available', () => {
    expect(
      getDealContactLabel(
        deal({
          customer: {
            id: 'customer-1',
            display_name: 'María Pérez',
            contact_identities: [
              { id: 'identity-1', channel: 'instagram', username: 'maria' },
            ],
          },
          source_channel: 'instagram',
        })
      )
    ).toBe('María Pérez');
  });

  it('uses the identity for the deal channel when a social customer has no display name', () => {
    expect(
      getDealContactLabel(
        deal({
          source_channel: 'instagram',
          customer: {
            id: 'customer-1',
            contact_identities: [
              { id: 'identity-1', channel: 'facebook', username: 'fb-user' },
              {
                id: 'identity-2',
                channel: 'instagram',
                display_name: 'Ana Gómez',
                username: 'ana.gomez',
              },
            ],
          },
        })
      )
    ).toBe('Ana Gómez');
  });

  it('falls back to a social username before showing no contact', () => {
    expect(
      getDealContactLabel(
        deal({
          source_channel: 'instagram',
          customer: {
            id: 'customer-1',
            contact_identities: [
              { id: 'identity-1', channel: 'instagram', username: 'ana.gomez' },
            ],
          },
        })
      )
    ).toBe('ana.gomez');
  });
});
