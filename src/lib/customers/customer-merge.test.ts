import { describe, expect, it } from 'vitest';

import { validateCustomerMerge } from './customer-merge';

const validInput = {
  sourceCustomerId: 'source',
  targetCustomerId: 'target',
  sourceAccountId: 'account',
  targetAccountId: 'account',
  sourceStatus: 'active' as const,
};

describe('validateCustomerMerge', () => {
  it('accepts distinct active customers in the same account', () => {
    expect(() => validateCustomerMerge(validInput)).not.toThrow();
  });

  it('rejects self merges and cross-account merges', () => {
    expect(() =>
      validateCustomerMerge({ ...validInput, targetCustomerId: 'source' })
    ).toThrow('must differ');
    expect(() =>
      validateCustomerMerge({ ...validInput, targetAccountId: 'other-account' })
    ).toThrow('same account');
  });

  it('rejects merging an already merged source', () => {
    expect(() =>
      validateCustomerMerge({ ...validInput, sourceStatus: 'merged' })
    ).toThrow('already merged');
  });
});
