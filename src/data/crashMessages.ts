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
 *   caught                a police car got you (the only tag such lines need: they replace the hit / solo lines)
 *   wanted                you crashed with a wanted level active (police stars); shown only some of the time
 *   barrier / tree / rock ran into the roadside barrier / a tree / a rock
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
  wanted?: boolean; // a wanted level was active when you crashed
  bike: boolean;
}

interface Msg { t: string; need: string[] }

// one line per message: `facts needed|text` (a single string keeps the bundle's string-literal count low)
const RAW = `
hit|You just killed a family of 4
hit|Congrats, you just paralyzed a guy who was just going to work
hit|Nice one. Somebody was waiting for that person to come home for dinner
hit|Great driving. A kid just lost their dad and you lost about 4 seconds
hit|Bravo. That was somebody's daughter, and she was running late for her own graduation
hit|Hope the score was worth it. The ambulance is already on its way, and it's not for you
hit|You saved 40 seconds off your commute. He'll never finish his
hit|Congratulations, you are now the reason a nurse is not going to make her shift
hit|Impressive. You turned a normal Tuesday into a funeral
hit|They were 2 minutes from home. You were in a hurry
hit|You just turned a wedding anniversary into a memorial service
hit|Well done. A whole family is about to have a very different Thanksgiving
hit|You won't be on the news, but the person you hit will be, in the obituaries
hit|Top speed unlocked. Somebody's empty chair unlocked as well
hit|Nice cut-up. Now explain it to a grieving mother, champ
hit|Thanks for the rush. Somebody's grandma was on her way to see the baby for the first time
hit|Reckless driving: 0 seconds saved, 1 life ruined
hit|The other driver was going to propose tonight. The ring is still in the glovebox
hit|Congrats, you just turned a school run into a police report
hit|A doctor was in that car. Good luck finding another one on a Sunday night
hit|Cheers. 3 kids just learned what a hospital waiting room feels like
hit|You just bought somebody 6 months of physical therapy, and they didn't even want to buy it
hit|Congrats, you made the score board and ruined a man who was just picking up milk
hit|Sorry, was that a bad time? Somebody was on the phone telling their mum they'd be there soon
hit|They said reckless driving is a growing problem. You are the problem
hit|Now imagine if that was in real life
headon|Head-on. You did not just risk your own life, you brought a stranger along for the ride
headon|Wrong lane, wrong day. Oncoming traffic has families too
headon|You picked the wrong side of the road, and somebody else paid for the ticket
headon|Two cars, one lane, and somebody's whole future in between
hit,truck|That was somebody's work truck. Their livelihood, and possibly more
hit,truck|Hitting a truck. A bold way to find out what a few tons of steel think of you
hit,truck|The driver of that vehicle was almost done for the day. Now they are done for good
hit,bike|A motorcycle has no crumple zone. Neither does the rider, or the person you hit
hit,bike|Helmets are great. Physics does not care
hit,city|Rush hour on the highway, and somebody was just trying to get home
hit,city|You closed the whole highway. Enjoy being the traffic report
hit,city|Concrete on both sides and nowhere to go. They never stood a chance
hit,country|Open highway, clear skies, and you still found a way to hit somebody
hit,country|Amazing overtake. Shame about the person you overtook into a guardrail
hit,country|Beautiful scenery. Shame it was the last thing they ever saw
hit,forest|A quiet forest road and you turned it into a crime scene
hit,forest|The trees saw everything. They won't testify, but the family will
hit,forest|No guardrails out here, and no second chances either
hit,forest|No witnesses on a backroad, just birds and one terrible decision
solo|Nice one, you ended your life
solo|Congrats, you played yourself. Permanently
solo|Well done. Your family is picking out a casket instead of a birthday cake
solo|Great driving. The undertaker sends his thanks for the business
solo|Bravo. You beat the speed limit and your own life expectancy
solo|Hope it was worth it. Your mom is getting a phone call she never wanted
solo|You saved a few minutes off your commute and about 50 years off your life
solo|Impressive. You made it to the afterlife ahead of schedule
solo|Nobody else got hurt, so at least you did all the dying by yourself
solo|Congratulations, you are the only victim. Truly efficient
solo|Somebody has to clean that up, and it is not going to be you
solo|Fast, furious and now dead
solo|Rest in pieces
solo|Your insurance company has stopped laughing. Your family has started crying
solo|You will be remembered as "that idiot who thought the road was a racetrack"
solo|Great news: no other family was hurt. Yours has a funeral to plan
solo|You are officially the safest driver on the road now. Zero risk from the inside of a coffin
solo|That was a really fast way to become a statistic
solo|The world is a slightly safer place today. Thank you for your sacrifice
solo|Congrats. The ambulance will not be needing the siren
caught|Congratulations, you outran nobody. The officer would like a word
caught|Nice run. The officer had a full tank, a siren and absolutely nothing better to do
caught|You have the right to remain silent. Your driving already said plenty
caught|Great news, you finally got a police escort. The handcuffs are complimentary
caught|That was a bold strategy, outrunning a car that comes with a siren and a radio
caught|Speeding, reckless driving and being outdriven by a patrol car. Quite the hat trick
caught|The officer thanks you for your cooperation, which was not voluntary
caught|You just made a police officer's whole week. He will tell this story at every dinner
caught|Somebody call your lawyer. Then call a better one
caught|Officer 1, you 0. He did not even spill his coffee
caught|Slow down, they said. You did not, and now he gets to say it in person
caught,car|Your car is going to the impound lot. You are going to explain this to your mother
caught|You put up a good fight, for about as long as a coffee break
caught|The good news is you are finally going somewhere with a police escort
caught,city|Six lanes of open highway and you still got caught by the guy with the siren
caught,country|Beautiful day, open road, and a patrol car that would not quit
caught,forest|A winding backroad, no witnesses, and yet here comes the paperwork
caught,bike|Two wheels, no siren, and a cop who did not even need to hurry
caught,bike|Helmets are mandatory. So is stopping when the lights come on
wanted|Well, I guess you got away. Just not in the way you planned
wanted|The cops can stop chasing you now. You saved them the paperwork
wanted|You lost the police. Unfortunately you lost everything else along with them
barrier,city|The wall had the right of way. It always does
barrier,country|The rail had the right of way. It always does
barrier|You found out what the barrier is made of. Spoiler: it is harder than you
barrier|You ran out of road before you ran out of confidence
barrier,city|Concrete does not negotiate
barrier,city|You used the highway wall as a brake. It worked, once
barrier,country|That guardrail was there to save your life. You tested it anyway
barrier,country|The guardrail did its job. It just could not do yours
tree|The tree did not even swerve. Wow
tree|A tree is very hard to overtake
tree|Nature 1, driver 0
tree|The forest gets to keep you now
tree|Trees have been standing there for 200 years. You lasted 4 seconds of bad judgement
tree|No guardrails on this road. Just you, physics and one very patient tree
rock|A rock has been sitting there for ten thousand years. You lasted about four seconds
rock|Rocks do not swerve, they do not brake, and they always win
rock|You got outperformed by a rock. Let that sink in, briefly
rock|It was not even a big rock
rock|Nature left a speed bump. You took it at full speed
rock|The rock did not even flinch
fall|Congrats, you rode your own motorcycle into the ground. And yourself along with it
fall,bike|It has two wheels. You had one job
looped|You looped it. Gravity always collects
looped|Wheelie champion, landing critic. Zero out of ten
endo|Front brake, you say? The handlebars say hello
endo|You went over the bars. The road broke your fall, and the rest of you
highside|The rear tyre gripped. Your body did not
highside|A highside: the bike stayed together, which is more than we can say for you
lowside|You laid it down and it laid you out
lowside|Lowside. You slid further than your last excuse
tipover|You fell over at walking pace. Impressive in the worst way
tipover|Balance is a skill. Turns out you were skipping that class
`;

const MESSAGES: Msg[] = RAW.trim().split('\n').map((row) => { const i = row.indexOf('|'); return { t: row.slice(i + 1), need: row.slice(0, i).split(',') }; });

const FALLS = new Set(['lowside', 'highside', 'looped', 'endo', 'tipover']);
const TRUCKS = new Set(['boxtruck', 'van', 'pickup']);

/** the facts about a crash that messages are matched against */
export function crashFacts(c: CrashContext) {
  const hit = c.kind === 'car' || c.kind === 'headon';
  // a police car catching you gets its own set of lines
  if (hit && c.cop) return new Set<string>(['caught', c.map, c.bike ? 'bike' : 'car']);
  const f = new Set<string>([c.map, c.kind, c.bike ? 'bike' : 'car']);
  f.add(hit ? 'hit' : 'solo');
  if (FALLS.has(c.kind)) f.add('fall');
  if (c.kind === 'barrier' || c.kind === 'tree' || c.kind === 'rock') f.add(c.kind);
  if (c.victim && TRUCKS.has(c.victim)) f.add('truck');
  if (c.cop) f.add('cop');
  if (c.wanted) f.add('wanted');
  return f;
}

/** how often a crash under a wanted level gets one of the wanted lines instead of the usual ones */
const WANTED_CHANCE = 0.35;

const recent: string[] = [];
/** a random message that fits the crash; specific lines are favoured; no repeats until most have been seen */
export function randomCrashMessage(c: CrashContext) {
  const facts = crashFacts(c);
  // wanted lines only sometimes come up when a wanted level is active, and never otherwise
  const wanted = facts.has('wanted') && Math.random() < WANTED_CHANCE;
  let pool = MESSAGES.filter((x) => x.need.every((n) => facts.has(n)) && x.need.includes('wanted') === wanted);
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
