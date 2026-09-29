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

/** a random message that is not the same as the last one shown */
let last = -1;
export function randomCrashMessage() {
  let i = Math.floor(Math.random() * CRASH_MESSAGES.length);
  if (i === last) i = (i + 1) % CRASH_MESSAGES.length;
  last = i;
  return CRASH_MESSAGES[i];
}
