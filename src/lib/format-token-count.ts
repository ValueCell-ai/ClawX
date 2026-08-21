export function formatCompactTokenCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    if (Number.isInteger(millions)) return `${millions}M`;
    const rounded = Math.round(millions * 10) / 10;
    return `${rounded}M`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    if (Number.isInteger(thousands)) return `${thousands}k`;
    const rounded = Math.round(thousands * 10) / 10;
    return `${rounded}k`;
  }
  return String(Math.round(value));
}

export function formatContextUsagePercent(used: number, size: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(size) || size <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used / size) * 100)));
}
