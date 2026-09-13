export interface MergeCustomerInput {
  sourceCustomerId: string;
  targetCustomerId: string;
  sourceAccountId: string;
  targetAccountId: string;
  sourceStatus: 'active' | 'merged' | 'archived';
}

/** Validates invariants before the database executes the atomic merge RPC. */
export function validateCustomerMerge(input: MergeCustomerInput): void {
  if (input.sourceCustomerId === input.targetCustomerId) {
    throw new Error('Source and target customers must differ');
  }
  if (input.sourceAccountId !== input.targetAccountId) {
    throw new Error('Customers must belong to the same account');
  }
  if (input.sourceStatus === 'merged') {
    throw new Error('Source customer is already merged');
  }
}
