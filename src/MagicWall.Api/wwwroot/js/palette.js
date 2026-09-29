// Categorical series colours: the dark-surface steps of the validated reference palette.
// Assign in this fixed order and never cycle: the order is what keeps adjacent colours
// distinguishable for colour-blind viewers. Validated against the wall panel (#111a2e):
// slots 1–5 pass adjacent-pair checks; slots 1–3 also pass all-pairs (maps).
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

/** "Other", "no data" and anything past the eighth series. */
export const NEUTRAL = '#475569';

/** Maps names to series colours by identity (sorted name order), so a colour follows its entity. */
export function categoricalScale(names) {
  const sorted = [...new Set(names)].sort((a, b) => a.localeCompare(b));
  const colors = new Map(sorted.map((name, i) => [name, SERIES[i] ?? NEUTRAL]));
  return name => colors.get(name) ?? NEUTRAL;
}
