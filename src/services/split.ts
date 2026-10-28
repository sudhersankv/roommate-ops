// Pure split math with no DB import, so the dashboard's add-expense preview uses the same rule the service saves.
export type SplitRow = { memberId: string; cents: number };

/**
 * Split `total` cents evenly across `memberIds`. Leftover cents (total mod n) go one each,
 * starting with the payer if they're a participant, then the rest in the given order.
 * Example: 1000 across [a, b, c] with payer b -> b 334, a 333, c 333.
 */
export function splitEvenly(total: number, memberIds: string[], payerId?: string): SplitRow[] {
  const ids = [...new Set(memberIds)];
  if (ids.length === 0) return [];
  const base = Math.floor(total / ids.length);
  let remainder = total - base * ids.length;
  const order = payerId && ids.includes(payerId) ? [payerId, ...ids.filter((id) => id !== payerId)] : ids;
  const extra = new Map<string, number>();
  for (const id of order) {
    if (remainder <= 0) break;
    extra.set(id, 1);
    remainder -= 1;
  }
  return ids.map((memberId) => ({ memberId, cents: base + (extra.get(memberId) ?? 0) }));
}
