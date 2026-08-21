export type SessionContextUsage = {
  used: number;
  size: number;
  cost?: {
    amount: number;
    currency: string;
  };
};

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function parseSessionContextUsage(raw: unknown): SessionContextUsage | null {
  if (!raw || typeof raw !== 'object') return null;

  const record = raw as Record<string, unknown>;
  const used = readFiniteNumber(record.used);
  const size = readFiniteNumber(record.size);
  if (used == null || size == null || size <= 0) return null;

  const costRecord = record.cost;
  const cost = costRecord && typeof costRecord === 'object'
    ? (() => {
        const amount = readFiniteNumber((costRecord as Record<string, unknown>).amount);
        const currency = (costRecord as Record<string, unknown>).currency;
        if (amount == null || typeof currency !== 'string' || !currency.trim()) return undefined;
        return { amount, currency: currency.trim() };
      })()
    : undefined;

  return {
    used: Math.max(0, used),
    size,
    ...(cost ? { cost } : {}),
  };
}
