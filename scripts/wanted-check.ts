// Wanted level crash lines: they only come up under a wanted level, only sometimes, and never for a cop catch.
import { randomCrashMessage, ALL_CRASH_MESSAGES } from '../src/data/crashMessages';
const wantedLines = new Set(ALL_CRASH_MESSAGES.filter((m) => m.need.includes('wanted')).map((m) => m.t));
console.log('wanted lines:', wantedLines.size);
let leaked = 0, shown = 0, n = 4000, caughtWanted = 0;
for (let i = 0; i < n; i++) {
  if (wantedLines.has(randomCrashMessage({ map: 'city', kind: 'barrier', bike: false }))) leaked++;
  if (wantedLines.has(randomCrashMessage({ map: 'forest', kind: 'tree', bike: true, wanted: true }))) shown++;
  if (wantedLines.has(randomCrashMessage({ map: 'country', kind: 'car', victim: 'sedan', cop: true, bike: false, wanted: true }))) caughtWanted++;
}
console.log('without wanted level, wanted lines shown:', leaked, '(expect 0)');
console.log('with wanted level, share with a wanted line:', (shown / n * 100).toFixed(1) + '%', '(expect about 35%)');
console.log('cop catch under wanted level with a wanted line:', caughtWanted, '(expect 0)');
