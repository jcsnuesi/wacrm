import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CustomerCard } from './customer-360-page';

describe('CustomerCard', () => {
  it('renders the whole card as an accessible customer-detail link', () => {
    const markup = renderToStaticMarkup(
      React.createElement(CustomerCard, {
        customer: {
          id: 'customer-123',
          status: 'active',
          display_name: 'Ada Lovelace',
          conversations: [],
        },
      })
    );

    expect(markup).toContain('href="/customers/customer-123"');
    expect(markup).toContain('aria-label="Ver perfil de Ada Lovelace"');
    expect(markup).toContain('Vista de perfil canónico');
  });
});
