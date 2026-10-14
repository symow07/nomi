/**
 * The conversations `tools/check-language-release.mjs` holds with a workspace's REAL catalogue, the same in every
 * language, and the verdict on them (the owner, 2026-10-14). Pure, so tests/parity/language-release.test.ts holds the
 * words complete and the verdict exact.
 *
 * Four conversations a buyer really has, twelve messages in all: finding a product and its price, then a discount and
 * the delivery time; "are you a bot?"; asking for the manager; a price and a yes. {p} is the product's name in that
 * language, {q} a quantity it sells in. A conversation ends where it is handed to a person — the worker runs no turn
 * after that — so a run counts the turns it really had.
 */
export const CONVERSATIONS = [
  ['find', ['hello', 'looking', 'options', 'thatsIt', 'priceFor', 'discount', 'leadTime']],
  ['bot', ['bot']],
  ['person', ['hello', 'manager']],
  ['yes', ['priceFor', 'yes']],
];

export const WORDS = {
  en: {
    hello: () => 'Hello there',
    looking: (p) => `I'm looking for ${p}`,
    options: () => 'What sizes or colours do you have?',
    thatsIt: () => "Yes, that's the one",
    priceFor: (p, q) => `How much for ${q} pieces of ${p}?`,
    discount: () => 'Can you lower the price a little?',
    leadTime: () => 'How long does delivery take?',
    bot: () => 'Are you a bot?',
    manager: () => 'I want to speak to the manager',
    yes: (p, q) => `OK, I want ${q} pieces`,
  },
  zh: {
    hello: () => '你好',
    looking: (p) => `我在找${p}`,
    options: () => '有哪些尺寸或颜色？',
    thatsIt: () => '对，就是这个',
    priceFor: (p, q) => `${p}${q}个多少钱？`,
    discount: () => '价格能便宜一点吗？',
    leadTime: () => '交货要多久？',
    bot: () => '你是机器人吗？',
    manager: () => '我想跟你们经理谈',
    yes: (p, q) => `好的，我要${q}个`,
  },
  ar: {
    hello: () => 'مرحبا، السلام عليكم',
    looking: (p) => `أبحث عن ${p}`,
    options: () => 'ما المقاسات أو الألوان المتوفرة؟',
    thatsIt: () => 'نعم، هذا هو المطلوب',
    priceFor: (p, q) => `كم سعر ${q} قطعة من ${p}؟`,
    discount: () => 'هل يمكن تخفيض السعر قليلاً؟',
    leadTime: () => 'كم مدة التسليم؟',
    bot: () => 'هل أنت روبوت؟',
    manager: () => 'أريد التحدث مع المدير',
    yes: (p, q) => `تمام، أريد ${q} قطعة`,
  },
};

/** What reached the buyer: a reply sent alone, a hand-off they were told of, a draft they wait on, or nothing. */
export const ENDS = ['sent', 'told', 'held', 'nothing'];

/**
 * The verdict. `runs`: one row per turn — { lang, step: 'find#3', end, gendered: string|null }.
 *   · gendered — a reply that reached a buyer in `lang` and still addresses them in a gender;
 *   · silent   — a turn in `lang` whose buyer got nothing: a draft (held) or nothing at all;
 *   · splits   — a step whose most common end in `lang` differs from its most common end in another language (a
 *                step another language never reached is not compared).
 * It passes only when all three are empty, every turn ran, and `lang` ran at least `atLeast` turns.
 */
export function verdict(runs, { lang = 'ar', against = ['en', 'zh'], atLeast = 60, failed = 0 } = {}) {
  const mine = runs.filter((r) => r.lang === lang);
  const gendered = mine.filter((r) => r.gendered && (r.end === 'sent' || r.end === 'told'));
  const silent = mine.filter((r) => r.end === 'held' || r.end === 'nothing');
  const usual = (l, step) => {
    const counts = new Map();
    for (const r of runs) if (r.lang === l && r.step === step) counts.set(r.end, (counts.get(r.end) ?? 0) + 1);
    if (counts.size === 0) return null;
    // Most common; a tie is broken by the order of ENDS, so the verdict never depends on the order of the runs.
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || ENDS.indexOf(a[0]) - ENDS.indexOf(b[0]))[0][0];
  };
  const steps = [...new Set(mine.map((r) => r.step))];
  const splits = [];
  for (const step of steps) {
    const here = usual(lang, step);
    for (const other of against) {
      const there = usual(other, step);
      if (there !== null && there !== here) splits.push({ step, [lang]: here, [other]: there });
    }
  }
  const pass = gendered.length === 0 && silent.length === 0 && splits.length === 0 && failed === 0 && mine.length >= atLeast;
  return { turns: mine.length, gendered, silent, splits, failed, pass };
}
