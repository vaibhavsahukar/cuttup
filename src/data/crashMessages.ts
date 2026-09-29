/**
 * The game's message: reckless driving hurts real people. One of these is shown on every crash,
 * in the dark, sarcastic voice of the game.
 */
export const CRASH_MESSAGES = [
  'You just killed a family of 4',
  'Congrats, you just paralyzed a guy who was just going to work',
  'Nice one. Somebody was waiting for that person to come home for dinner',
  'Great driving. A kid just lost their dad and you lost about 4 seconds',
  'Bravo. That was somebody\'s daughter, and she was running late for her own graduation',
  'Hope the score was worth it. The ambulance is already on its way, and it\'s not for you',
  'You saved 40 seconds off your commute. He\'ll never finish his',
  'Congratulations, you are now the reason a nurse is not going to make her shift',
  'Impressive. You turned a normal Tuesday into a funeral',
  'They were 2 minutes from home. You were in a hurry',
  'You just turned a wedding anniversary into a memorial service',
  'Well done. A whole family is about to have a very different Thanksgiving',
  'That guy was the only one who knew how to fix your dad\'s pension. Not anymore',
  'You won\'t be on the news, but the person you hit will be, in the obituaries',
  'Top speed unlocked. Somebody\'s empty chair unlocked as well',
  'Nice cut-up. Now explain it to a grieving mother, champ',
  'Thanks for the rush. Somebody\'s grandma was on her way to see the baby for the first time',
  'Reckless driving: 0 seconds saved, 1 life ruined',
  'You really showed them. The tow truck driver will show them a body bag',
  'The other driver was going to propose tonight. Ring\'s still in the glovebox',
  'Congrats, you just turned a school run into a police report',
  'A doctor was in that car. Good luck finding another one on a Sunday night',
  'Cheers. 3 kids just learned what a hospital waiting room feels like',
  'You just bought somebody 6 months of physical therapy, and they didn\'t even want to buy it',
  'Amazing overtake. Shame about the person you overtook into a guardrail',
  'Speed kills. You just proved it with somebody else\'s life',
  'Congrats, you hit the score board and a man who was just picking up milk',
  'Sorry, was that a bad time? Somebody was on the phone telling their mum they\'d be there soon',
  'They said reckless driving is a growing problem. You are the problem',
  'You are one bad decision away from being the worst thing that ever happened to a stranger',
];

/**
 * Crashes where nobody else was hit (wall, tree, running off the road, falling off a bike): the only life
 * lost is the driver's, so the sarcasm turns on them.
 */
export const SELF_CRASH_MESSAGES = [
  'Nice one, you ended your life',
  'Congrats, you played yourself. Permanently',
  'Well done. Your family is picking out a casket instead of a birthday cake',
  'Great driving. The undertaker sends his thanks for the business',
  'Bravo. You beat the speed limit and your own life expectancy',
  'Hope it was worth it. Your mom is getting a phone call she never wanted',
  'You saved a few minutes off your commute and about 50 years off your life',
  'Impressive. You made it to the afterlife ahead of schedule',
  'Nobody else got hurt, so at least you did all the dying by yourself',
  'The wall had the right of way. It always does',
  'You found out what the barrier is made of. Spoiler: it is harder than you',
  'Your last words were "watch this". They will be on the headstone',
  'Congratulations, you are the only victim. Truly efficient',
  'Somebody has to scrape that off the road, and it is not going to be you',
  'Fast, furious and now dead',
  'Rest in pieces',
  'Your insurance company has stopped laughing. Your family has started crying',
  'You will be remembered as "that idiot who thought the road was a racetrack"',
  'Great news: no other family was hurt. Yours has a funeral to plan',
  'The tree did not even swerve. Wow',
  'You are officially the safest driver on the road now. Zero risk from the inside of a coffin',
  'That was a really fast way to become a statistic',
  'The world is a slightly safer place today. Thank you for your sacrifice',
  'Congrats. The ambulance will not be needing the siren',
];

const OTHERS = new Set(['car', 'headon']);
/** a random message that fits the crash, never the same one twice in a row */
const last: Record<string, number> = {};
export function randomCrashMessage(kind: string = 'car') {
  const list = OTHERS.has(kind) ? CRASH_MESSAGES : SELF_CRASH_MESSAGES;
  const key = OTHERS.has(kind) ? 'o' : 's';
  let i = Math.floor(Math.random() * list.length);
  if (i === last[key]) i = (i + 1) % list.length;
  last[key] = i;
  return list[i];
}
