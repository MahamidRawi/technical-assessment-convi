export function quantile(values: number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const lowerValue = sorted[lower];
  const upperValue = sorted[upper];
  if (lowerValue === undefined || upperValue === undefined) return null;
  if (lower === upper) return lowerValue;
  return lowerValue + (upperValue - lowerValue) * (index - lower);
}

export function median(values: number[]): number | null {
  return quantile(values, 0.5);
}

export function weightedMedian(rows: Array<{ value: number; weight: number }>): number | null {
  const valid = rows
    .filter((row) => Number.isFinite(row.value) && Number.isFinite(row.weight) && row.weight > 0)
    .sort((a, b) => a.value - b.value);
  if (valid.length === 0) return null;
  const totalWeight = valid.reduce((sum, row) => sum + row.weight, 0);
  let running = 0;
  for (const row of valid) {
    running += row.weight;
    if (running >= totalWeight / 2) return row.value;
  }
  return valid[valid.length - 1]?.value ?? null;
}

export function weightedQuantile(
  rows: Array<{ value: number; weight: number }>,
  percentile: number
): number | null {
  const valid = rows
    .filter((row) => Number.isFinite(row.value) && Number.isFinite(row.weight) && row.weight > 0)
    .sort((a, b) => a.value - b.value);
  if (valid.length === 0) return null;
  const threshold = valid.reduce((sum, row) => sum + row.weight, 0) * percentile;
  let running = 0;
  for (const row of valid) {
    running += row.weight;
    if (running >= threshold) return row.value;
  }
  return valid[valid.length - 1]?.value ?? null;
}
