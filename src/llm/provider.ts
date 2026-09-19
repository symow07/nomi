import Anthropic from '@anthropic-ai/sdk';

/**
 * N6a — WHICH model company answers when she needs one.
 *
 * The owner's direction is that a model is her FALLBACK, and that it may be
 * Anthropic, OpenAI or DeepSeek — whichever the installation pays for. Several
 * providers speak Anthropic's message format at their own address (DeepSeek:
 * `https://api.deepseek.com/anthropic`), so the first step is not a second
 * implementation: it is the same client pointed somewhere else, with that
 * provider's key and model name. Everything that makes a reply safe — prices
 * from her own engine, the three guards, draft-first — sits after the model
 * and does not care who it is.
 *
 * ALL THREE, OR NONE. `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL` together
 * select another provider; a half-set trio is treated as unset, a warning says
 * which part is missing, and she keeps using Anthropic. Unset, nothing changes.
 *
 * WHAT CHANGES WITH THE PROVIDER, and is the operator's to weigh: buyers'
 * messages are sent to THAT company, under its terms and in its country, so the
 * privacy notice must name it; and the wording of a reply is that model's.
 */

/** The pin that stood alone until this file existed; see llm/anthropic.ts for why Haiku. */
export const DEFAULT_MODEL = 'claude-haiku-4-5';

export type LlmProvider = {
  /** `anthropic` unless all three LLM_* are set. For logs and the usage report, never a secret. */
  readonly name: 'anthropic' | 'custom';
  readonly apiKey: string;
  readonly baseURL: string | null;
  readonly model: string;
};

export function llmProviderFrom(env: Record<string, string | undefined>, anthropicKey: string): LlmProvider {
  const baseURL = env['LLM_BASE_URL']?.trim() ?? '';
  const apiKey = env['LLM_API_KEY']?.trim() ?? '';
  const model = env['LLM_MODEL']?.trim() ?? '';
  const anthropic: LlmProvider = { name: 'anthropic', apiKey: anthropicKey, baseURL: null, model: DEFAULT_MODEL };
  if (!baseURL && !apiKey && !model) return anthropic;

  const missing: string[] = [];
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w./-]*)?$/i.test(baseURL)) missing.push('LLM_BASE_URL');
  if (apiKey.length < 16 || apiKey.includes('CHANGE_ME')) missing.push('LLM_API_KEY');
  if (!/^[A-Za-z0-9._:-]{2,80}$/.test(model)) missing.push('LLM_MODEL');
  if (missing.length) {
    console.warn(`Model provider: ${missing.join(', ')} missing or malformed. Still using Anthropic.`);
    return anthropic;
  }
  return { name: 'custom', apiKey, baseURL: baseURL.replace(/\/+$/, ''), model };
}

/**
 * What every request to this provider carries besides the message. Anthropic's
 * pinned model is sent nothing extra, exactly as before. Another provider's
 * model may think by default (DeepSeek's does: a thinking block first, four
 * times the output tokens for one short sentence), so it is told not to.
 */
export const requestExtrasFor = (p: LlmProvider): { readonly thinking?: { readonly type: 'disabled' } } =>
  p.name === 'custom' ? { thinking: { type: 'disabled' } } : {};

/** The one client. Another provider is the same client at another address. */
export const llmClient = (p: LlmProvider): Anthropic =>
  new Anthropic({ apiKey: p.apiKey, ...(p.baseURL ? { baseURL: p.baseURL } : {}) });
