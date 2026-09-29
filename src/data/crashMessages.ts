/**
 * The game's message: reckless driving hurts real people. One of these is shown on every crash, in the
 * dark, sarcastic voice of the game. Every line only appears when it fits what actually happened: a line
 * about guardrails never shows on the backroad (there are none), a line about trees never shows on a highway.
 *
 * `need` lists the facts that must all be true for a line to be used:
 *   hit / solo            traffic was hit  /  nobody else was involved
 *   headon                hit an oncoming car
 *   truck                 what was hit is a truck, van or pickup
 *   cop                   what was hit is a police car
 *   barrier / tree        ran into the roadside barrier / a tree
 *   fall                  a rider fall (lowside, highside, looped, endo, tipover), also by its own name
 *   bike / car            what you were driving
 *   city / country / forest   the map (city = walled concrete highway, country = guardrails, forest = trees, no rails)
 * More specific lines (longer `need`) are picked more often than the generic ones.
 */
export interface CrashContext {
  map: 'city' | 'country' | 'forest';
  kind: string; // CrashKind
  victim?: string; // traffic type that was hit
  cop?: boolean; // the car hit was a police car
  bike: boolean;
}

interface Msg { t: string; need: string[] }
const m = (t: string, ...need: string[]): Msg => ({ t, need });

const MESSAGES: Msg[] = [
  // ---- you hit somebody else (any map) ----
  m('You just killed a family of 4', 'hit'),
  m('Congrats, you just paralyzed a guy who was just going to work', 'hit'),
  m('Nice one. Somebody was waiting for that person to come home for dinner', 'hit'),
  m('Great driving. A kid just lost their dad and you lost about 4 seconds', 'hit'),
  m('Bravo. That was somebody\'s daughter, and she was running late for her own graduation', 'hit'),
  m('Hope the score was worth it. The ambulance is already on its way, and it\'s not for you', 'hit'),
  m('You saved 40 seconds off your commute. He\'ll never finish his', 'hit'),
  m('Congratulations, you are now the reason a nurse is not going to make her shift', 'hit'),
  m('Impressive. You turned a normal Tuesday into a funeral', 'hit'),
  m('They were 2 minutes from home. You were in a hurry', 'hit'),
  m('You just turned a wedding anniversary into a memorial service', 'hit'),
  m('Well done. A whole family is about to have a very different Thanksgiving', 'hit'),
  m('You won\'t be on the news, but the person you hit will be, in the obituaries', 'hit'),
  m('Top speed unlocked. Somebody\'s empty chair unlocked as well', 'hit'),
  m('Nice cut-up. Now explain it to a grieving mother, champ', 'hit'),
  m('Thanks for the rush. Somebody\'s grandma was on her way to see the baby for the first time', 'hit'),
  m('Reckless driving: 0 seconds saved, 1 life ruined', 'hit'),
  m('The other driver was going to propose tonight. The ring is still in the glovebox', 'hit'),
  m('Congrats, you just turned a school run into a police report', 'hit'),
  m('A doctor was in that car. Good luck finding another one on a Sunday night', 'hit'),
  m('Cheers. 3 kids just learned what a hospital waiting room feels like', 'hit'),
  m('You just bought somebody 6 months of physical therapy, and they didn\'t even want to buy it', 'hit'),
  m('Congrats, you made the score board and ruined a man who was just picking up milk', 'hit'),
  m('Sorry, was that a bad time? Somebody was on the phone telling their mum they\'d be there soon', 'hit'),
  m('They said reckless driving is a growing problem. You are the problem', 'hit'),
  m('You are one bad decision away from being the worst thing that ever happened to a stranger', 'hit'),
  // hitting oncoming traffic
  m('Head-on. You did not just risk your own life, you brought a stranger along for the ride', 'headon'),
  m('Wrong lane, wrong day. Oncoming traffic has families too', 'headon'),
  m('You picked the wrong side of the road, and somebody else paid for the ticket', 'headon'),
  m('Two cars, one lane, and somebody\'s whole future in between', 'headon'),
  // hitting a truck / van
  m('That was somebody\'s work truck. Their livelihood, and possibly more', 'hit', 'truck'),
  m('Hitting a truck. A bold way to find out what a few tons of steel think of you', 'hit', 'truck'),
  m('The driver of that vehicle was almost done for the day. Now they are done for good', 'hit', 'truck'),
  m('You rammed a police car. The paperwork is going to be the least of your problems', 'hit', 'cop'),
  m('Assaulting an officer, resisting arrest, and now this. The judge will read your obituary instead', 'hit', 'cop'),
  // riding a bike into somebody
  m('A motorcycle has no crumple zone. Neither does the rider, or the person you hit', 'hit', 'bike'),
  m('Helmets are great. Physics does not care', 'hit', 'bike'),
  // by map
  m('Rush hour on the highway, and somebody was just trying to get home', 'hit', 'city'),
  m('You closed the whole highway. Enjoy being the traffic report', 'hit', 'city'),
  m('Concrete on both sides and nowhere to go. They never stood a chance', 'hit', 'city'),
  m('Open highway, clear skies, and you still found a way to hit somebody', 'hit', 'country'),
  m('Amazing overtake. Shame about the person you overtook into a guardrail', 'hit', 'country'),
  m('Beautiful scenery. Shame it was the last thing they ever saw', 'hit', 'country'),
  m('A quiet forest road and you turned it into a crime scene', 'hit', 'forest'),
  m('The trees saw everything. They won\'t testify, but the family will', 'hit', 'forest'),
  m('No guardrails out here, and no second chances either', 'hit', 'forest'),
  m('No witnesses on a backroad, just birds and one terrible decision', 'hit', 'forest'),

  // ---- you crashed on your own (any map) ----
  m('Nice one, you ended your life', 'solo'),
  m('Congrats, you played yourself. Permanently', 'solo'),
  m('Well done. Your family is picking out a casket instead of a birthday cake', 'solo'),
  m('Great driving. The undertaker sends his thanks for the business', 'solo'),
  m('Bravo. You beat the speed limit and your own life expectancy', 'solo'),
  m('Hope it was worth it. Your mom is getting a phone call she never wanted', 'solo'),
  m('You saved a few minutes off your commute and about 50 years off your life', 'solo'),
  m('Impressive. You made it to the afterlife ahead of schedule', 'solo'),
  m('Nobody else got hurt, so at least you did all the dying by yourself', 'solo'),
  m('Congratulations, you are the only victim. Truly efficient', 'solo'),
  m('Somebody has to clean that up, and it is not going to be you', 'solo'),
  m('Fast, furious and now dead', 'solo'),
  m('Rest in pieces', 'solo'),
  m('Your insurance company has stopped laughing. Your family has started crying', 'solo'),
  m('You will be remembered as "that idiot who thought the road was a racetrack"', 'solo'),
  m('Great news: no other family was hurt. Yours has a funeral to plan', 'solo'),
  m('You are officially the safest driver on the road now. Zero risk from the inside of a coffin', 'solo'),
  m('That was a really fast way to become a statistic', 'solo'),
  m('The world is a slightly safer place today. Thank you for your sacrifice', 'solo'),
  m('Congrats. The ambulance will not be needing the siren', 'solo'),
  // barriers
  m('The wall had the right of way. It always does', 'barrier', 'city'),
  m('The rail had the right of way. It always does', 'barrier', 'country'),
  m('You found out what the barrier is made of. Spoiler: it is harder than you', 'barrier'),
  m('You ran out of road before you ran out of confidence', 'barrier'),
  m('Concrete does not negotiate', 'barrier', 'city'),
  m('You used the highway wall as a brake. It worked, once', 'barrier', 'city'),
  m('That guardrail was there to save your life. You tested it anyway', 'barrier', 'country'),
  m('The guardrail did its job. It just could not do yours', 'barrier', 'country'),
  // trees (backroad)
  m('The tree did not even swerve. Wow', 'tree'),
  m('A tree is very hard to overtake', 'tree'),
  m('Nature 1, driver 0', 'tree'),
  m('The forest gets to keep you now', 'tree'),
  m('Trees have been standing there for 200 years. You lasted 4 seconds of bad judgement', 'tree'),
  m('No guardrails on this road. Just you, physics and one very patient tree', 'tree'),
  // motorcycle falls
  m('Congrats, you rode your own motorcycle into the ground. And yourself along with it', 'fall'),
  m('It has two wheels. You had one job', 'fall', 'bike'),
  m('You looped it. Gravity always collects', 'looped'),
  m('Wheelie champion, landing critic. Zero out of ten', 'looped'),
  m('Front brake, you say? The handlebars say hello', 'endo'),
  m('You went over the bars. The road broke your fall, and the rest of you', 'endo'),
  m('The rear tyre gripped. Your body did not', 'highside'),
  m('A highside: the bike stayed together, which is more than we can say for you', 'highside'),
  m('You laid it down and it laid you out', 'lowside'),
  m('Lowside. You slid further than your last excuse', 'lowside'),
  m('You fell over at walking pace. Impressive in the worst way', 'tipover'),
  m('Balance is a skill. Turns out you were skipping that class', 'tipover'),
];

const FALLS = new Set(['lowside', 'highside', 'looped', 'endo', 'tipover']);
const TRUCKS = new Set(['boxtruck', 'van', 'pickup']);

/** the facts about a crash that messages are matched against */
export function crashFacts(c: CrashContext) {
  const f = new Set<string>([c.map, c.kind, c.bike ? 'bike' : 'car']);
  const hit = c.kind === 'car' || c.kind === 'headon';
  f.add(hit ? 'hit' : 'solo');
  if (FALLS.has(c.kind)) f.add('fall');
  if (c.kind === 'barrier' || c.kind === 'tree') f.add(c.kind);
  if (c.victim && TRUCKS.has(c.victim)) f.add('truck');
  if (c.cop) f.add('cop');
  return f;
}

const recent: string[] = [];
/** a random message that fits the crash; specific lines are favoured; no repeats until most have been seen */
export function randomCrashMessage(c: CrashContext) {
  const facts = crashFacts(c);
  let pool = MESSAGES.filter((x) => x.need.every((n) => facts.has(n)));
  const fresh = pool.filter((x) => !recent.includes(x.t));
  if (fresh.length) pool = fresh;
  const weights = pool.map((x) => 1 + x.need.length * 1.5);
  let r = Math.random() * weights.reduce((a, b) => a + b, 0), pick = pool[0];
  for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) { pick = pool[i]; break; } }
  recent.push(pick.t); if (recent.length > 12) recent.shift();
  return pick.t;
}

/** every line, for tests */
export const ALL_CRASH_MESSAGES = MESSAGES;
