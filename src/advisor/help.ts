import type { AdvisorModel, AdvisorCallUsage } from '../llm/ports.js';
import type { Locale } from '../core/owner/i18n/locale.js';
import { normalise } from './check.js';
import { LANGUAGE, type AdvisorSpent } from './answer.js';

/**
 * Block 6.1 — A QUESTION ABOUT NOMI ITSELF, answered from the help's guides and nothing else.
 *
 * The same two calls as the advisor (`AdvisorModel`, prompts unchanged): the model names which guide the question
 * is about, or none; then words an answer from that guide's lines alone. Three things hold it to what is built:
 *   1. a question that names something Nomi does not do (`NOT_YET`, each checked in the code) is "not yet", and the
 *      model is not asked;
 *   2. no guide fits: a fixed sentence (the guides do not cover it — write to us), never a guess;
 *   3. AN ALLOWLIST, NOT A BLOCKLIST (6.1's verification, 2026-11-10): the owner sees only lines that come from the
 *      help's own sources — the chosen guide's lines, as given to the model and as the page shows them. The model
 *      may choose the guide and which of its lines to say; what it wrote is shown only when, once normalised
 *      (`helpTokens`: NFKC, case, spacing and punctuation), it is made of whole lines of that guide, and then the
 *      guide's own words are shown, never the model's. Anything else — a feature, a figure, a date, a line with one
 *      word changed, a sentence in another language — is thrown away and the guide's lines are the answer.
 *      (The English term list this replaced let 10 of 15 invented sentences through, every ar/zh/es one among them.)
 * Pure: no database, no file, no sender. The route asks the day's allowance before and records `spent` after.
 */

export type HelpTopic = {
  readonly id: string;
  readonly title: string;
  /** The guide's lines as the model is given them: the facts it may word an answer from. */
  readonly lines: readonly string[];
  /** The same lines as the help page shows them in the owner's language, index for index; absent: `lines`. */
  readonly shown?: readonly string[];
};

export type HelpAnswer =
  /** The model chose these lines of the guide (indices into `topic.lines`, in its order): they are shown, as written. */
  | { readonly kind: 'answer'; readonly topic: HelpTopic; readonly lines: readonly number[] }
  /** The model's sentence was thrown away (or none came): the guide's own lines. */
  | { readonly kind: 'guide'; readonly topic: HelpTopic }
  | { readonly kind: 'notYet' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'failed' };

export type HelpAnswered = { readonly answer: HelpAnswer; readonly spent: AdvisorSpent };

/**
 * Things Nomi does not do, as a question names them — in every owner language (en, zh, ar, es, fr). Each was
 * checked in the code (2026-11-10) and is listed in the build notes for the owner: WeChat, WeCom and RED are on
 * Channels as coming (`COMING_SOON`, channels.ts); no SMS, phone or voice-call channel exists (src/channels); no
 * Viber or LINE channel; no Zapier, Google Calendar, Amazon or eBay connection.
 *
 * Both ways, with reasons: tests/parity/help-not-yet-corpus.ts holds the asks each pattern must catch and the
 * passing mentions it must not ("line 3 of my list", "call me Ana", "I texted them yesterday"). A new phrasing goes
 * into that corpus first, with its reason, and only then into a pattern here.
 *
 * Matched on the question after NFKC and the bidi isolates are taken out (`normalise`), case kept: LINE and WeChat
 * written as names (capitals) are told apart from the words "line" and "we chat" that way.
 */
export const NOT_YET: readonly { readonly name: string; readonly re: RegExp }[] = [
  // WeCom first: its Chinese name 企业微信 holds WeChat's.
  { name: 'WeCom', re: /\bwecom\b|企业微信/iu },
  // WeChat: one word in any case; two words only as the name ("We Chat") or with what makes it the app — never
  // "can we chat about prices?".
  { name: 'WeChat', re: /[Ww][Ee][Cc][Hh][Aa][Tt]|[Ww][Ee][Ii][Xx][Ii][Nn]|\bW[Ee][ -]C[Hh][Aa][Tt]\b|\b[Ww]e[ -]chat (?:app|account|official)|微信|وي ?تشات|وي ?شات|ويتشات/u },
  { name: 'RED', re: /\brednote\b|\bxiaohongshu\b|小红书/iu },
  { name: 'SMS', re: new RegExp([
    '\\b(?:sms|mms)\\b', 'إس ?إم ?إس', 'اس ?ام ?اس',
    // a text message, as a channel — never text pasted or copied from a chat (that is how products are added)
    '(?<!(?:paste|pasted|copy|copied) )\\btext messag(?:e|es|ing)\\b',
    // to text someone — never "the text customers see"
    '(?<!\\b(?:the|this|that|a|some|of|your|my) )\\btext(?:ing)? (?:my |our |all |your )?(?:customers?|clients?)\\b',
    '\\bsend (?:them |customers |my customers |clients )?texts\\b', '\\bsend (?:them |customers )?a text (?:message|to)\\b',
    '(?:能|可以|会|能否|可否|支持|可不可以)[^，。？?！!]{0,10}短信', '短信(?:渠道|功能|群发|吗)',
    'رسا(?:ئ|ي)ل ?نصي', 'رسالة ?نصي',
    '\\bmensajes? de texto\\b', '\\bmessages? textes?\\b', '\\b(?:envoyer|envoie|envoyez|envoyer des) (?:des |un )?textos?\\b',
  ].join('|'), 'iu') },
  { name: 'calls', re: new RegExp([
    '\\b(?:phone|voice|video)[ -]?calls?\\b', '\\b(?:call|phone|ring) (?:my |the |a |our |all |your )?(?:customers?|clients?)\\b',
    '\\bmake (?:phone |voice )?calls?\\b', '\\b(?:answer|take|receive|handle)s? (?:phone |voice )?calls\\b',
    '(?:能|可以|会|能否|可否|可不可以)[^，。？?！!]{0,10}(?:打电话|拨打|语音通话|接电话)', '(?:打电话|拨打电话)给(?:客户|顾客|买家)', '语音通话',
    'مكالم(?:ة|ات) ?(?:هاتفي|صوتي)', '(?:إجراء|اجراء|يجري|تجري) ?مكالم', '(?:يتصل|تتصل|الاتصال|اتصال|يكلم|تكلم) ?ب(?:ال)?(?:عملاء|عملائ|زبائن|الزبائن)',
    '\\bllamadas? (?:telef[oó]nicas?|de voz)\\b', '\\bllamar a (?:mis |los |tus |nuestros )?clientes\\b', '\\bhacer llamadas\\b',
    '\\bappels? (?:t[ée]l[ée]phoniques?|vocaux)\\b', '\\bappeler (?:mes |les |nos |vos )?clients\\b', '\\bpasser des appels\\b',
  ].join('|'), 'iu') },
  { name: 'Viber', re: /\bviber\b|فايبر/iu },
  // LINE: the name in capitals anywhere; otherwise only with what makes it the app ("the Line app", "connect Line").
  { name: 'LINE', re: /\bLINE\b|\b[Ll]ine (?:app|messenger|chat|official account)\b|\b(?:support|connect(?:ed)? to|connect|integrate(?:d)? with|works? with|reply on|answer on) (?:the )?[Ll]ine\b(?![\s-]*(?:\d|of\b|breaks?\b|items?\b|by\b|up\b))|لاين/u },
  { name: 'Zapier', re: /\bzapier\b|زابير/iu },
  { name: 'Google Calendar', re: /\bgoogle calendar\b|谷歌日历|google日历|تقويم (?:جوجل|غوغل|google)|\bcalendario de google\b|\bagenda google\b/iu },
  { name: 'Amazon', re: /\bamazon\b|亚马逊|أمازون|امازون/iu },
  { name: 'eBay', re: /\bebay\b|إيباي|ايباي|易贝/iu },
];

/**
 * A text as the allowlist compares it: NFKC, the bidi isolates out, lower case, and its words and figures in order —
 * spacing and punctuation gone. A figure keeps its own marks ("20,000" stays one figure, never "20000" or "200.00").
 */
export function helpTokens(text: string): string[] {
  return [...normalise(text).toLowerCase().matchAll(/\p{N}+(?:[.,]\p{N}+)*|[\p{L}\p{M}]+/gu)].map((m) => m[0]);
}

/**
 * The guide lines `text` is made of, in its order — each a whole line, as given to the model or as shown — or null
 * when any of it is not a line of this guide. Empty text is null.
 */
export function linesOfGuide(text: string, topic: HelpTopic): number[] | null {
  const said = helpTokens(text);
  if (said.length === 0) return null;
  const forms = topic.lines.map((l, i) => [helpTokens(l), helpTokens(topic.shown?.[i] ?? l)].filter((f) => f.length > 0));
  const at = (pos: number, form: readonly string[]): boolean => form.every((w, k) => said[pos + k] === w);
  const from = (pos: number): number[] | null => {
    if (pos === said.length) return [];
    for (let i = 0; i < forms.length; i++) {
      for (const f of forms[i]!) {
        if (pos + f.length > said.length || !at(pos, f)) continue;
        const rest = from(pos + f.length);
        if (rest) return [i, ...rest];
      }
    }
    return null;
  };
  const found = from(0);
  return found ? [...new Set(found)] : null;
}

/** Which NOT_YET thing the question names, or null. */
export function notYetIn(question: string): string | null {
  const q = normalise(question);
  return NOT_YET.find((n) => n.re.test(q))?.name ?? null;
}

export async function answerHelp(model: AdvisorModel, question: string, topics: readonly HelpTopic[], locale: Locale): Promise<HelpAnswered> {
  const spent = { llmCalls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  const counted = (u: AdvisorCallUsage): void => {
    spent.llmCalls += 1; spent.inputTokens += u.inputTokens; spent.outputTokens += u.outputTokens; spent.cachedInputTokens += u.cachedInputTokens ?? 0;
  };
  const done = (answer: HelpAnswer): HelpAnswered => ({ answer, spent: { ...spent } });

  if (notYetIn(question)) return done({ kind: 'notYet' });

  let picked: string | null;
  try {
    const r = await model.recognise({ question, entries: topics.map((t) => ({ id: t.id, ask: `${t.title}: ${t.lines.join(' ')}` })) });
    counted(r.usage);
    picked = r.pick?.id ?? null;
  } catch { return done({ kind: 'failed' }); }
  const topic = topics.find((t) => t.id === picked);
  if (!topic) return done({ kind: 'unknown' });

  let text: string | null = null;
  try {
    const r = await model.phrase({ question, language: LANGUAGE[locale], facts: topic.lines, opinion: false });
    counted(r.usage);
    text = r.text;
  } catch { text = null; }
  const lines = text ? linesOfGuide(text, topic) : null;
  return done(lines ? { kind: 'answer', topic, lines } : { kind: 'guide', topic });
}
