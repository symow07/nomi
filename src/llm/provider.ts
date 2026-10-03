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

/**
 * What every answer the provider sent is shown to, after it arrived whole: its
 * status and its body as text. BILLING RESILIENCE — the provider's state is
 * learnt here, from every call any part of the app makes (a turn, a photo, a
 * page read, the probe): a billing refusal starts the outage, any success ends
 * it (src/pipeline/providerWatch.ts). It may not throw into the call, and a
 * slow one would hold the call: it is given what arrived and nothing to wait on.
 */
export type ProviderObserver = (answer: { readonly status: number; readonly text: string }) => void;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * BILLING RESILIENCE (2026-10-04) — THE SDK'S TIMEOUT COVERS THE WHOLE ANSWER.
 *
 * The SDK arms its timeout around `fetch` alone, and `fetch` resolves when the
 * HEADERS arrive (node_modules/@anthropic-ai/sdk/client.js, `fetchWithTimeout`:
 * the timer is cleared in a `finally` once the fetch settles). The body is read
 * afterwards with no limit at all. That is the 2026-10-01 stall: the provider
 * answered HTTP 200 within a second and never sent the body — DeepSeek's own
 * documented behaviour while a request waits ("Non-streaming requests:
 * continuously return empty lines … If the request has not started inference
 * after 10 minutes, the server will close the connection",
 * api-docs.deepseek.com/quick_start/rate_limit), so Node's idle-body limit
 * never fires either.
 *
 * This fetch reads the body to its end BEFORE it resolves, so the SDK's own
 * timer — and its abort signal, which this fetch passes on — covers headers and
 * body together: a request that gets headers and then never a body fails at
 * its own timeout, as a timeout, and is retried or given up exactly like one.
 * Nothing in Nomi streams a model's answer; a stream (`text/event-stream`) is
 * passed through untouched, its idle limit its caller's.
 */
export function wholeResponseFetch(base: FetchLike = fetch, observe?: ProviderObserver): FetchLike {
  return async (input, init) => {
    const res = await base(input, init);
    if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) return res;
    const body = await res.arrayBuffer();     // under the SDK's timer and its signal
    if (observe) {
      try { observe({ status: res.status, text: new TextDecoder().decode(body) }); } catch { /* never into the call */ }
    }
    return new Response(res.status === 204 || res.status === 304 ? null : body,
      { status: res.status, statusText: res.statusText, headers: res.headers });
  };
}

/** The one client. Another provider is the same client at another address. */
export const llmClient = (p: LlmProvider, o: { readonly observe?: ProviderObserver; readonly fetch?: FetchLike } = {}): Anthropic =>
  new Anthropic({
    apiKey: p.apiKey, ...(p.baseURL ? { baseURL: p.baseURL } : {}),
    fetch: wholeResponseFetch(o.fetch ?? fetch, o.observe),
  });
