/**
 * ONE GREETING, NOT TWO (the owner, 2026-10-28). The disclosure opens with its own "Hi, I'm {name}…" / 您好，我是… /
 * مرحبًا، أنا… / Hola, soy… / Bonjour, je suis… / Olá, sou…, and it goes in front of the first reply sent alone. A
 * reply that opens with its own "Hi Amal!" then greets the customer twice in one message. The disclosure is signed
 * word for word and is never touched; the reply's opening greeting is what goes.
 *
 * Read by fixed rules, not a model, like the other sentence readers: a greeting at the very start of the reply — the
 * word, perhaps "there" / "again" or one name, then its own punctuation or the end of the line — in the disclosure's
 * six languages. Nothing else is taken: "Hello Kitty bags are $5" and "Hi-vis vests" have no punctuation where a
 * greeting ends, so they stay. A reply that was only a greeting leaves nothing, and the disclosure says hello for it.
 * The corpus, both ways, is tests/parity/opening-greeting.test.ts — a new phrasing goes there first.
 *
 * Only the reply the writer wrote: the fixed sentences that also travel behind the disclosure (Telegram's signed
 * /start greeting, the survey's question) are said word for word, as signed.
 */

const AR_MARKS = '[\\u064B-\\u0652\\u0670\\u0640]*';
/** An Arabic word with its vowel marks, tatweel and the alef's forms allowed wherever they may be written. */
const ar = (word: string): string =>
  [...word].map((c) => (c === 'ا' || c === 'أ' ? '[اأإآ]' : c === ' ' ? '\\s+' : c) + (c === ' ' ? '' : AR_MARKS)).join('');

const LATIN = [
  'hi', 'hello', 'hey', 'hiya', 'howdy', 'greetings', 'good (?:morning|afternoon|evening|day)',
  'hola', 'buen(?:os|as) (?:d[ií]as|tardes|noches)', 'buenas',
  'bonjour', 'bonsoir', 'salut', 'coucou',
  'ol[áa]', 'oi', 'bom dia', 'boa (?:tarde|noite)',
].map((g) => g.replace(/ /g, '\\s+')).join('|');
const LATIN_AFTER = '(?:\\s+(?:there|again|all|everyone|a\\s+todos|à\\s+tous|tout\\s+le\\s+monde|pessoal))?';
const ONE_NAME = "(?:\\s+\\p{L}[\\p{L}'’-]{0,24})?";

const HAN = '(?:您好|你好|嗨|哈喽|哈啰|亲爱的\\p{Script=Han}{0,4}|亲亲|亲|早上好|上午好|中午好|下午好|晚上好|早安)(?:呀|啊|哦|哟)?';

const ARABIC = [
  `${ar('مرحبا')}(?:\\s*${ar('بك')}(?:${ar('م')})?)?`,
  `${ar('أهلا')}(?:\\s*${ar('وسهلا')})?(?:\\s*${ar('بك')}(?:${ar('م')})?)?`,
  `${ar('السلام عليكم')}(?:\\s+${ar('ورحمة الله')}(?:\\s+${ar('وبركاته')})?)?`,
  ar('صباح الخير'), ar('مساء الخير'), ar('هلا'),
].join('|');

/** Where a greeting ends: its own punctuation, a line break or the end — then any emoji or space after it. */
const END = '\\s*(?:[!,.;:،؛，！。～~、：]+|\\n|$)[\\s\\p{Extended_Pictographic}\\uFE0F\\u200D]*';

const OPENING: readonly RegExp[] = [
  new RegExp(`^\\s*[¡¿]?(?:${LATIN})${LATIN_AFTER}${ONE_NAME}${END}`, 'iu'),
  new RegExp(`^\\s*${HAN}${END}`, 'u'),
  new RegExp(`^\\s*(?:${ARABIC})(?:\\s+\\p{L}{1,25})?${END}`, 'u'),
];

/** The reply without the greeting it opens with; the reply itself when it opens with none. */
export function withoutOpeningGreeting(reply: string): string {
  let rest = reply;
  // Twice at most: "Hello! Good morning, …" is still one opening.
  for (let i = 0; i < 2; i++) {
    const re = OPENING.find((r) => r.test(rest));
    if (!re) break;
    rest = rest.replace(re, '');
  }
  if (rest === reply) return reply;
  rest = rest.trimStart();
  return rest.charAt(0).toLocaleUpperCase() + rest.slice(1);
}
