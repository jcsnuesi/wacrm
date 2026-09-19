import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CustomerProfile } from './customer-360-detail-page';

describe('CustomerProfile', () => {
  it('renders canonical data, identity fallbacks, and Inbox conversation links', () => {
    const markup = renderToStaticMarkup(
      React.createElement(CustomerProfile, {
        customer: {
          id: 'customer-1',
          status: 'active',
          display_name: 'Ada Lovelace',
          phone: null,
          email: null,
          created_at: '2026-01-01T12:00:00Z',
          updated_at: '2026-01-02T12:00:00Z',
          contact_identities: [
            {
              id: 'identity-1',
              channel: 'instagram',
              display_name: 'Ada on Instagram',
              external_id: 'instagram-ada',
            },
            {
              id: 'identity-2',
              channel: 'whatsapp',
              external_id: 'whatsapp-ada',
            },
          ],
          conversations: [
            {
              id: 'conversation/1',
              status: 'open',
              last_message_text: 'Hola',
              last_message_at: '2026-01-03T12:00:00Z',
              channel_account: {
                channel: 'instagram',
                display_name: 'Ada Beauty',
              },
            },
          ],
        },
      })
    );

    expect(markup).toContain('Ada Lovelace');
    expect(markup).toContain('Teléfono no disponible');
    expect(markup).toContain('Correo no disponible');
    expect(markup).toContain('Ada on Instagram');
    expect(markup).toContain('whatsapp-ada');
    expect(markup).toContain('Ada Beauty');
    expect(markup).toContain('Abierto');
    expect(markup).toContain('href="/inbox?c=conversation%2F1"');
  });

  it('shows explicit empty states for identities and activity', () => {
    const markup = renderToStaticMarkup(
      React.createElement(CustomerProfile, {
        customer: {
          id: 'customer-1',
          status: 'active',
          created_at: '2026-01-01T12:00:00Z',
          updated_at: '2026-01-02T12:00:00Z',
          contact_identities: [],
          conversations: [],
        },
      })
    );

    expect(markup).toContain('No hay identidades de canal asociadas.');
    expect(markup).toContain('No hay actividad de canal registrada.');
    expect(markup).toContain('href="/customers"');
  });

  it('keeps a long activity preview constrained to its channel card', () => {
    const markup = renderToStaticMarkup(
      React.createElement(CustomerProfile, {
        customer: {
          id: 'customer-1',
          status: 'active',
          created_at: '2026-01-01T12:00:00Z',
          updated_at: '2026-01-02T12:00:00Z',
          conversations: [
            {
              id: 'conversation-1',
              status: 'open',
              last_message_text: 'Mensaje muy largo sin espacios '.repeat(20),
            },
          ],
        },
      })
    );

    expect(markup).toContain('minmax(0,0.8fr)_minmax(0,1.2fr)');
    expect(markup).toContain('min-w-0 max-w-full overflow-hidden');
  });
});
