import Anthropic from '@anthropic-ai/sdk';
import { classifyProviderFailure } from './providerFailure.js';
import { failureCounts, type CallOutcome } from '../core/ops/modelHealth.js';

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
 * 0166 — THE SECOND PROVIDER (the owner, 2026-10-15: "Build a FALLBACK provider behind a flag: the system fails over
 * when the primary times out or refuses, and says so in the logs and on /health").
 *
 * `LLM_FALLBACK_BASE_URL`, `LLM_FALLBACK_API_KEY`, `LLM_FALLBACK_MODEL` — all three or none, checked like the
 * primary's; a half-set trio is warned about and unused. Any provider that speaks Anthropic's message format at its
 * own address (Anthropic itself: `https://api.anthropic.com`). Configured, it is CHECKED every five minutes (so it is
 * known to work before it is needed) and measured by the tools' `--fallback` (tools/lib/model-env.mjs); it ANSWERS
 * only while `LLM_FALLBACK=on`.
 */
export function llmFallbackFrom(env: Record<string, string | undefined>): LlmProvider | null {
  const baseURL = env['LLM_FALLBACK_BASE_URL']?.trim() ?? '';
  const apiKey = env['LLM_FALLBACK_API_KEY']?.trim() ?? '';
  const model = env['LLM_FALLBACK_MODEL']?.trim() ?? '';
  if (!baseURL && !apiKey && !model) return null;
  const missing: string[] = [];
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w./-]*)?$/i.test(baseURL)) missing.push('LLM_FALLBACK_BASE_URL');
  if (apiKey.length < 16 || apiKey.includes('CHANGE_ME')) missing.push('LLM_FALLBACK_API_KEY');
  if (!/^[A-Za-z0-9._:-]{2,80}$/.test(model)) missing.push('LLM_FALLBACK_MODEL');
  if (missing.length) {
    console.warn(`Fallback model provider: ${missing.join(', ')} missing or malformed. No fallback.`);
    return null;
  }
  return { name: 'custom', apiKey, baseURL: baseURL.replace(/\/+$/, ''), model };
}

/** Does a call fail over? Only while `LLM_FALLBACK=on` and a fallback is configured. */
export const fallbackSwitchedOn = (env: Record<string, string | undefined>, fallback: LlmProvider | null): boolean =>
  fallback !== null && (env['LLM_FALLBACK'] ?? '').trim().toLowerCase() === 'on';

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

/**
 * 0165 — how one call ended, for the model's health (src/pipeline/modelHealth.ts). Told after the call settled, to a
 * listener that may not throw into it or hold it: the caller gets exactly the promise the SDK returned.
 */
export type CallObserver = (outcome: CallOutcome) => void;

/** The client, with every `messages.create` timed and its ending told. Nothing else about it changes. */
export function timedClient(client: Anthropic, onCall: CallObserver, clock: () => number = Date.now): Anthropic {
  const tell = (o: CallOutcome): void => { try { onCall(o); } catch { /* never into the call */ } };
  const messages = client.messages;
  const create = messages.create.bind(messages) as (...args: unknown[]) => Promise<unknown>;
  const timedCreate = (...args: unknown[]): Promise<unknown> => {
    const started = clock();
    const call = create(...args);
    call.then(
      () => tell({ ok: true, ms: clock() - started }),
      (e: unknown) => {
        const f = classifyProviderFailure(e);
        tell({ ok: false, ms: clock() - started, failure: f.kind, status: 'status' in f ? f.status ?? null : null });
      },
    );
    return call;
  };
  // Bound to their own objects: the SDK's classes keep private fields a proxied `this` could not reach.
  const own = <T extends object>(target: T, swap: (k: PropertyKey) => unknown): T => new Proxy(target, {
    get(t, k) {
      const swapped = swap(k);
      if (swapped !== undefined) return swapped;
      const v = Reflect.get(t, k) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
  const timedMessages = own(messages, (k) => (k === 'create' ? timedCreate : undefined));
  return own(client, (k) => (k === 'messages' ? timedMessages : undefined));
}

/** The one client. Another provider is the same client at another address. */
export const llmClient = (
  p: LlmProvider,
  o: { readonly observe?: ProviderObserver; readonly fetch?: FetchLike; readonly onCall?: CallObserver } = {},
): Anthropic => {
  const client = new Anthropic({
    apiKey: p.apiKey, ...(p.baseURL ? { baseURL: p.baseURL } : {}),
    fetch: wholeResponseFetch(o.fetch ?? fetch, o.observe),
  });
  return o.onCall ? timedClient(client, o.onCall) : client;
};

/**
 * 0166 — the primary is skipped for a while after it failed: two minutes, or until it answers a call or the check.
 * One per process, shared by every client, so a turn that found it dead spares the next turn the same wait.
 */
export type Breaker = { readonly open: () => void; readonly close: () => void; readonly isOpen: () => boolean };

export const BREAKER_MS = 120_000;

export function breaker(ms: number = BREAKER_MS, clock: () => number = Date.now): Breaker {
  let until = 0;
  return { open: () => { until = clock() + ms; }, close: () => { until = 0; }, isOpen: () => clock() < until };
}

/**
 * 0166 — ONE client that answers from the primary, and from the fallback when the primary does not: a timeout, a
 * refusal (billing included), an overload, a rate limit, a dead key, a server error, no connection
 * (`failureCounts`). A request the provider rejected as ours (a 400) is not retried anywhere: the fallback would
 * reject it too, and it would hide our bug.
 *
 * While failing over is switched on, the primary is asked ONCE (no retries: the fallback is the retry), with the
 * caller's own timeout; after a failure the breaker sends calls straight to the fallback for two minutes, then the
 * primary is tried again. The model in each request is the provider's own. Switched off, or with no fallback, this is
 * exactly the primary's client. Every transition is logged.
 */
export function failoverClient(o: {
  readonly primary: { readonly provider: LlmProvider; readonly client: Anthropic; readonly name: string };
  readonly fallback: { readonly provider: LlmProvider; readonly client: Anthropic; readonly name: string } | null;
  readonly on: boolean;
  readonly breaker: Breaker;
  readonly log?: (line: string) => void;
}): Anthropic {
  if (!o.fallback || !o.on) return o.primary.client;
  const log = o.log ?? ((line: string) => console.warn(line));
  const primary = o.primary;
  const fallback = o.fallback;
  type Params = Record<string, unknown>;
  const ask = (t: typeof primary, params: Params, options: Record<string, unknown> | undefined) =>
    (t.client.messages.create as unknown as (p: Params, opt?: Record<string, unknown>) => Promise<unknown>)(
      { ...params, model: t.provider.model, ...requestExtrasFor(t.provider) },
      t === primary ? { ...(options ?? {}), maxRetries: 0 } : options);
  const create = async (params: Params, options?: Record<string, unknown>): Promise<unknown> => {
    const order = o.breaker.isOpen() ? [fallback, primary] : [primary, fallback];
    let last: unknown = null;
    for (const t of order) {
      try {
        const res = await ask(t, params, options);
        if (t === primary) {
          if (o.breaker.isOpen()) log(`[model] ${primary.name} answers again: calls go to it`);
          o.breaker.close();
        }
        return res;
      } catch (e) {
        const f = classifyProviderFailure(e);
        // The health check's own rule: a 400 was our request, not the provider's failure.
        if (!failureCounts({ ok: false, ms: 0, failure: f.kind, status: 'status' in f ? f.status ?? null : null })) throw e;
        if (t === primary) {
          if (!o.breaker.isOpen()) log(`[model] ${primary.name} did not answer (${f.kind}): failing over to ${fallback.name} for ${BREAKER_MS / 60_000} minutes`);
          o.breaker.open();
        } else {
          log(`[model] the fallback ${fallback.name} did not answer either (${f.kind})`);
        }
        last = e;
      }
    }
    throw last;
  };
  const messages = { create };
  return new Proxy(primary.client, {
    get(t, k) {
      if (k === 'messages') return messages;
      const v = Reflect.get(t, k) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
}
