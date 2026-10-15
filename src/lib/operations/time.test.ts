import { describe, it, expect } from 'vitest';
import { localToInstant } from './time';
describe('business clock', () => {
  it('uses the business timezone', () =>
    expect(localToInstant('2026-10-16T10:00', 'America/Santo_Domingo')).toBe(
      '2026-10-16T14:00:00.000Z'
    ));
  it('rejects daylight-saving gaps and uses the first repeated time', () => {
    expect(() =>
      localToInstant('2026-03-08T02:30', 'America/New_York')
    ).toThrow();
    expect(localToInstant('2026-11-01T01:30', 'America/New_York')).toBe(
      '2026-11-01T05:30:00.000Z'
    );
  });
});
