const UNITS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

const DURATION_RE = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)$/i;

export function parseDuration(input: string): number {
  const match = DURATION_RE.exec(input.trim());
  if (!match) {
    throw new Error(`Invalid duration format: "${input}". Expected e.g. "24h", "7d", "30m".`);
  }
  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  return Math.round(value * UNITS[unit]);
}
