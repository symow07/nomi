import type { Signal } from './signals.js';
import { type Money, scaleMoney, isAbove } from '../types/money.js';
import type { ConversationState } from '../types/conversation.js';
import type { Analysis } from '../conversation/decide.js';
import { asksForDeletion, normalizeForDeletion } from '../safety/deletion.js';

/**
 * Deterministic signal detection from the message text and analysis.
 * Ported from the n8n Escalation Score Calculator; the request for a person
 * has since been rebuilt in two layers (below).
 */

/**
 * ── "WANTS A PERSON", IN TWO LAYERS (the owner's direction, 2026-09-28) ─────
 *
 * The n8n word list (`HUMAN_PHRASES`) matched words, not meaning, and failed
 * both ways: "human" fired on "human hair wigs", 找人工 on 找人工成本低的工厂
 * (a factory with low labour cost), «اريد احد» inside «اريد احدث موديل» (the
 * newest model), "call me" on "you can call me Ahmed" — while "Can I talk to
 * someone?", «أريد أحدًا يساعدني» typed with its hamza, "我要找你们经理" and
 * «أريد التحدث مع مديركم» handed nothing to anybody.
 *
 *   LAYER 1 — `asksForPerson`, here: the UNAMBIGUOUS requests only, in en / zh
 *   / ar. Instant, and no model is asked anything: the turn is gated before the
 *   analyser (pipeline/turn.ts). Each pattern needs a request's FRAME ("can I
 *   talk to", "I want to speak with", "put me through to", 转人工, «أريد التحدث
 *   مع») around a person who can only be the seller's, or a word that means one
 *   by itself (人工客服, "your manager", «مديركم»). A frame whose person is
 *   followed by the buyer's own side — "in my team", "at our company", «في
 *   شركتي» — does not count here.
 *
 *   LAYER 2 — `Analysis.wantsPerson`: everything layer 1 leaves goes to the
 *   analyser the turn already calls (prompts/analysis.txt): "is this buyer
 *   asking to speak to a person?" The buyer's own colleagues, a name, a product
 *   and a bare "are you a bot?" are its to rule out; when it is unsure it says
 *   yes, and an answer that cannot be read hands off as `not_answered`.
 *
 * AMBIGUOUS MEANS HAND OFF: a missed hand-off loses a buyer, a wrong one costs
 * the owner a minute. That decides every close call — which is why a phrase
 * leaves this list only for layer 2, never for nobody.
 *
 * tests/person/person-request.test.ts holds the corpus, both ways, per layer.
 */

/**
 * The text as the patterns read it: the deletion check's normalisation — NFKC,
 * lower case, Arabic diacritics and tatweel gone, «أ إ آ ٱ» read as «ا» (so
 * «أريد» with its hamza is the «اريد» written here), curly apostrophes
 * straightened, whitespace collapsed — and the letters a Persian or Urdu
 * keyboard gives Arabic: «ی ى» as «ي», «ک» as «ك». Every Arabic pattern below
 * is written in that folded form («على» is «علي», «إلى» is «الي»).
 *
 * NFKC turns the full-width ，！？；： into ASCII; 。 and 、 stay as they are, so
 * the Chinese stops name both.
 */
const readable = (text: string): string =>
  normalizeForDeletion(text).replace(/[یى]/g, 'ي').replace(/ک/g, 'ك');

/** Arabic letters, for word edges: `\b` knows only ASCII. */
const AR = String.raw`\u0621-\u064A\u066E-\u06D3`;

/**
 * A pattern that fires wherever it matches — unless the words right after the
 * person it matched put that person on the buyer's own side: "someone in my
 * team", "a person at our office", «شخص في شركتي». Those are the buyer's
 * business, and layer 2's to read.
 */
type Framed = { readonly re: RegExp; readonly own: RegExp | null };

const firesIn = (t: string, { re, own }: Framed): boolean => {
  for (const m of t.matchAll(re)) {
    if (own === null) return true;
    const end = m.index + m[0].length;
    if (!own.test(t.slice(end, end + 60))) return true;
  }
  return false;
};

// ── English ──────────────────────────────────────────────────────────────────
const EN_TALK = String.raw`(?:speak|talk|chat)\s+(?:to|with)`;
/**
 * "human" as a person, never as a product: it must end the phrase or be
 * followed by a word that cannot make it "human hair".
 */
const EN_HUMAN = String.raw`human(?:\s+being)?(?=\s*(?:$|[.!?,;:)]|(?:please|pls|plz|now|asap|not|instead|who|that|to|and|or|for|here|there|agent|on|at|about|in|from|with|i|we|if|so|because|thanks|thank)\b))`;
/** Who it is when it can only be the seller's: a human, an agent, customer service, "your …". */
const EN_THEIRS = String.raw`(?:(?:a|an|the|some|any)\s+)?(?:(?:real|actual|live)\s+)?(?:person|${EN_HUMAN}|agent|representative|rep|operator|salesperson|sales\s+(?:person|rep|representative|agent)|customer\s+(?:service|support|care)(?:\s+(?:agent|representative|rep|person|team))?)`
  + String.raw`|(?:one\s+of\s+)?your\s+(?:[a-z'-]+\s+){0,2}?(?:people|person|team|staff|colleagues?|boss|owner|supervisor|agents?|representatives?|reps?|salespeople|salesperson|support|customer\s+service)\b`
  // "Can I speak to sales?" — the seller's sales side, asked for by name.
  + String.raw`|(?:the\s+)?sales(?:\s+(?:team|department|dept|office))?\b`;
/** "Someone" — the seller's only where the frame asks the seller for them. */
const EN_SOMEONE = String.raw`(?:someone|somebody|anyone|anybody)(?:\s+(?:from|at|in|on)\s+your\s+[a-z'-]+)?`;
/** Asked of the seller outright ("can I speak to the owner?"), their own boss is not meant. */
const EN_ASKED = String.raw`(?:${EN_THEIRS}|${EN_SOMEONE}|the\s+(?:owner|boss|supervisor))`;
/** The buyer's own side, right after the person: "in my team", "at our office", "of mine". */
const EN_OWN = /^(?:\s+[a-z'-]+){0,3}?\s+(?:in|at|from|of|on|within|inside)\s+(?:my|our)\b|^\s+of\s+(?:mine|ours)\b/;
/** What may follow "call me" when it is a call and not a name ("call me Ahmed"). */
const EN_CALL_TAIL = String.raw`(?=\s*(?:$|[.!?,;:)]|\+?\d|(?:back|asap|now|please|pls|plz|at|on|when|whenever|tomorrow|today|tonight|later|soon|anytime|urgently|directly|right|immediately|first|instead|to|about|regarding|if|so|and|or)\b))`;
const EN_START = String.raw`(?:^|[.!?,;:]\s*)`;
/** Not asked for: "don't put me through to anyone", "no need to connect me with a person". */
const EN_NOT = String.raw`(?<!\b(?:don't|dont|do\s+not|no\s+need\s+to|never)\s+)`;
/** "I want", "we need", "I'd like", "I would rather" — a request, never a habit ("I like to talk to…"). */
const EN_WANT = String.raw`\b(?:i|we)(?:(?:\s+(?:really|just|do|still))?\s+(?:want|wanna|need|wish|demand|insist\s+on|prefer)|(?:'d|\s+would)\s+(?:(?:really|much)\s+)?(?:like|love|prefer|rather))`;

const EN: readonly Framed[] = [
  // "Can I talk to someone?", "could we speak with a person", "may I talk to the owner"
  { re: new RegExp(String.raw`\b(?:can|could|may|might)\s+(?:i|we)\s+(?:please\s+)?(?:just\s+)?${EN_TALK}\s+(?:${EN_ASKED})`, 'g'), own: EN_OWN },
  // "I want to speak to a real person", "I'd like to speak with a person", "we need to talk to someone"
  { re: new RegExp(String.raw`${EN_WANT}\s+(?:to\s+)?${EN_TALK}\s+(?:${EN_THEIRS}|${EN_SOMEONE})`, 'g'), own: EN_OWN },
  // "let me talk to a human" — never "let me talk to someone", which is as often their own
  { re: new RegExp(String.raw`${EN_NOT}\blet\s+(?:me|us)\s+${EN_TALK}\s+(?:${EN_THEIRS})`, 'g'), own: EN_OWN },
  // "put me through to someone", "connect me with a real person", "transfer me to customer service"
  { re: new RegExp(String.raw`${EN_NOT}\b(?:put|transfer|connect|pass|forward|switch|redirect|escalate)\s+(?:me|us|this|my\s+(?:call|chat|case|query|request))\s+(?:through\s+|over\s+)?(?:to|with)\s+(?:${EN_ASKED})`, 'g'), own: EN_OWN },
  // "I want a real person", "can I get a human?", "get me a live agent" — never "a human hair wig"
  { re: new RegExp(String.raw`(?:${EN_WANT}|\b(?:get|find|bring)\s+me|\b(?:can|could|may)\s+(?:i|we)\s+(?:please\s+)?(?:get|have))\s+(?:(?:to\s+(?:have|get)\s+)?(?:a|an))\s+(?:(?:real|actual|live)\s+(?:person|${EN_HUMAN}|agent|representative|rep)|human\s+(?:agent|representative|rep)|${EN_HUMAN})`, 'g'), own: EN_OWN },
  // "Speak with a person", "please talk to someone" — an imperative, at the start of a sentence
  { re: new RegExp(String.raw`${EN_START}(?:(?:please|pls|plz|kindly)\s+)?(?:just\s+)?${EN_TALK}\s+(?:${EN_THEIRS}|${EN_SOMEONE})`, 'g'), own: EN_OWN },
  // "is there someone I can talk to?"
  { re: new RegExp(String.raw`\b(?:is|are)\s+there\s+(?:someone|somebody|anyone|anybody|a\s+(?:real\s+)?(?:person|human))\s+(?:(?:i|we)\s+(?:can|could)\s+)?${EN_TALK}\b`, 'g'), own: null },
  // The whole message is the request: "real person please", "live agent", "human please", "agent!"
  { re: /^(?:(?:please|pls|plz)\s+)?(?:a\s+)?(?:real|live|actual|human)\s+(?:person|human|agent|operator|representative|rep)(?:\s+(?:please|pls|plz|now|asap))?\s*[.!?]*$/g, own: null },
  { re: /^(?:(?:please|pls|plz)\s+)?(?:human|agent|operator|representative|customer\s+service)(?:\s+(?:please|pls|plz|now|asap)\s*[.!]*|\s*!+)$/g, own: null },
  // A call — which only a person can make: "please call me", "can you call me back?", "call me asap",
  // "give me a call", "can I call you?". Never "you can call me Ahmed": a name is not a call.
  { re: new RegExp(String.raw`\b(?:please|pls|plz|kindly|can\s+you|could\s+you|would\s+you|will\s+you|can\s+(?:someone|somebody|anyone)|could\s+(?:someone|somebody|anyone))\s+(?:please\s+)?(?:call|phone|ring)\s+me${EN_CALL_TAIL}`, 'g'), own: null },
  { re: new RegExp(String.raw`${EN_START}(?:call|phone|ring)\s+me${EN_CALL_TAIL}`, 'g'), own: null },
  { re: new RegExp(String.raw`(?:${EN_START}|\b(?:please|pls|can\s+you|could\s+you)\s+)give\s+me\s+a\s+(?:call|ring)\b`, 'g'), own: null },
  { re: new RegExp(String.raw`(?:${EN_START}|\b(?:please|pls|kindly|can\s+you|could\s+you)\s+)(?:have|get|ask)\s+(?:someone|somebody|a\s+person)\s+(?:to\s+)?(?:call|phone|ring)\s+me${EN_CALL_TAIL}`, 'g'), own: null },
  { re: new RegExp(String.raw`\b(?:can|could|may)\s+(?:i|we)\s+(?:call|phone|ring)\s+you${EN_CALL_TAIL}`, 'g'), own: null },
  // "I need help from a human", "support from a real person" — help only a person gives
  { re: new RegExp(String.raw`${EN_NOT}\b(?:help|assistance|support)\s+from\s+(?:a\s+|an\s+)?(?:(?:real|actual|live)\s+)?(?:${EN_HUMAN}|person|agent|representative|rep)\b`, 'g'), own: EN_OWN },
  // The whole message: "Transfer me", "connect me please", "real human needed"
  { re: /^(?:(?:please|pls|plz)\s+)?(?:transfer|connect|escalate)\s+(?:me|this)(?:\s+(?:please|pls|plz|now|asap))?\s*[.!?]*$/g, own: null },
  { re: /^(?:a\s+)?(?:real|live|actual)\s+(?:person|human|agent)\s+(?:needed|required|wanted|please)\s*[.!?]*$/g, own: null },
  // "I don't want to talk to a bot" — asking for the one thing a bot is not
  { re: /\b(?:don't|dont|do\s+not)\s+want\s+to\s+(?:talk|speak|chat)\s+(?:to|with)\s+(?:a\s+|the\s+|your\s+|an\s+)?(?:bot|robot|machine|ai|chatbot|computer|auto[-\s]?reply)\b/g, own: null },
];

/**
 * "MANAGER", SPLIT BY WHOSE IT IS (the owner's decision, 2026-09-28; kept as
 * it was decided).
 *
 * It was on the n8n list as a bare word, so "my manager approved it" and "my
 * manager will confirm the price" — a buyer talking about their own colleague,
 * which trade chat does constantly — handed the conversation to a person
 * every time, for nothing.
 *
 *   · The buyer's OWN manager is not a request to reach a person: "my …
 *     manager", "our … manager", "I'm the … manager", "the … manager at my
 *     company". Up to two words between ("my new sales manager"), never
 *     "your", "to", "with" or "for" — "I'm talking to your manager" is not
 *     theirs.
 *   · Every OTHER mention hands off: "your manager", "speak to a manager",
 *     "the manager approved it". Whose manager "the manager" is cannot be told,
 *     and a wrong hand-off costs the owner a minute where a missed one loses a
 *     buyer.
 *
 * The same test for "someone in charge", which the owner named as the seller's
 * side: "let me talk to someone in charge" hands off; "someone in charge at my
 * company" does not.
 *
 * Chinese and Arabic have their manager below, in the seller's forms only
 * ("你们经理", «مديركم»); a bare 经理 or «المدير» outside a request is layer 2's
 * to read — "我问一下经理再回复你" is the buyer's own.
 */
const FILL = String.raw`(?:(?!your\b|yours\b|to\b|with\b|for\b)[a-z][a-z'-]*\s+){0,2}`;
const THEIR_OWN_MANAGER = new RegExp([
  String.raw`\b(?:my|our)\s+${FILL}managers?\b`,                                // my (new sales) manager
  String.raw`\bi(?:'?m| am)\s+(?:(?:the|a|an)\s+)?${FILL}managers?\b`,          // I'm the purchasing manager
  String.raw`\b(?:the|a)\s+${FILL}managers?\s+(?:of|at|in|from|on)\s+(?:my|our)\b`, // the manager at my company
].join('|'), 'g');
const IN_CHARGE = String.raw`\b(?:someone|somebody|anyone|anybody|(?:the|a|your)\s+person)\s+in\s+charge\b`;
const THEIR_OWN_IN_CHARGE = new RegExp(`${IN_CHARGE}\\s+(?:at|of|in|from|on)\\s+(?:my|our)\\b`, 'g');
const SELLERS_IN_CHARGE = new RegExp(IN_CHARGE);

const namesSellersManager = (t: string): boolean =>
  (t.includes('manager') && t.replace(THEIR_OWN_MANAGER, ' ').includes('manager'))
  || SELLERS_IN_CHARGE.test(t.replace(THEIR_OWN_IN_CHARGE, ' '));

// ── Chinese ──────────────────────────────────────────────────────────────────
/**
 * Where the word ends: anything that is not a Chinese character (punctuation,
 * full-width or not, a space, an emoji), or a particle or thanks. Another
 * character would make a compound: 人工成本 is labour cost, 人工智能 is AI.
 */
const ZH_STOP = String.raw`(?=$|[^\u4e00-\u9fff]|吧|啊|呀|哦|哈|吗|嗎|嘛|呢|谢|謝|好吗|好嗎|可以|行吗|行嗎)`;
const ZH_HEAD = String.raw`(?:经理|經理|老板|老闆|负责人|負責人|主管(?!部门|部門|单位|單位)|领导|領導|老总|老總)`;
/** Not asked for: 不用转人工, 别找真人, 不需要人工客服 — the buyer declining a person. */
const ZH_NOT = String.raw`(?<!不用|无需|無需|别|別|不|不需要|不要)`;
const ZH_TALK = String.raw`(?:说|說|聊|谈|談|沟通|溝通|对话|對話|交流|讲|講|联系|聯繫|通话|通話)`;

/** Somebody on the seller's side, in a buyer's Chinese: a real person, the human agent, their staff. */
const ZH_PERSON = String.raw`(?:真人|人工|客服(?:人员|人員)?|工作人员|工作人員|业务员|業務員|销售(?:人员|人員)?|銷售(?:人員)?|人)`;
/** "Your": 你们 / 您们 / 贵公司 …, with or without 的. */
const ZH_THEIRS = String.raw`(?:你们|你們|您们|您們|贵公司|貴公司|贵司|貴司|贵厂|貴廠)的?`;
/** A request's opening: 我要 / 我想 / 能不能 / 可以 / 请 … */
const ZH_ASK = String.raw`(?:我要|我想要|我想|我希望|想|要|能不能|能否|可不可以|可以|可否|能|麻烦|麻煩|请|請)`;
/** Where a request can begin: the start, a stop, or a word that asks. */
const ZH_REQ_START = String.raw`(?:^|[\s，,。.!！?？、；;：:]|请|請|麻烦|麻煩|能不能|可不可以|可以|能否|可否|能|快|赶紧|趕緊|你们|你們|你|您)`;
/** A call to the buyer that is not a report of one: never 了 / 过 after it. */
const ZH_NOT_DONE = String.raw`(?!了|过|過)`;

const ZH: readonly Framed[] = [
  // 人工客服 / 人工服务 — the human agent; never 人工 alone (人工成本 is labour cost, 人工智能 is AI)
  { re: new RegExp(String.raw`${ZH_NOT}人工(?:客服|服务|服務|坐席|座席|台)`, 'g'), own: null },
  // 转人工 / 我要人工 / 人工！ — 人工 where the request ends; never 需要人工 ("needs manual
  // labour") nor 没有人工 ("no hand work"), where it is the work and not a person
  { re: new RegExp(String.raw`${ZH_NOT}(?:转|轉|接|找|(?<!需)要|换|換|切|叫|呼叫)(?:个|個)?人工${ZH_STOP}`, 'g'), own: null },
  { re: /^人工[!.。]*$/g, own: null },
  // 转接客服 / 转接到经理 — put through to someone
  { re: new RegExp(String.raw`${ZH_NOT}(?:转接|轉接)(?:到|给|給)?(?:人工|真人|客服|经理|經理|负责人|負責人|工作人员|工作人員|主管)`, 'g'), own: null },
  // 真人客服; 找个真人 / 要真人 where it ends — never 找真人模特 (real models, for a photo shoot)
  { re: new RegExp(String.raw`${ZH_NOT}真人(?:客服|服务|服務)`, 'g'), own: null },
  { re: new RegExp(String.raw`${ZH_NOT}(?:找|(?<!需)要|换|換|转|轉|接)(?:一个|一個|个|個|一位|位)?真人${ZH_STOP}`, 'g'), own: null },
  // 我想和真人聊 / 跟工作人员谈 — a person the assistant is not
  { re: new RegExp(String.raw`${ZH_NOT}(?:和|跟|与|與|同)(?:一个|一個|个|個|一位|位)?(?:真人|工作人员|工作人員|客服人员|客服人員)${ZH_TALK}`, 'g'), own: null },
  // 你们经理 / 你们的负责人 / 贵公司老板 — the seller's manager, boss or person in charge, however named
  { re: new RegExp(String.raw`(?:你们|你們|您们|您們|贵公司|貴公司|贵司|貴司|贵厂|貴廠|(?:你|您)的)(?:(?![我])[\u4e00-\u9fff]){0,4}?${ZH_HEAD}`, 'g'), own: null },
  // 请经理联系我 / 让负责人跟我谈 — asked to come to THEM ("我让经理联系你" is their own)
  { re: new RegExp(String.raw`(?:请|請|让|讓|叫|麻烦|麻煩)(?:你们|你們|贵司|貴司)?的?${ZH_HEAD}(?:直接|马上|馬上)?(?:(?:联系|聯繫|打电话给|打電話給|回复|回覆)(?:一下)?我|给我打|給我打|回电|回電|跟我|和我|找我)`, 'g'), own: null },
  // 我要跟人说话 / 能不能和客服聊 / 我想跟你们的人谈 — to talk with a person the assistant is not
  { re: new RegExp(String.raw`${ZH_NOT}${ZH_ASK}(?:跟|和|与|與|同)(?:一个|一個|个|個|一位|位)?(?:${ZH_THEIRS})?${ZH_PERSON}${ZH_TALK}`, 'g'), own: null },
  // 我要找客服 / 可以找客服吗 / 找你们业务员 — find me one of theirs. Never 在找 (sourcing:
  // "我们在找销售渠道"), and never a compound (客服人员 is a job being filled).
  { re: new RegExp(String.raw`${ZH_NOT}(?<!在)(?:找|叫|换|換)(?:一个|一個|个|個|一位|位)?(?:${ZH_THEIRS})?(?:客服|业务员|業務員|销售|銷售|工作人员|工作人員)${ZH_STOP}`, 'g'), own: null },
  // 让你们销售联系我 / 叫你们的人给我打电话 / 请客服回复我 — their people, to come to THEM
  { re: new RegExp(String.raw`(?:请|請|让|讓|叫|麻烦|麻煩)(?:${ZH_THEIRS})?${ZH_PERSON}(?:直接|马上|馬上|尽快|盡快)?(?:(?:联系|聯繫|回复|回覆)(?:一下)?我|给我打|給我打|打电话给我|打電話給我|跟我|和我|找我)`, 'g'), own: null },
  // 给我打个电话 / 打电话给我 / 请电话联系我 / 请回电 — a call, which only a person makes;
  // never a report of one ("他给我打电话了", "我们经理给我打电话说…")
  { re: new RegExp(String.raw`${ZH_REQ_START}(?:给|給)我(?:打|回)(?:个|個|一个|一個)?(?:电话|電話)${ZH_NOT_DONE}`, 'g'), own: null },
  { re: new RegExp(String.raw`${ZH_REQ_START}打(?:个|個|一个|一個)?(?:电话|電話)(?:给|給)我${ZH_NOT_DONE}`, 'g'), own: null },
  { re: new RegExp(String.raw`${ZH_REQ_START}(?:电话|電話)联系我${ZH_NOT_DONE}`, 'g'), own: null },
  { re: new RegExp(String.raw`(?:^|[\s，,。.!！?？]|请|請|麻烦|麻煩)回(?:个|個)?(?:电|電)(?:话|話)?(?:给|給)?我?${ZH_STOP}`, 'g'), own: null },
  // 我想找个人聊聊 — someone to talk with; never 我找人问一下 (they ask their own)
  { re: new RegExp(String.raw`${ZH_NOT}(?<!在)找(?:一个|一個|个|個|一位|位)?人(?:来|來)?(?:(?:跟|和)我)?${ZH_TALK}`, 'g'), own: null },
  // 能打给我吗 / 打我电话 — call me, however it is put
  { re: new RegExp(String.raw`${ZH_REQ_START}打(?:给|給)我${ZH_NOT_DONE}`, 'g'), own: null },
  { re: new RegExp(String.raw`${ZH_REQ_START}打我(?:的)?(?:电话|電話|手机|手機)${ZH_NOT_DONE}`, 'g'), own: null },
  // 有没有真人 / 有真人吗 — is there a person to reach; never 真人秀, 真人模特 (a show, models)
  { re: new RegExp(String.raw`有(?:没有|沒有)?真人(?=$|[^\u4e00-\u9fff]|吗|嗎|呢|在|可以|能|跟|和|帮|幫|回|说|說|聊)`, 'g'), own: null },
  // 换个人跟我说 / 能换个人吗 — someone else, not this; never 换个人收货 (someone else receives)
  { re: new RegExp(String.raw`(?:换|換)(?:一个|一個|个|個)(?:真人|人)(?:来|來)?(?:(?:跟|和)我)?(?:${ZH_TALK}|(?=$|[^\u4e00-\u9fff]|吗|嗎|吧|呢))`, 'g'), own: null },
  // 我不想跟机器说话 / 不要机器人回复 — asking for the one thing a machine is not;
  // never 不要机器做的 (not machine-made)
  { re: new RegExp(String.raw`(?:不想|不要|不愿意|不願意)(?:(?:跟|和|与|與|同)(?:机器人|機器人|机器|機器|ai|自动回复|自動回覆)|(?:机器人|機器人|ai)(?:${ZH_TALK}|回复|回覆|聊天))`, 'g'), own: null },
];

// ── Arabic (read in the folded form: «اريد», «الي», «علي») ───────────────────
/** A word's start, and not after «لا / ما / مش / مو / لن / مب» (not): «لا اريد التحدث مع شخص» declines. */
const AR_NOT = String.raw`(?<![${AR}])(?<!(?:لا|ما|مش|مو|لن|مب)\s)`;
/** "I want", "I need", "can" — in MSA and the dialects buyers write in. */
const AR_WANTS = 'اريد|نريد|احتاج|نحتاج|ابي|ابغي|بدي|بدنا|عايز|عاوز|ممكن';
/** …before a person: «اريد احدا», «ممكن حد يرد». */
const AR_WANT_ONE = `(?:${AR_WANTS})`;
/** …before a verb, which more of them take: «اود التحدث», «يمكنني التواصل». */
const AR_WANT = `(?:${AR_WANTS}|ابغا|عايزه|عاوزه|حابب|حابه|اود|نود|يمكنني|اقدر|نقدر|ارجو|نرجو|اطلب|نطلب)`;
const AR_TALK = String.raw`(?:التحدث|التكلم|الحديث|الكلام|التواصل|الاتصال|اتحدث|اتكلم|اكلم|احكي|اتواصل|اتصل|نتحدث|نتكلم|نكلم|نحكي|نتواصل)`;
/**
 * Somebody the buyer asks the seller for — including a manager, «المدير», when
 * it is asked for. «احد» is "someone" only before a verb, «من», or the end:
 * before a noun it is "one of" («التواصل مع احد المصانع», one of the factories).
 */
const AR_WHO = String.raw`(?:شخصا?(?:\s+حقيقيا?)?|انسانا?(?:\s+حقيقيا?)?|بشر|موظف[اهة]?|احد\s+(?:الموظفين|موظفيكم)|احدا|حدا|(?:احد|حد)(?=\s*(?:$|[.!?،,؟])|\s+(?:ي[${AR}]+|من\s))|مس[ؤئو]?ول[اهة]?|المس[ؤئو]?ول[هة]?|مدير[اهة]?|المدير[هة]?|مدير(?:ت)?(?:كم|ك)|خدم[هة]\s+العملاء|الدعم(?:\s+الفني)?|ممثلا?(?:\s+(?:عن|ل)?\s*(?:الشرك[هة]|خدم[هة]\s+العملاء))?|صاحب\s+(?:الشرك[هة]|المصنع|المحل)|البائع|بائعا?|(?:قسم\s+)?المبيعات)(?![${AR}])`;
/**
 * The buyer's own side after the person: «في شركتي», «من فريقنا», «لدينا» — a
 * preposition and a word ending in «ي» (my) or «نا» (our). Wider than it needs
 * to be («في دبي» ends in «ي» too), which only ever sends a message to layer 2.
 */
const AR_OWN = new RegExp(String.raw`^(?:\s+[${AR}]+){0,2}?\s+(?:في|من|لدي|عند|داخل|مع)\s+[${AR}]*(?:ي|نا)(?![${AR}])|^\s+(?:لدي|لدينا|عندي|عندنا|تبعي|تبعنا)(?![${AR}])`);

/** Where an Arabic request can begin: the start or a stop, then perhaps "please". */
const AR_START = String.raw`(?:^|[.!?،,؟؛:]\s*)(?:(?:من\s+فضلك|رجاء|رجاءا|لو\s+سمحت|لو\s+سمحتي|ارجو|نرجو|يرجي)\s+)?`;
/**
 * What may follow a call to the buyer when it is a request and not a report:
 * «اتصل بي مديري أمس» (my manager called me yesterday) has a subject after it.
 */
const AR_CALL_TAIL = String.raw`(?=\s*(?:$|[.!?،,؟]|من\s+فضلك|رجاء|لو\s+سمحت|الان|الحين|حالا|غدا|بكره|بكرة|بعدين|علي\s+(?:الرقم|رقمي|الواتس|الواتساب|هذا|هاتفي|جوالي)|في\s+اقرب|[0-9٠-٩+]))`;

const AR_FRAMES: readonly Framed[] = [
  // «أريد التحدث مع شخص حقيقي», «ابغى اكلم موظف», «ممكن اتواصل مع مسؤول», «أريد التحدث مع مديركم»
  { re: new RegExp(String.raw`${AR_NOT}${AR_WANT}\s+(?:ان\s+)?${AR_TALK}(?:\s+(?:مع|الي)\s+|\s+[بل]|\s+)${AR_WHO}`, 'g'), own: AR_OWN },
  // «أريد أحدًا يساعدني» (with the tanween's alef: someone, whatever follows)
  { re: new RegExp(String.raw`${AR_NOT}${AR_WANT_ONE}\s+(?:احدا|حدا)(?![${AR}])`, 'g'), own: AR_OWN },
  // «اريد احد يساعدني», «ممكن حد يرد علي» — «احد» is "someone" before a verb or at the end, and
  // "one of" before a noun («اريد احد الموديلات»); «احدث» (the newest) is another word altogether
  { re: new RegExp(String.raw`${AR_NOT}${AR_WANT_ONE}\s+(?:احد|حد|شخص|شخصا|انسان)(?![${AR}])(?=\s+(?:ي[${AR}]+|من\s+(?:فريقكم|فريقك|عندكم|طرفكم|موظفيكم|الموظفين|المبيعات|الشرك[هة]|خدم[هة]|الدعم))|\s*(?:$|[.!?،,؟]))`, 'g'), own: AR_OWN },
  // «مديركم», «مسؤولتكم», «المدير عندكم» — the seller's manager or official, however it comes up
  { re: new RegExp(String.raw`(?<![${AR}])(?:مدير|مس[ؤئو]?ول)(?:ت)?(?:كم|ك)(?![${AR}])|(?<![${AR}])(?:ال)?(?:مدير|مس[ؤئو]?ول)[هة]?(?:\s+(?:الشرك[هة]|المصنع|المبيعات))?\s+(?:عندكم|لديكم|لكم)(?![${AR}])`, 'g'), own: null },
  // «حولني على موظف», «وصلني بمسؤول»
  { re: new RegExp(String.raw`(?<![${AR}])(?:حولني|حولوني|وصلني|وصلوني|اوصلني)(?:\s+(?:علي|الي|مع)\s+|\s+[بل]|\s+)${AR_WHO}`, 'g'), own: AR_OWN },
  // «اتصل بي», «كلمني على الواتساب», «رن علي الآن» — a call, which only a person makes
  { re: new RegExp(String.raw`${AR_START}(?:اتصل|اتصلي|اتصلوا|اتصلو)\s+(?:بي|علي|عليا)${AR_CALL_TAIL}`, 'g'), own: null },
  { re: new RegExp(String.raw`${AR_START}(?:كلمني|كلميني|كلموني|رني|رنوا\s+علي|رن\s+علي)${AR_CALL_TAIL}`, 'g'), own: null },
  // «ممكن تتصل بي؟», «ممكن اتصال؟», «هل يمكن الاتصال بكم؟» — asking for a call, either way
  { re: new RegExp(String.raw`${AR_NOT}(?:ممكن|هل\s+يمكن|هل\s+ممكن|يمكنكم|تقدر|تقدرون)\s+(?:تتصل|تتصلي|تتصلوا|تكلمني|تكلميني|تكلموني|الاتصال|اتصال|مكالم[هة])(?:\s+(?:بي|علي|بكم|عليكم|بك))?(?=\s*(?:$|[.!?،,؟]|من\s+فضلك|الان|غدا|علي|في))`, 'g'), own: null },
  // «أريد شخصًا حقيقيًا», «أريد إنسانًا» — a real person, asked for outright
  { re: new RegExp(String.raw`${AR_NOT}${AR_WANT_ONE}\s+(?:(?:شخصا|شخص|انسانا|انسان|بشرا|بشر)\s+حقيقيا?|انسانا|بشرا)(?![${AR}])`, 'g'), own: AR_OWN },
  // «أريد موظف خدمة العملاء», «أريد موظفًا يرد علي» — one of their staff; never «أريد موظفين» (hiring)
  { re: new RegExp(String.raw`${AR_NOT}${AR_WANT_ONE}\s+(?:موظفا?|موظف[هة])\s+(?:خدم[هة]\s+العملاء|المبيعات|من\s+(?:فريقكم|عندكم|الشرك[هة])|ي[${AR}]+)`, 'g'), own: AR_OWN },
  // «هل يوجد أحد أتكلم معه؟» — is there someone to talk with
  { re: new RegExp(String.raw`(?:هل\s+)?(?:يوجد|فيه|في|هل\s+من)\s+(?:احد|حد|شخص|موظف)\s+(?:اتكلم|اتحدث|اكلمه|اكلم|اتواصل|نتكلم|نتحدث|نكلم)`, 'g'), own: null },
  // «أحتاج مساعدة من شخص حقيقي» — help only a person gives
  { re: new RegExp(String.raw`(?<![${AR}])(?:ال)?مساعد[هة]\s+من\s+(?:شخص|انسان|موظف|بشر)(?:\s+حقيقي)?(?![${AR}])`, 'g'), own: AR_OWN },
  // «لا أريد التحدث مع روبوت» — asking for the one thing a robot is not
  { re: new RegExp(String.raw`(?:لا|مش|ما|مو)\s+(?:اريد|ابغي|ابغا|ابي|بدي|عايز|عاوز|احب)\s+(?:${AR_TALK}\s+(?:مع\s+)?|[بل])?(?:روبوت|الروبوت|بوت|البوت|الالة|اله|الة|مساعد\s+الي|الرد\s+الالي|رد\s+الي)(?![${AR}])`, 'g'), own: null },
];

const LAYER_ONE: readonly Framed[] = [...EN, ...ZH, ...AR_FRAMES];

/**
 * Layer 1: does the buyer's own text ask, unmistakably, for a person on the
 * seller's side — or name the seller's manager? Raw text in; it normalises.
 */
export function asksForPerson(text: string): boolean {
  const t = readable(text ?? '');
  if (!t) return false;
  return namesSellersManager(t) || LAYER_ONE.some((f) => firesIn(t, f));
}

const LOGISTICS_PHRASES = [
  'letter of credit', 'lc at sight', 'ddp', 'ddu', 'incoterms',
  'customs clearance', 'lcl', 'fcl', 'freight',
];

export function detectSignals(input: {
  text: string;
  state: ConversationState;
  analysis: Analysis | null;
  /** unit price for value estimation; from SQL, never the model */
  unitPrice: Money | null;
}): Signal[] {
  const { text, state, analysis, unitPrice } = input;
  const t = (text ?? '').toLowerCase();
  const out: Signal[] = [];

  // "Wants a person": layer 1 from the words, layer 2 from the analyser's
  // reading of them. `wantsPerson` absent means this analyser was not asked,
  // and changes nothing; null means it was asked and could not be read — the
  // turn hands off as not answered, because ambiguous means hand off.
  if (asksForPerson(text) || analysis?.wantsPerson === true) {
    out.push({ kind: 'human_requested' });
  } else if (analysis?.wantsPerson === null) {
    out.push({ kind: 'not_answered' });
  }

  // 0075 — "delete my data" goes to a person, and nothing is said to the buyer.
  // The buyer's own data as the object, never "delete that line from the quote"
  // (core/safety/deletion.ts, both lists in tests/parity/deletion-requests).
  if (asksForDeletion(text)) {
    out.push({ kind: 'deletion_requested' });
  }

  if (LOGISTICS_PHRASES.some((p) => t.includes(p))) {
    out.push({ kind: 'logistics_discussed' });
  }

  if (analysis?.intent.primary === 'complaint') {
    out.push({ kind: 'complaint' });
  }

  // High value: quantity × price, using the SQL price (n8n guessed $2 when it
  // had no price; we only emit the signal when a real price exists).
  const qty = analysis?.intent.quantityMentioned?.value ?? state.quantity?.value ?? 0;
  // The threshold is written in the price's own currency, so the comparison is
  // between two comparable amounts rather than two bare numbers.
  if (unitPrice !== null) {
    const total = scaleMoney(unitPrice, qty);
    if (isAbove(total, { amount: 3_000, currency: total.currency })) {
      out.push({ kind: 'high_value', total });
    }
  }

  // Two turns in and still no product candidate: the AI is failing this client.
  if (analysis && analysis.intent.productCandidate === null && state.turnCount >= 2) {
    out.push({ kind: 'repeated_ambiguity', turns: state.turnCount });
  }

  return out;
}
