import { describe, expect, it } from 'vitest';

import { findPendingIdentityMatches } from './identity-match-candidates';

describe('findPendingIdentityMatches', () => {
  it('creates a review candidate for an accent-insensitive display-name match', () => {
    expect(
      findPendingIdentityMatches({ displayName: 'Héctor Santos' }, [
        { customerId: 'customer-1', displayName: 'Hector Santos' },
      ])
    ).toEqual([
      { customerId: 'customer-1', score: 0.6, method: 'display_name_exact' },
    ]);
  });

  it('keeps username matches pending and prefers their stronger review score', () => {
    expect(
      findPendingIdentityMatches(
        { displayName: 'Hector Santos', username: 'hector' },
        [
          {
            customerId: 'customer-1',
            displayName: 'Hector Santos',
            username: 'HECTOR',
          },
        ]
      )
    ).toEqual([
      { customerId: 'customer-1', score: 0.7, method: 'username_exact' },
    ]);
  });

  it('does not infer a match when weak fields differ', () => {
    expect(
      findPendingIdentityMatches({ displayName: 'Hector Santos' }, [
        { customerId: 'customer-1', displayName: 'Ana Diaz' },
      ])
    ).toEqual([]);
  });
});
