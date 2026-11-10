import type { AdvisorModel, AdvisorCallUsage } from '../llm/ports.js';
import type { Locale } from '../core/owner/i18n/locale.js';
import { checkPhrasing, normalise } from './check.js';
import { LANGUAGE, type AdvisorSpent } from './answer.js';

/**
 * Block 6.1 — A QUESTION ABOUT NOMI ITSELF, answered from the help's guides and nothing else.
 *
 * The same two calls as the advisor (`AdvisorModel`, prompts unchanged): the model names which guide the question
 * is about, or none; then words an answer from that guide's lines alone. Three things hold it to what is built:
 *   1. a question that names something Nomi does not do (`NOT_YET`, each checked in the code) is "not yet", and the
 *      model is not asked;
 *   2. no guide fits: a fixed sentence (the guides do not cover it — write to us), never a guess;
 *   3. the sentence the model wrote is checked: rule 4's check (no figure, date or name that is not in the guide),
 *      and `namesAFeature` — a channel, a service or a kind of feature the guide's lines do not name throws it
 *      away. Thrown away, the guide's own lines are the answer.
 * Pure: no database, no file, no sender. The route asks the day's allowance before and records `spent` after.
 */

export type HelpTopic = { readonly id: string; readonly title: string; readonly lines: readonly string[] };

export type HelpAnswer =
  | { readonly kind: 'answer'; readonly text: string; readonly topic: HelpTopic }
  /** The model's sentence was thrown away (or none came): the guide's own lines. */
  | { readonly kind: 'guide'; readonly topic: HelpTopic }
  | { readonly kind: 'notYet' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'failed' };

export type HelpAnswered = { readonly answer: HelpAnswer; readonly spent: AdvisorSpent };

/**
 * Things Nomi does not do, as a question names them. Each was checked in the code (2026-11-10) and is listed in
 * the build notes for the owner: WeChat, WeCom and RED are on Channels as coming (`COMING_SOON`, channels.ts); no
 * SMS, phone or voice-call channel exists (src/channels); no Viber or LINE channel; no Zapier, Google Calendar,
 * Amazon or eBay connection.
 */
export const NOT_YET: readonly { readonly name: string; readonly re: RegExp }[] = [
  { name: 'WeChat', re: /\bwe-?chat\b|微信|weixin/i },
  { name: 'WeCom', re: /\bwecom\b|企业微信/i },
  { name: 'RED', re: /\brednote\b|\bxiaohongshu\b|小红书/i },
  { name: 'SMS', re: /\bsms\b|短信/i },
  { name: 'calls', re: /\b(?:phone|voice)[ -]?calls?\b|\bcall (?:my|the|a) customers?\b|\bmake calls?\b|打电话给客户/i },
  { name: 'Viber', re: /\bviber\b/i },
  { name: 'LINE', re: /\bline (?:app|messenger)\b/i },
  { name: 'Zapier', re: /\bzapier\b/i },
  { name: 'Google Calendar', re: /\bgoogle calendar\b/i },
  { name: 'Amazon', re: /\bamazon\b/i },
  { name: 'eBay', re: /\bebay\b/i },
];

/**
 * Names of channels, services and kinds of feature an answer could claim. A sentence that names one the guide's
 * lines do not name is claiming something the guide does not say, and is thrown away. Matched on whole words,
 * case and width folded.
 */
export const FEATURE_TERMS: readonly string[] = [
  'whatsapp', 'instagram', 'messenger', 'facebook', 'telegram', 'tiktok', 'wechat', 'wecom', 'line', 'viber', 'signal',
  'sms', 'e-mail', 'email', 'phone call', 'voice call', 'call', 'calls',
  'shopify', 'woocommerce', 'etsy', 'amazon', 'ebay', 'stripe', 'paypal', 'xero', 'quickbooks', 'zapier', 'slack',
  'google', 'sheets', 'excel', 'pdf', 'csv', 'calendar', 'invoice', 'invoices', 'refund', 'refunds', 'payment',
  'payments', 'translate', 'translation', 'voice note', 'photo', 'photos', 'video', 'videos', 'app', 'apps',
  'integration', 'integrations', 'plugin', 'plugins', 'export', 'import', 'schedule', 'scheduled', 'broadcast',
  'broadcasts', 'campaign', 'campaigns', 'newsletter', 'post', 'posts', 'comments', 'stories', 'ads',
];

const fold = (s: string): string => normalise(s).toLowerCase();
const wordAt = (text: string, term: string): boolean =>
  new RegExp(`(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(text);

/** The feature terms `text` names that `facts` do not, folded. Empty: nothing claimed beyond the guide. */
export function namesAFeature(text: string, facts: readonly string[]): string[] {
  const said = fold(text);
  const known = fold(facts.join('\n'));
  return FEATURE_TERMS.filter((term) => wordAt(said, term) && !wordAt(known, term));
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
  if (!text) return done({ kind: 'guide', topic });
  const held = checkPhrasing(text, { facts: topic.lines, names: [], known: [], must: [], locale });
  if (!held.ok || namesAFeature(text, topic.lines).length > 0) return done({ kind: 'guide', topic });
  return done({ kind: 'answer', text, topic });
}
