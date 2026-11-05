import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { llmClient, requestExtrasFor, type LlmProvider } from '../../src/llm/provider.js';
import { anthropicReplyWriter, usageOf } from '../../src/llm/anthropic.js';
import {
  fromChatCompletion, openAiFetch, speaksOpenAi, toChatCompletion, withoutOutputFormat,
} from '../../src/llm/openAiFormat.js';
import { ANALYSIS_SCHEMA, WRITER_SCHEMA } from '../../src/llm/outputSchemas.js';
import { classifyProviderFailure } from '../../src/llm/providerFailure.js';
import { estimateCost } from '../../src/core/conversation/answerPath.js';
import { balanceEndpointFor } from '../../src/core/ops/providerWatch.js';
import { emptyState } from './fixtures.js';

type Call = { readonly url: string; readonly init: RequestInit; readonly body: Record<string, unknown> };

const PROVIDER: LlmProvider = { name: 'custom', apiKey: 'test-key-0123456789', baseURL: 'https://api.openai.com/v1', model: 'gpt-6-luna' };

/** The provider's side of the wire, and what it was asked. */
function wire(answer: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchLike = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call = { url: String(input), init: init ?? {}, body: JSON.parse(String(init?.body)) as Record<string, unknown> };
    calls.push(call);
    return answer(call);
  };
  return { calls, fetchLike };
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const said = (content: string, finish = 'stop', usage: unknown = { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 60 } }) =>
  ({ id: 'x', model: 'gpt-6-luna', choices: [{ finish_reason: finish, message: { role: 'assistant', content } }], usage });

describe('which format an address speaks', () => {
  it('reads it from the host, so the rollback stays three variables', () => {
    expect(speaksOpenAi('https://api.openai.com/v1')).toBe(true);
    expect(speaksOpenAi('https://API.OPENAI.COM/v1')).toBe(true);
    for (const other of ['https://api.deepseek.com/anthropic', 'https://api.anthropic.com', 'https://api.openai.com.example.org/v1', null, 'nonsense']) {
      expect(speaksOpenAi(other)).toBe(false);
    }
  });
});

describe('the request', () => {
  const base = { model: 'm', max_tokens: 600, temperature: 0.3, system: 'Rules.', messages: [{ role: 'user', content: 'Hi' }] };

  it('carries the system prompt, the words, the limit and the temperature', () => {
    expect(toChatCompletion(base)).toEqual({
      model: 'm', max_completion_tokens: 600, temperature: 0.3,
      messages: [{ role: 'system', content: 'Rules.' }, { role: 'user', content: 'Hi' }],
    });
  });

  it('thinking off is reasoning off, and a schema is forced strictly', () => {
    const asked = toChatCompletion({ ...base, thinking: { type: 'disabled' }, output_config: { format: { type: 'json_schema', schema: WRITER_SCHEMA } } });
    expect(asked['reasoning_effort']).toBe('none');
    expect(asked['response_format']).toEqual({ type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: WRITER_SCHEMA } });
    expect(asked).not.toHaveProperty('thinking');
    expect(asked).not.toHaveProperty('output_config');
  });

  it('sends an image as a data address, and refuses a block it has no way to send', () => {
    const asked = toChatCompletion({ ...base, messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } }, { type: 'text', text: 'What is this?' },
    ] }] });
    expect((asked['messages'] as { content: unknown }[])[1]?.content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } }, { type: 'text', text: 'What is this?' },
    ]);
    expect(() => toChatCompletion({ ...base, messages: [{ role: 'user', content: [{ type: 'document', source: {} }] }] })).toThrow(/document/);
  });
});

describe('the answer', () => {
  it('gives the words, and all input counted once with the cached part aside', () => {
    const a = fromChatCompletion(said('Hello')) as { content: unknown; stop_reason: string; usage: Parameters<typeof usageOf>[0] };
    expect(a.content).toEqual([{ type: 'text', text: 'Hello' }]);
    expect(a.stop_reason).toBe('end_turn');
    expect(usageOf(a.usage)).toEqual({ inputTokens: 100, outputTokens: 20, cachedInputTokens: 60 });
  });

  it('a call with no cached tokens reported counts all of it as plain input', () => {
    const a = fromChatCompletion(said('x', 'stop', { prompt_tokens: 7, completion_tokens: 1 })) as { usage: Parameters<typeof usageOf>[0] };
    expect(usageOf(a.usage)).toEqual({ inputTokens: 7, outputTokens: 1, cachedInputTokens: 0 });
  });

  it('reads why it stopped', () => {
    expect((fromChatCompletion(said('cut', 'length')) as { stop_reason: string }).stop_reason).toBe('max_tokens');
    expect((fromChatCompletion(said('', 'content_filter')) as { stop_reason: string }).stop_reason).toBe('refusal');
  });

  it('a refusal has no words at all', () => {
    const a = fromChatCompletion({ choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'No.' } }] }) as { content: unknown[]; stop_reason: string };
    expect(a.content).toEqual([]);
    expect(a.stop_reason).toBe('refusal');
  });
});

describe('through the one client', () => {
  it('asks the provider at its own address with its own key, and nothing of the other format', async () => {
    const w = wire(() => json(200, said('OK')));
    const res = await llmClient(PROVIDER, { fetch: w.fetchLike }).messages.create({
      model: PROVIDER.model, ...requestExtrasFor(PROVIDER), max_tokens: 8, messages: [{ role: 'user', content: 'Reply with the word OK.' }],
    });
    expect(res.content).toEqual([{ type: 'text', text: 'OK' }]);
    expect(w.calls[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    const headers = new Headers(w.calls[0]?.init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${PROVIDER.apiKey}`);
    expect(headers.get('x-api-key')).toBeNull();
    expect(headers.get('anthropic-version')).toBeNull();
    expect(w.calls[0]?.body['reasoning_effort']).toBe('none');
  });

  it('the real writer is held to its schema and reads the answer', async () => {
    const w = wire(() => json(200, said(JSON.stringify({ reply_text: 'Which one?', attach_product_image: false, tone: 'warm', phase_action: 'maintain' }))));
    const writer = anthropicReplyWriter(llmClient(PROVIDER, { fetch: w.fetchLike }), PROVIDER.model, requestExtrasFor(PROVIDER));
    const out = await writer.write({ state: emptyState(), text: 'Hello', quote: null, replyLanguage: 'en', nextQuestion: null, retryAfterViolation: false });
    expect(out.reply).toBe('Which one?');
    expect(out.usage).toEqual({ inputTokens: 100, outputTokens: 20, cachedInputTokens: 60 });
    expect(w.calls[0]?.body['response_format']).toMatchObject({ type: 'json_schema', json_schema: { strict: true, schema: WRITER_SCHEMA } });
  });

  it('a provider refusal stays itself: out of quota is money, not a rate limit', async () => {
    const quota = { error: { message: 'You exceeded your current quota, please check your plan and billing details.', type: 'insufficient_quota', param: null, code: 'insufficient_quota' } };
    const client = llmClient(PROVIDER, { fetch: wire(() => json(429, quota)).fetchLike });
    const failure = await client.messages.create({ model: PROVIDER.model, max_tokens: 8, messages: [{ role: 'user', content: 'x' }] }, { maxRetries: 0 }).catch((e: unknown) => e);
    expect(classifyProviderFailure(failure)).toMatchObject({ kind: 'billing', status: 429 });
  });

  it('a rate limit is still a rate limit, and a bad key still the key', async () => {
    const ask = async (status: number, error: unknown) => llmClient(PROVIDER, { fetch: wire(() => json(status, { error })).fetchLike })
      .messages.create({ model: PROVIDER.model, max_tokens: 8, messages: [{ role: 'user', content: 'x' }] }, { maxRetries: 0 }).catch((e: unknown) => e);
    expect(classifyProviderFailure(await ask(429, { message: 'Rate limit reached', type: 'requests', code: 'rate_limit_exceeded' }))).toMatchObject({ kind: 'rate_limited' });
    expect(classifyProviderFailure(await ask(401, { message: 'Incorrect API key provided', code: 'invalid_api_key' }))).toMatchObject({ kind: 'auth' });
  });
});

describe("Anthropic's own address, as the fallback", () => {
  const OWN: LlmProvider = { ...PROVIDER, baseURL: 'https://api.anthropic.com', model: 'claude-haiku-5-5' };
  const answers = () => wire(() => json(200, { id: 'x', type: 'message', role: 'assistant', model: OWN.model, stop_reason: 'end_turn', stop_sequence: null,
    content: [{ type: 'text', text: JSON.stringify({ reply_text: 'Hi', attach_product_image: false, tone: 'warm', phase_action: 'maintain' }) }],
    usage: { input_tokens: 1, output_tokens: 1 } }));

  it('keeps the forced schema, sends no temperature, thinks not at all, and runs in the United States', async () => {
    const w = answers();
    const writer = anthropicReplyWriter(llmClient(OWN, { fetch: w.fetchLike }), OWN.model, requestExtrasFor(OWN));
    await writer.write({ state: emptyState(), text: 'Hello', quote: null, replyLanguage: 'en', nextQuestion: null, retryAfterViolation: false });
    const asked = w.calls[0];
    expect(asked?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(asked?.body).not.toHaveProperty('temperature');
    expect(asked?.body['output_config']).toEqual({ format: { type: 'json_schema', schema: WRITER_SCHEMA }, effort: 'low' });
    expect(asked?.body['thinking']).toEqual({ type: 'disabled' });
    expect(asked?.body['inference_geo']).toBe('us');
    expect(asked?.body['model']).toBe('claude-haiku-5-5');
  });

  it('is only that address: another company in the same format keeps its temperature and is told nothing of the rest', async () => {
    const other: LlmProvider = { ...OWN, baseURL: 'https://api.deepseek.com/anthropic', model: 'deepseek-flash' };
    const w = answers();
    const writer = anthropicReplyWriter(llmClient(other, { fetch: w.fetchLike }), other.model, requestExtrasFor(other));
    await writer.write({ state: emptyState(), text: 'Hello', quote: null, replyLanguage: 'en', nextQuestion: null, retryAfterViolation: false });
    expect(w.calls[0]?.body['temperature']).toBe(0.3);
    expect(w.calls[0]?.body).not.toHaveProperty('inference_geo');
    expect(w.calls[0]?.body).not.toHaveProperty('output_config');
  });

  it('prices it with the charge for running in the United States', () => {
    expect(Number(estimateCost('claude-haiku-5-5', 1_000_000, 1_000_000)?.amount)).toBeCloseTo(0.66, 8);
  });
});

describe('a provider in the other format', () => {
  it('is asked for no schema: the rollback to it works as it did', async () => {
    const seen: Record<string, unknown>[] = [];
    const strip = withoutOutputFormat(async (_u, init) => {
      seen.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return json(200, { id: 'x', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'OK' }], usage: { input_tokens: 1, output_tokens: 1 } });
    });
    await strip('https://x', { body: JSON.stringify({ model: 'm', output_config: { format: { type: 'json_schema', schema: {} } }, max_tokens: 8 }) });
    expect(seen[0]).toEqual({ model: 'm', max_tokens: 8 });
  });

  it('through the client, the same writer sends no schema to it', async () => {
    const other: LlmProvider = { ...PROVIDER, baseURL: 'https://api.deepseek.com/anthropic', model: 'deepseek-flash' };
    const w = wire(() => json(200, { id: 'x', type: 'message', role: 'assistant', model: 'deepseek-flash', stop_reason: 'end_turn', stop_sequence: null,
      content: [{ type: 'text', text: JSON.stringify({ reply_text: 'Hi', attach_product_image: false, tone: 'warm', phase_action: 'maintain' }) }],
      usage: { input_tokens: 1, output_tokens: 1 } }));
    const writer = anthropicReplyWriter(llmClient(other, { fetch: w.fetchLike }), other.model, requestExtrasFor(other));
    await writer.write({ state: emptyState(), text: 'Hello', quote: null, replyLanguage: 'en', nextQuestion: null, retryAfterViolation: false });
    expect(w.calls[0]?.url).toBe('https://api.deepseek.com/anthropic/v1/messages');
    expect(w.calls[0]?.body).not.toHaveProperty('output_config');
    expect(w.calls[0]?.body['thinking']).toEqual({ type: 'disabled' });
  });
});

describe('the schemas are the prompts', () => {
  /** Every field a schema names. Strict means a field the schema leaves out never comes back. */
  const fields = (s: unknown, into = new Set<string>()): Set<string> => {
    if (Array.isArray(s)) { for (const x of s) fields(x, into); return into; }
    if (typeof s !== 'object' || s === null) return into;
    const o = s as Record<string, unknown>;
    if (o['properties']) for (const [k, v] of Object.entries(o['properties'] as Record<string, unknown>)) { into.add(k); fields(v, into); }
    fields(o['items'], into); fields(o['anyOf'], into);
    return into;
  };
  /** The field names in a prompt's OUTPUT SCHEMA block. */
  const asked = (file: string): Set<string> => {
    const text = readFileSync(new URL(`../../prompts/${file}`, import.meta.url), 'utf8');
    const block = text.slice(text.indexOf('OUTPUT SCHEMA:'));
    return new Set([...block.slice(0, block.search(/\n}\n/) + 2).matchAll(/"([a-z_]+)":/g)].map((m) => m[1] as string));
  };

  it('the writer', () => { expect(fields(WRITER_SCHEMA)).toEqual(asked('response.txt')); });
  it('the analysis', () => { expect(fields(ANALYSIS_SCHEMA)).toEqual(asked('analysis.txt')); });

  it('strict, all the way down: every field required, nothing added', () => {
    const walk = (s: unknown): void => {
      if (Array.isArray(s)) { s.forEach(walk); return; }
      if (typeof s !== 'object' || s === null) return;
      const o = s as Record<string, unknown>;
      if (o['properties']) {
        expect(o['additionalProperties']).toBe(false);
        expect([...(o['required'] as string[])].sort()).toEqual(Object.keys(o['properties'] as object).sort());
        Object.values(o['properties'] as object).forEach(walk);
      }
      walk(o['items']); walk(o['anyOf']);
    };
    walk(WRITER_SCHEMA); walk(ANALYSIS_SCHEMA);
  });
});

describe('around the provider', () => {
  it('has a list price, its cached input apart', () => {
    expect(estimateCost('gpt-6-luna', 1_000_000, 0)?.amount).toBe('0.1');
    expect(estimateCost('gpt-6-luna', 1_000_000, 0, 1_000_000)?.amount).toBe('0.01');
    expect(estimateCost('gpt-6-luna', 0, 1_000_000)?.amount).toBe('0.5');
  });

  it('has no balance to read: the low-balance steps do not run', () => {
    expect(balanceEndpointFor('https://api.openai.com/v1')).toBeNull();
  });
});
