// Party colours: fixed broadcast colours from config/parties.json (editable without a
// code change), then validated palette colours for any party not listed there.
import { NEUTRAL, SERIES } from './palette.js';

let config = null;

export async function partyColorScale(partyNames) {
  config ??= fetch('/config/parties.json').then(r => (r.ok ? r.json() : {})).catch(() => ({}));
  const fixed = (await config).colors ?? {};
  const used = new Set(Object.values(fixed).map(c => c.toLowerCase()));
  const free = SERIES.filter(c => !used.has(c.toLowerCase()));

  const unlisted = [...new Set(partyNames)].filter(p => p && !fixed[p]).sort((a, b) => a.localeCompare(b, 'bn'));
  const assigned = new Map(unlisted.map((party, i) => [party, free[i] ?? NEUTRAL]));

  return party => (party ? fixed[party] ?? assigned.get(party) ?? NEUTRAL : NEUTRAL);
}
