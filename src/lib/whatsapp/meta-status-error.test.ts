import { describe, expect, it } from 'vitest';
import { formatMetaStatusErrors } from './meta-status-error';

describe('formatMetaStatusErrors', () => {
  it('formats the asynchronous Meta delivery code and details', () => {
    expect(
      formatMetaStatusErrors([
        {
          code: 131049,
          title: 'Message not delivered',
          error_data: {
            details: 'Meta chose not to deliver this marketing message.',
          },
        },
      ])
    ).toBe(
      '(#131049) Message not delivered: Meta chose not to deliver this marketing message.'
    );
  });

  it('returns null when Meta provides no errors', () => {
    expect(formatMetaStatusErrors(undefined)).toBeNull();
    expect(formatMetaStatusErrors([])).toBeNull();
  });
});
