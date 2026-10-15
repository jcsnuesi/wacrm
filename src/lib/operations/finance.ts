/** Largest-remainder allocation in integer minor units. Stable ties use line order. */
export function allocatePayment(
  total: number,
  weights: readonly number[]
): number[] {
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    weights.some((w) => !Number.isSafeInteger(w) || w < 0)
  )
    throw new Error('Invalid money');
  const sum = weights.reduce((n, weight) => n + BigInt(weight), BigInt(0));
  if (BigInt(total) > sum) throw new Error('Payment exceeds balance');
  if (sum === BigInt(0)) return weights.map(() => 0);
  const rows = weights.map((w, i) => ({
    i,
    amount: Number((BigInt(total) * BigInt(w)) / sum),
    remainder: (BigInt(total) * BigInt(w)) % sum,
  }));
  let remaining = total - rows.reduce((n, row) => n + row.amount, 0);
  for (const row of [...rows].sort((a, b) =>
    a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1
  )) {
    if (remaining-- > 0) row.amount++;
  }
  return rows.map((row) => row.amount);
}
export function commissionMinor(allocated: number, basisPoints: number) {
  if (
    !Number.isSafeInteger(allocated) ||
    allocated < 0 ||
    !Number.isInteger(basisPoints) ||
    basisPoints < 0 ||
    basisPoints > 10000
  )
    throw new Error('Invalid commission');
  return Number(
    (BigInt(allocated) * BigInt(basisPoints) + BigInt(5000)) / BigInt(10000)
  );
}
