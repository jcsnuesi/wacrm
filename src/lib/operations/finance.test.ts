import { describe, expect, it } from 'vitest';
import { allocatePayment, commissionMinor } from './finance';
import { activityModules, moneyMinor, validActivities } from './catalog';
describe('operations policy', () => {
  it('allocates partial payments and commissions independently', () => {
    const allocated = allocatePayment(90000, [100000, 50000]);
    expect(allocated).toEqual([60000, 30000]);
    expect(
      commissionMinor(allocated[0], 5000) + commissionMinor(allocated[1], 1000)
    ).toBe(33000);
  });
  it('preserves minor units and rejects overpayments', () => {
    expect(allocatePayment(2, [1, 1, 1])).toEqual([1, 1, 0]);
    expect(() => allocatePayment(4, [1, 2])).toThrow();
    expect(moneyMinor('100.05', 'USD')).toBe(10005);
    expect(moneyMinor('100', 'JPY')).toBe(100);
    expect(() => moneyMinor('1.999', 'USD')).toThrow();
  });
  it('combines activities without enabling product sales for services alone', () => {
    expect(activityModules('services', []).products).toBe(false);
    expect(activityModules('services', ['products']).products).toBe(true);
    expect(validActivities('services', ['services'])).toBe(false);
  });
});
