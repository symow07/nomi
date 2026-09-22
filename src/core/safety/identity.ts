import { ok, err, type Result } from '../types/result.js';

/**
 * SHE MAY NOT CLAIM TO BE HUMAN.
 *
 * `prompts/response.txt` tells the writer never to deny being an AI, to answer
 * truthfully when a buyer sincerely asks, and to offer a person. That is a
 * prompt, and a prompt is a hope: the model that follows it on Monday is the
 * model that is one token unlucky on Tuesday. This is the same rule expressed
 * where it cannot be talked out of — beside the numeral, claims and
 * forbidden-word guards, in the same retry loop, failing closed.
 *
 * It is the one claim where the product cannot afford to be probabilistic.
 * Everything else a guard catches is a commercial mistake — a price below the
 * floor, a certification nobody authorised. This one is a lie told to a person
 * who asked a direct question, and in several places a lie a regulator has
 * opinions about.
 *
 * ── TWO RULES, AND THE SECOND IS THE ONE THAT MATTERS ───────────────────────
 *
 * 1. A DENIAL IS REFUSED. A list of phrases, below. Lists of phrases are worth
 *    having and are never finished.
 *
 * 2. A QUESTION IS ANSWERED. If the buyer's own last message asked what they
 *    are talking to, the reply must SAY that it is an AI. This is the rule the
 *    first one cannot express: "No 😊" denies nothing a pattern can find, and
 *    is the most natural way in the world to answer "are you a bot?" wrongly.
 *    Judged against the QUESTION, not the wording of the answer, so it holds
 *    for every phrasing nobody thought of — including silence on the subject.
 *
 * Either failure spends a retry, and two failures hold the turn for a person.
 *
 * ── SELF-DENIAL ONLY. THIS IS THE WHOLE DIFFICULTY. ─────────────────────────
 *
 * The prompt makes her OFFER A HUMAN, so honest replies are full of people:
 * "a real person on our team will reply", "我帮您转人工", "سيتواصل معك شخص من
 * الفريق". A guard that reached for "real person" or "人工" or "شخص" would
 * block exactly the sentence the new rule exists to produce, the reply would be
 * regenerated twice, and the turn would end up held — the buyer who asked the
 * honest question being the one who gets no answer.
 *
 * So every pattern below is anchored to a subject asserting humanity, now:
 *
 *    blocked   I am a real person   ·  我是真人     ·  لست روبوت    ·  ana mish robot
 *    passes    a real person will reply  ·  我帮您转人工  ·  شخص من الفريق سيرد
 *
 * and nothing matches across an intervening verb: "I'm getting a real person
 * for you" has a subject, but what follows it is an action, not a claim.
 *
 * Between the subject and the claim, a FIXED list of intensifiers is allowed —
 * "I'm really a real person", "我真的是真人", "ana wallah mish robot" — because
 * insistence is exactly how a denial is phrased when a buyer presses. A fixed
 * list, never `.*`: a wildcard there would swallow the intervening verb this
 * guard's precision depends on.
 *
 * Saying the BUSINESS is run by real people is true and passes. Saying that
 * SHE is one does not.
 */

export type IdentityViolation =
  | {
      readonly kind: 'denied_being_ai';
      /** The exact text that matched, so the owner is told what stopped it. */
      readonly phrase: string;
    }
  | {
      readonly kind: 'identity_question_unanswered';
      /** What the buyer asked, so the owner sees the question that went unanswered. */
      readonly phrase: string;
    };

/* ── the fixed intensifier lists ─────────────────────────────────────────────
 * Each is a bounded alternation. They appear between the subject and the claim
 * and nowhere else; an intensifier BEFORE the subject ("Of course I'm a real
 * person") already matches, because none of these patterns is anchored to the
 * start of the reply.
 */
const EN_INTENS = '(?:really|definitely|absolutely|actually|honestly|truly|genuinely|certainly|of\\s+course|indeed|100\\s*%|a\\s+hundred\\s+percent)';
/** Up to two, so "I am really honestly a person" is caught and nothing unbounded is. */
const EN_GAP = `(?:${EN_INTENS}\\s+){0,2}`;
const ZH_INTENS = '(?:真的|真係|當然|当然|絕對|绝对|確實|确实|肯定|保證|保证)';
const ZH_GAP = `(?:${ZH_INTENS}){0,2}`;
const AR_INTENS = '(?:والله|و\\s*الله|فعلا|فعلاً|حقا|حقًا|بالتأكيد|طبعا|طبعًا|أكيد|اكيد)';
const AR_GAP = `(?:${AR_INTENS}\\s+){0,2}`;
const ARZ_INTENS = '(?:wallah|walla|wallahi|w\\s*allah|bjd|bjad|bejad|fe3lan|fe3len|akeed|akid|3anjad|anjad)';
const ARZ_GAP = `(?:${ARZ_INTENS}\\s+){0,2}`;

const EN_I = "\\bi(?:'m|’m|\\s+am)\\s+";

/**
 * Written out rather than generated, because each one is a sentence somebody
 * could actually send and the list is meant to be read by a person deciding
 * whether it is right.
 */
const DENIALS: readonly RegExp[] = [
  // ── English · first person ────────────────────────────────────────────────
  // "I am a real person", "I'm really human", "I am 100% a person". Adjacent
  // by design apart from the fixed intensifier list: an intervening word that
  // is not on it means an action, not a claim about the speaker.
  new RegExp(`${EN_I}${EN_GAP}(?:a\\s+|an\\s+)?(?:real\\s+|actual\\s+|live\\s+)?(?:person|human(?:\\s+being)?|lady|woman|man|guy)\\b`, 'i'),
  // "I am not a bot" and every machine word a buyer would use.
  new RegExp(`${EN_I}${EN_GAP}not\\s+${EN_GAP}(?:a\\s+|an\\s+)?(?:bot|robot|ai|a\\.i\\.|chatbot|machine|computer|program|software|algorithm)\\b`, 'i'),
  // "I'm typing this myself", "I am really writing this personally".
  new RegExp(`${EN_I}${EN_GAP}(?:typing|writing)\\s+(?:this|these)\\b`, 'i'),
  // "I assure you I am human" — the claim is the second clause; the first is
  // what makes it worse.
  new RegExp(`\\b(?:assure|promise|swear)\\s+you\\b[^.!?]{0,20}${EN_I}${EN_GAP}(?:a\\s+)?(?:real\\s+)?(?:person|human)\\b`, 'i'),

  // ── English · second person and conversation level ────────────────────────
  // The same lie told about the conversation rather than about herself, which
  // is how it is most often phrased: the subject moves, the claim does not.
  /\byou(?:'re|’re|\s+are)\s+(?:talking|speaking|chatting|texting|dealing|writing)\s+(?:to|with)\s+(?:a\s+|an\s+)?(?:real\s+|actual\s+|live\s+)?(?:person|human(?:\s+being)?)\b/i,
  // "this is a real person", "it's a human speaking", "that's a live person here".
  /\b(?:this|that|it)(?:'s|’s|\s+is)\s+(?:a\s+|an\s+)?(?:real\s+|actual\s+|live\s+)?(?:person|human(?:\s+being)?)\b(?:\s+(?:speaking|typing|writing|here|talking))?/i,
  // "there are no bots here", "no bots here", "nobody automated on this end".
  /\b(?:there(?:'s|’s|\s+are|\s+is)\s+)?no\s+(?:bots?|robots?|ai|chatbots?|machines?)\s+(?:here|on\s+this\s+(?:end|side)|involved|in\s+this\s+chat)\b/i,
  /\bno\s+(?:bots?|robots?|chatbots?)\s+here\b/i,
  // "you're speaking with one of our team members, not a bot" — the denial is
  // the tail, and it is a denial however the head is phrased.
  /\bnot\s+(?:a\s+)?(?:bot|robot|chatbot|machine)\b[^.!?]{0,24}\b(?:here|speaking|talking|promise|really)\b/i,

  // ── 中文 ──────────────────────────────────────────────────────────────────
  // No spaces, so these are exact phrases rather than anchored patterns. Each
  // begins with its subject — "我帮您转人工" and "人工客服" carry 人工 and pass.
  new RegExp(`我${ZH_GAP}是${ZH_GAP}真人`),
  new RegExp(`我${ZH_GAP}是(?:真實的人|真实的人)`),
  new RegExp(`我${ZH_GAP}不是${ZH_GAP}(?:机器人|機器人)`),
  new RegExp(`我${ZH_GAP}不是${ZH_GAP}(?:机器|機器)`),
  new RegExp(`我${ZH_GAP}不是${ZH_GAP}(?:AI|人工智能|人工智慧)`, 'i'),
  new RegExp(`我${ZH_GAP}是(?:人类|人類)`),
  new RegExp(`我${ZH_GAP}是活人`),
  // Said about the conversation: "您在和真人说话", "你在跟真人聊天".
  /(?:您|你)(?:正)?在(?:和|跟|与|與)真人(?:说话|說話|對話|对话|聊天|交流)/,
  // "这边是真人", "这里是真人不是机器人", "那是真人".
  /(?:这边|這邊|这里|這裡|这|這|那)(?:是|就是)(?:真人|真實的人|真实的人|人类|人類)/,
  // "没有机器人", "不是机器人在回复" — the conversation-level denial.
  /(?:没有|沒有)(?:机器人|機器人|AI|人工智能)/i,
  /(?:不是|非)(?:机器人|機器人)(?:在)?(?:回复|回覆|聊天|说话|說話)/,

  // ── العربية ───────────────────────────────────────────────────────────────
  // لست = "I am not"; أنا = "I". "شخص من الفريق" (a person from the team)
  // carries شخص and must pass, so every pattern keeps its subject marker.
  new RegExp(`لست\\s+${AR_GAP}(?:روبوت|روبوتا|روبوتًا|آلة|آلي|ذكاء\\s+اصطناعي|برنامج|بوت)`),
  new RegExp(`أنا\\s+${AR_GAP}(?:لست|مش|مو|مب)\\s+(?:روبوت|آلة|ذكاء\\s+اصطناعي|بوت)`),
  new RegExp(`(?:أنا|انا)\\s+${AR_GAP}(?:إنسان|انسان|بشر|شخص\\s+حقيقي|شخص\\s+حقيقى)`),
  // Second person: "أنت تتحدث مع إنسان" — you are speaking with a human.
  /(?:أنت|انت|إنك|انك)\s+(?:تتحدث|تتكلم|تتكلّم|تكلم|تحكي|تراسل)\s+(?:مع|الى|إلى)\s+(?:إنسان|انسان|شخص\s+حقيقي|بشر)/,
  // Conversation level: "لا يوجد روبوت هنا", "ليس روبوتا".
  /(?:لا\s+يوجد|ما\s+في|مافي|ليس\s+هناك)\s+(?:روبوت|بوت|ذكاء\s+اصطناعي)/,
  // "هذا إنسان" — this is a human. NOT `هنا`: "هنا شخص حقيقي سيساعدك" ("there
  // is a real person here who will help you") is a handoff OFFER, and blocking
  // it would be the exact false positive this guard is built around.
  /(?:هذا|هذه)\s+(?:إنسان|انسان|شخص\s+حقيقي)/,

  // ── Arabizi ───────────────────────────────────────────────────────────────
  // Arabic written in Latin script with digits, which is how a great many Gulf
  // and Levantine buyers actually type. "mish/mush/msh/mesh" = not.
  new RegExp(`\\bana\\s+${ARZ_GAP}(?:mish|mush|msh|mesh|mo|mu|mub)\\s+(?:a\\s+)?(?:robot|rob0t|bot|b0t|ai)\\b`, 'i'),
  new RegExp(`\\bana\\s+${ARZ_GAP}(?:insan|insaan|inssan|bashar|bani\\s*adam)\\b`, 'i'),
  new RegExp(`\\bana\\s+${ARZ_GAP}shakh?s\\s+(?:7a2i2i|ha2i2i|hakiki|haqiqi)\\b`, 'i'),
  /\bmo?sh\s+(?:robot|bot)\b.{0,12}\bana\b/i,
  // Second person / conversation level.
  /\b(?:enta|inta|inte|enti|ente|entaa)\s+(?:3am\s+)?(?:btihki|btehki|bthki|btkalem|btetkalam|tihki)\s+ma3\s+(?:insan|insaan|shakhs|bashar)\b/i,
  /\b(?:mafi|ma\s+fi|mafish|ma\s+fish|mako)\s+(?:robot|bot|ai)\b/i,
];

/**
 * DOES THE BUYER'S OWN MESSAGE ASK WHAT THEY ARE TALKING TO?
 *
 * Deliberately narrow, and narrow in one specific way: it requires the buyer to
 * be asking about the INTERLOCUTOR — "are you…", "am I talking to…", "is
 * this…", "你是…吗", "هل أنت…". A message that merely CONTAINS the words is not
 * a question about what is answering it, and this is the exact case the rule
 * must not fire on:
 *
 *     "I need a real person to sign the contract"   → not a question. Passes.
 *     "are you a real person?"                      → a question. Must be answered.
 *
 * Getting that wrong would be worse than having no rule: every conversation
 * about paperwork would start demanding the assistant announce itself, which is
 * precisely the volunteering `prompts/response.txt` forbids.
 */
const IDENTITY_QUESTIONS: readonly RegExp[] = [
  // ── English ───────────────────────────────────────────────────────────────
  // "are you a bot?", "r u human", "are you real?"
  /\b(?:are|r)\s+(?:you|u)\s+(?:a\s+|an\s+)?(?:real\s+|actual\s+|live\s+)?(?:bot|robot|ai|a\.i\.|chatbot|human(?:\s+being)?|person|machine|computer|real)\b/i,
  // "am I talking to a bot / a real person / a human?"
  /\bam\s+i\s+(?:talking|speaking|chatting|texting|dealing|writing)\s+(?:to|with)\s+(?:a\s+|an\s+)?(?:real\s+|actual\s+)?(?:bot|robot|ai|chatbot|human(?:\s+being)?|person|machine)\b/i,
  // "is this a bot?", "is this automated?", "is this a real person?"
  /\bis\s+(?:this|that|it)\s+(?:a\s+|an\s+)?(?:real\s+|actual\s+)?(?:bot|robot|ai|chatbot|human(?:\s+being)?|person|machine|automated|automatic)\b/i,
  // "who am I talking to?" — the same question, asked open.
  /\bwho\s+am\s+i\s+(?:talking|speaking|chatting|dealing)\s+(?:to|with)\b/i,
  // "are you an actual employee", "is there a human there?"
  /\bis\s+there\s+(?:a\s+|an\s+)?(?:real\s+)?(?:human|person)\s+(?:there|here|on\s+the\s+other\s+(?:end|side))\b/i,

  // ── 中文 ──────────────────────────────────────────────────────────────────
  // "你是机器人吗？", "您是不是真人", "你是AI吗"
  /(?:你|您)(?:是|係)(?:不是)?(?:机器人|機器人|真人|人工智能|人工智慧|AI|机器|機器|真的人|人类|人類)/i,
  // "这是机器人吗", "这边是真人吗"
  /(?:这|這|那)(?:边|邊|里|裡)?(?:是|係)(?:不是)?(?:机器人|機器人|真人|AI|人工智能|自动回复|自動回覆)/i,
  // "我在跟机器人说话吗"
  /我(?:是不是|在)(?:和|跟|与|與)(?:机器人|機器人|AI|真人|人工智能)(?:说话|說話|聊天|对话|對話)/i,

  // ── العربية ───────────────────────────────────────────────────────────────
  // "هل أنت روبوت؟", "أنت روبوت؟", "هل أتحدث مع إنسان؟"
  /(?:هل\s+)?(?:أنت|انت|إنت)\s+(?:روبوت|بوت|إنسان|انسان|بشر|ذكاء\s+اصطناعي|آلة|حقيقي|حقيقية)\s*[؟?]?/,
  /هل\s+(?:أتحدث|اتحدث|أتكلم|اتكلم|أراسل|اراسل)\s+(?:مع|الى|إلى)\s+(?:إنسان|انسان|روبوت|بوت|شخص\s+حقيقي|آلة)/,
  /هل\s+(?:هذا|هذه)\s+(?:رد\s+)?(?:آلي|تلقائي|روبوت|بوت)/,

  // ── Arabizi ───────────────────────────────────────────────────────────────
  // "enta robot wala shakhs 7a2i2i?", "inta bot?"
  /\b(?:hal\s+|hl\s+)?(?:enta|inta|inte|enti|ente|entaa)\s+(?:robot|rob0t|bot|b0t|ai|insan|insaan|bashar|shakhs)\b/i,
  // "ana bahki ma3 robot?"
  /\b(?:ana\s+)?(?:bahki|bihki|bahke|batkalam|btkalem|btihki|atkalam)\s+ma3\s+(?:robot|bot|ai|insan|insaan|shakhs|bashar)\b/i,
];

/**
 * DOES THE REPLY SAY WHAT IT IS?
 *
 * Only reached when the buyer asked, and only after the denial list has run —
 * so "I'm not a bot" is never here to be mistaken for an acknowledgment.
 *
 * 人工 IS NOT ON THIS LIST AND MUST NOT BE. "转人工" is how Chinese says
 * "put me through to a human agent"; it is the handoff this whole rule exists
 * to produce. Only 人工智能 / 人工智慧 — the full word for the machine — counts.
 */
const ACKNOWLEDGMENTS: readonly RegExp[] = [
  /\b(?:a\.?\s?i\.?|artificial\s+intelligence|chat\s?bot|bot|robot|automated|virtual\s+assistant|digital\s+assistant|computer\s+program|software|machine)\b/i,
  // "I am not a human" — an acknowledgment by the other door.
  /\bi(?:'m|’m|\s+am)\s+not\s+(?:a\s+)?(?:human(?:\s+being)?|person|real\s+person)\b/i,
  /(?:AI|人工智能|人工智慧|智能助手|机器人|機器人|自动回复|自動回覆)/i,
  /我不是(?:真人|人类|人類)/,
  /(?:ذكاء\s+اصطناعي|مساعد\s+ذكي|مساعدة\s+ذكية|روبوت|بوت|آلي)/,
  /لست\s+(?:إنسان|انسان|بشر)/,
];

/** The first denial in this reply, or null. */
export function findDenial(reply: string): string | null {
  for (const re of DENIALS) {
    const m = re.exec(reply);
    if (m) return m[0];
  }
  return null;
}

/** Whether this buyer message asks what they are talking to. */
export function asksAboutBeingAi(buyerText: string): string | null {
  for (const re of IDENTITY_QUESTIONS) {
    const m = re.exec(buyerText);
    if (m) return m[0];
  }
  return null;
}

/** Whether this reply says, in any language or phrasing on the list, that it is one. */
export function acknowledgesAi(reply: string): boolean {
  return ACKNOWLEDGMENTS.some((re) => re.test(reply));
}

/**
 * The guard, shaped exactly like `guardForbidden`: Result, never a side effect.
 *
 * `buyerText` is the buyer's latest inbound message. It is optional only so
 * that callers with no conversation in hand — a unit test of the phrase list,
 * the runtime trust strip on a free-form reply — can ask the first question
 * without inventing an answer to the second.
 */
export function guardIdentity(input: { reply: string; buyerText?: string | undefined }): Result<string, IdentityViolation> {
  const hit = findDenial(input.reply);
  if (hit !== null) return err({ kind: 'denied_being_ai', phrase: hit });

  const asked = input.buyerText === undefined ? null : asksAboutBeingAi(input.buyerText);
  if (asked !== null && !acknowledgesAi(input.reply)) {
    return err({ kind: 'identity_question_unanswered', phrase: asked });
  }
  return ok(input.reply);
}
