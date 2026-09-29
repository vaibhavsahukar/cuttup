import { randomCrashMessage, ALL_CRASH_MESSAGES } from '../src/data/crashMessages';
const bad: Record<string, RegExp> = {
  forest: /guardrail(?!s)|highway|concrete|wall|countryside|scenery|closed/i,
  city: /guardrail|tree|forest|countryside|scenery|backroad|birds/i,
  country: /\btree|forest|concrete|wall\b|backroad|rush hour|downtown/i,
};
const kinds = ['car', 'headon', 'barrier', 'tree', 'lowside', 'highside', 'looped', 'endo', 'tipover'];
let problems = 0, total = 0;
for (const map of ['city', 'country', 'forest'] as const) for (const kind of kinds) for (const bike of [false, true]) for (const victim of [undefined, 'sedan', 'boxtruck']) {
  // impossible combos: barrier on forest (trees there), tree on highways
  if ((kind === 'tree' && map !== 'forest') || (kind === 'barrier' && map === 'forest')) continue;
  if ((kind === 'car' || kind === 'headon') !== (victim !== undefined)) continue;
  if (['lowside', 'highside', 'looped', 'endo', 'tipover'].includes(kind) && !bike) continue;
  for (let i = 0; i < 120; i++) {
    const t = randomCrashMessage({ map, kind, victim, bike }); total++;
    if (bad[map].test(t)) { problems++; console.log('BAD', map, kind, '->', t); }
    if (!bike && /motorcycle|handlebars|two wheels|helmet|rear tyre/i.test(t)) { problems++; console.log('BAD car got bike line', kind, t); }
    if (kind !== 'looped' && /looped it/i.test(t)) { problems++; console.log('BAD', kind, t); }
  }
}
console.log('checked', total, 'draws, problems:', problems, 'of', ALL_CRASH_MESSAGES.length, 'lines');
