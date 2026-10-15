export const ACTIVITIES = [
  { id: 'services', label: 'Servicios' },
  { id: 'products', label: 'Venta de productos' },
] as const;
export type Activity = (typeof ACTIVITIES)[number]['id'];
export function validActivities(
  primary: unknown,
  additional: unknown
): primary is Activity {
  return (
    ACTIVITIES.some((a) => a.id === primary) &&
    Array.isArray(additional) &&
    additional.length <= 1 &&
    additional.every(
      (a) => ACTIVITIES.some((item) => item.id === a) && a !== primary
    )
  );
}
export function activityModules(primary: Activity, additional: Activity[]) {
  const all = new Set([primary, ...additional]);
  return {
    professionals: true,
    services: all.has('services'),
    appointments: all.has('services'),
    products: all.has('products'),
    inventory: true,
    sales: true,
    finance: true,
    commissions: true,
  };
}
export function moneyMinor(value: string, currency: string): number {
  const decimals =
    new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  const pattern = new RegExp(`^\\d+(?:[.,]\\d{1,${Math.max(1, decimals)}})?$`);
  if (!pattern.test(value.trim()) || (decimals === 0 && /[.,]/.test(value)))
    throw new Error('Importe no válido');
  const [whole, fraction = ''] = value.trim().replace(',', '.').split('.');
  const amount = Number(
    BigInt(whole) * BigInt(10 ** decimals) +
      BigInt(fraction.padEnd(decimals, '0') || '0')
  );
  if (!Number.isSafeInteger(amount) || amount > 1_000_000_000_000)
    throw new Error('Importe fuera de rango');
  return amount;
}
export function formatMinor(amount: number, currency: string) {
  const formatter = new Intl.NumberFormat('es', {
    style: 'currency',
    currency,
  });
  return formatter.format(
    amount / 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2)
  );
}
