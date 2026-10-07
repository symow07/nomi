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

import { countryName, type MessageKey } from '../owner/i18n/messages.js';
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
 * The company that turns a voice message into text, when there is one: the
 * transcriber is built only when `TRANSCRIBE_API_KEY` is set (worker/mediaPorts.ts),
 * and it calls OpenAI's own API unless `TRANSCRIBE_BASE_URL` points elsewhere
 * (llm/transcribe.ts). The same two variables decide it here, so the page names
 * the transcriber exactly when one runs, and nobody when none does.
 */
export function transcriberProcessor(env: Readonly<Record<string, string | undefined>>): Processor | null {
  if (!env['TRANSCRIBE_API_KEY']?.trim()) return null;
  return aiProcessor(env['TRANSCRIBE_BASE_URL']?.trim() || 'https://api.openai.com/v1');
}

/**
 * THE ADVISOR'S HISTORY (§9.3 of docs/ADVISOR-MEMORY.md) — what a provider
 * itself keeps of a question it was sent, in one line, for the providers this
 * build can describe: checked on 2026-10-07 against DeepSeek's Open Platform
 * terms (effective 2026-04-29) and privacy policy (2026-02-10), and OpenAI's
 * "Your data" page for its API. Any other provider has no line — Anthropic
 * among them, until its current terms are checked — and the page then names
 * the provider and says nothing about what it keeps rather than guess.
 */
const PROVIDER_LINES: Readonly<Record<string, MessageKey>> = {
  DeepSeek: 'legal.privacy.provider.deepseek',
  OpenAI: 'legal.privacy.provider.openai',
};

/** The line that says what this provider keeps; null when this build cannot say. */
export const providerLineKey = (p: Processor): MessageKey | null => PROVIDER_LINES[p.name] ?? null;

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
