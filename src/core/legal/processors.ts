/**
 * WHO ACTUALLY TOUCHES A BUYER'S WORDS — one source of truth, for the pages
 * that have to say so out loud.
 *
 * The privacy page named "Anthropic" in three languages as a hard-coded
 * sentence. On 2026-09-19 the installation switched to DeepSeek and the page
 * went on naming Anthropic — and its next line says "Nobody else." A buyer read
 * a false statement about where their message went, in the same week Meta's
 * reviewer was reading that URL. A legal page may not be a place where a fact
 * is written down a second time and left to rot.
 *
 * So the page is TOLD who the processor is, and this module is what tells it:
 * derived from the same configuration `llmProviderFrom` reads, never typed
 * twice. A parity test asserts the three locales say the same thing, and that
 * what they say matches what this returns.
 *
 * WHERE THE DATA GOES is the half a buyer actually asks about, so a processor
 * is not just a name: it is a name AND a country, and an unknown host may not
 * be given one. Pure — no I/O, no environment reading of its own.
 */

import { countryName } from '../owner/i18n/messages.js';
import type { Locale } from '../owner/i18n/locale.js';

export type Processor = {
  /** The company, as it calls itself. */
  readonly name: string;
  /**
   * Where that company processes the text, as an ISO country code — never a
   * word, because the page it lands on is read in three languages and
   * "DeepSeek (China)" inside a Chinese sentence is the product speaking two
   * languages at once. `null` when this build does not know the host: the page
   * then names the company and claims no country, which is the only honest
   * thing left to say.
   */
  readonly country: string | null;
};

/** Where this installation runs. An operator fact, stated once. */
export const HOSTING: Processor = { name: 'Railway', country: 'US' };

/**
 * The hosts this build can name, by the address its API is called at. A host
 * that is not here is named by its own domain and given no country, and the
 * boot log says so — better a page that says less than a page that guesses
 * which country a buyer's words crossed into.
 */
const KNOWN: Readonly<Record<string, Processor>> = {
  'api.anthropic.com': { name: 'Anthropic', country: 'US' },
  'api.deepseek.com': { name: 'DeepSeek', country: 'CN' },
  'api.openai.com': { name: 'OpenAI', country: 'US' },
};

/** Anthropic is what the product calls when no other provider is configured. */
export const DEFAULT_PROCESSOR: Processor = KNOWN['api.anthropic.com']!;

/**
 * The company whose language service drafts the replies, from the base URL the
 * model client was pointed at. `null` (no override) is Anthropic's own API.
 */
export function aiProcessor(baseURL: string | null): Processor {
  if (!baseURL) return DEFAULT_PROCESSOR;
  let host: string;
  try { host = new URL(baseURL).host.toLowerCase(); } catch { return { name: baseURL, country: null }; }
  return KNOWN[host] ?? { name: host, country: null };
}

/**
 * "DeepSeek（中国）" in Chinese, "DeepSeek (China)" in English and Arabic, and
 * plain "DeepSeek" when the country is not known. The brackets are the
 * language's own: half-width ones around a Chinese country name read as an
 * English fragment dropped into a Chinese line.
 */
export function processorLabel(p: Processor, locale: Locale): string {
  const where = countryName(locale, p.country);
  if (where === null) return p.name;
  return locale === 'zh' ? `${p.name}（${where}）` : `${p.name} (${where})`;
}

/** The same, in English, for an operator reading a log line. */
export const processorForLog = (p: Processor): string => processorLabel(p, 'en');
