export const KNOWN_METRICS: string[] = [
  "TotalDPS",
  "TotalEHP",
  "Life",
  "Mana",
  "EnergyShield",
  "FireResist",
];

export function mergeMetricOptions(buildStatsKeys?: string[]): string[] {
  if (!buildStatsKeys || buildStatsKeys.length === 0) {
    return KNOWN_METRICS;
  }
  const known = new Set(KNOWN_METRICS);
  const extra = buildStatsKeys.filter((key) => !known.has(key));
  const deduped: string[] = [];
  const seen = new Set(KNOWN_METRICS);
  for (const key of extra) {
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(key);
    }
  }
  return [...KNOWN_METRICS, ...deduped];
}
