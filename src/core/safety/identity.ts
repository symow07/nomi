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
 * ── SELF-DENIAL ONLY. THIS IS THE WHOLE DIFFICULTY. ─────────────────────────
 *
 * The prompt makes her OFFER A HUMAN, so honest replies are full of people:
 * "a real person on our team will reply", "我帮您转人工", "سيتواصل معك شخص من
 * الفريق". A guard that reached for "real person" or "人工" or "شخص" would
 * block exactly the sentence the new rule exists to produce, the reply would be
 * regenerated twice, and the turn would end up held — the buyer who asked the
 * honest question being the one who gets no answer.
 *
 * So every pattern below is anchored to a FIRST-PERSON SUBJECT asserting its
 * own humanity, now:
 *
 *    blocked   I am a real person   ·  我是真人     ·  لست روبوت    ·  ana mish robot
 *    passes    a real person will reply  ·  我帮您转人工  ·  شخص من الفريق سيرد
 *
 * and nothing matches across an intervening verb: "I'm getting a real person
 * for you" has a subject, but what follows it is an action, not a claim.
 *
 * Saying the BUSINESS is run by real people is true and passes. Saying that
 * SHE is one does not.
 */

export type IdentityViolation = {
  readonly kind: 'denied_being_ai';
  /** The exact text that matched, so the owner is told what stopped it. */
  readonly phrase: string;
};

/**
 * Written out rather than generated, because each one is a sentence somebody
 * could actually send and the list is meant to be read by a person deciding
 * whether it is right.
 */
const DENIALS: readonly RegExp[] = [
  // ── English ───────────────────────────────────────────────────────────────
  // "I am a real person", "I'm human", "I am a person". Adjacent by design:
  // an intervening word means an action, not a claim about the speaker.
  /\bi(?:'m|’m|\s+am)\s+(?:a\s+|an\s+)?(?:real\s+|actual\s+|live\s+)?(?:person|human(?:\s+being)?|lady|woman|man|guy)\b/i,
  // "I am not a bot" and every machine word a buyer would use.
  /\bi(?:'m|’m|\s+am)\s+not\s+(?:a\s+|an\s+)?(?:bot|robot|ai|a\.i\.|chatbot|machine|computer|program|software|algorithm)\b/i,
  // "no, I'm not" answering "are you a bot?" — the denial without the noun.
  /\bi(?:'m|’m|\s+am)\s+not\s+(?:a\s+)?(?:bot|robot)\b/i,
  // Said about the speaker in the second person: "you're talking to a real person".
  /\byou(?:'re|’re|\s+are)\s+(?:talking|speaking|chatting|dealing)\s+(?:to|with)\s+(?:a\s+|an\s+)?(?:real\s+|actual\s+)?(?:person|human)\b/i,
  // "this is a real person", "it's a real human here".
  /\b(?:this|it)(?:'s|’s|\s+is)\s+(?:a\s+|an\s+)?(?:real\s+|actual\s+)?(?:person|human)\b/i,
  // "I'm typing this myself", "I am writing this personally".
  /\bi(?:'m|’m|\s+am)\s+(?:typing|writing)\s+(?:this|these)\b/i,
  // "I assure you I am human", "I promise I'm a real person" — the claim is
  // the second clause; the first is what makes it worse.
  /\b(?:assure|promise|swear)\s+you\b[^.!?]{0,20}\bi(?:'m|’m|\s+am)\s+(?:a\s+)?(?:real\s+)?(?:person|human)\b/i,

  // ── 中文 ──────────────────────────────────────────────────────────────────
  // No spaces, so these are exact phrases rather than anchored patterns. Each
  // begins with 我 — "我帮您转人工" and "人工客服" carry 人工 and must pass.
  /我是真人/,
  /我是真實的人|我是真实的人/,
  /我不是机器人|我不是機器人/,
  /我不是机器|我不是機器/,
  /我不是\s*AI|我不是人工智能|我不是人工智慧/i,
  /我是人类|我是人類/,
  /我是活人/,
  // "您在和真人说话" — said about the speaker.
  /(?:您|你)(?:正)?在(?:和|跟|与)真人(?:说话|對話|对话|聊天)/,

  // ── العربية ───────────────────────────────────────────────────────────────
  // لست = "I am not"; أنا = "I". "شخص من الفريق" (a person from the team)
  // carries شخص and must pass, so every pattern keeps its first-person marker.
  /لست\s+(?:روبوت|روبوتا|روبوتًا|آلة|آلي|ذكاء\s+اصطناعي|برنامج)/,
  /أنا\s+(?:لست|مش)\s+(?:روبوت|آلة|ذكاء\s+اصطناعي)/,
  /أنا\s+(?:إنسان|انسان|بشر|شخص\s+حقيقي|شخص\s+حقيقى)/,
  /أنا\s+(?:مو|مش)\s+(?:روبوت|بوت)/,

  // ── Arabizi ───────────────────────────────────────────────────────────────
  // Arabic written in Latin script with digits, which is how a great many Gulf
  // and Levantine buyers actually type. "mish/mush/msh/mesh" = not.
  /\bana\s+(?:mish|mush|msh|mesh|mo|mu)\s+(?:a\s+)?(?:robot|rob0t|bot|b0t|ai)\b/i,
  /\bana\s+(?:insan|insaan|inssan|bashar|bani\s*adam)\b/i,
  /\bana\s+shakh?s\s+(?:7a2i2i|ha2i2i|hakiki|haqiqi)\b/i,
  /\bmo?sh\s+(?:robot|bot)\b.{0,12}\bana\b/i,
];

/** The first denial in this reply, or null. */
export function findDenial(reply: string): string | null {
  for (const re of DENIALS) {
    const m = re.exec(reply);
    if (m) return m[0];
  }
  return null;
}

/** The guard, shaped exactly like `guardForbidden`: Result, never a side effect. */
export function guardIdentity(input: { reply: string }): Result<string, IdentityViolation> {
  const hit = findDenial(input.reply);
  if (hit === null) return ok(input.reply);
  return err({ kind: 'denied_being_ai', phrase: hit });
}
