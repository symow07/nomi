import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MODEL, llmClient, llmProviderFrom } from '../../src/llm/provider.js';
import { anthropicAnalyzer, anthropicReplyWriter } from '../../src/llm/anthropic.js';
import { emptyState } from './fixtures.js';

/**
 * N6a — which model company answers when she needs one.
 *
 * A model is her fallback, and it may be whichever provider the installation
 * pays for. Several speak Anthropic's message format at their own address, so
 * another provider is the same client pointed somewhere else. These prove the
 * switch is all-or-nothing, that unset changes nothing, and that the model name
 * really reaches the request and the turn's record.
 */

const KEY = 'sk-ant-not-a-real-key-000000000000';
const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

afterEach(() => vi.restoreAllMocks());

describe('N6a · choosing the provider', () => {
  it('unset, nothing changes: Anthropic, her key, the pinned model', () => {
    expect(llmProviderFrom({}, KEY)).toEqual({ name: 'anthropic', apiKey: KEY, baseURL: null, model: DEFAULT_MODEL });
  });

  it('all three set: that provider, at its address, under its model name', () => {
    const p = llmProviderFrom({ LLM_BASE_URL: 'https://api.deepseek.com/anthropic/', LLM_API_KEY: 'sk-0123456789abcdef0123', LLM_MODEL: 'deepseek-flash' }, KEY);
    expect(p).toEqual({ name: 'custom', apiKey: 'sk-0123456789abcdef0123', baseURL: 'https://api.deepseek.com/anthropic', model: 'deepseek-flash' });
    expect(llmClient(p).baseURL).toBe('https://api.deepseek.com/anthropic');
  });

  it('a half-set trio is no switch at all — it says which part is missing and keeps Anthropic', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const env of [
      { LLM_BASE_URL: 'https://api.deepseek.com/anthropic' },
      { LLM_BASE_URL: 'https://api.deepseek.com/anthropic', LLM_MODEL: 'deepseek-flash' },
      { LLM_BASE_URL: 'http://api.deepseek.com/anthropic', LLM_API_KEY: 'sk-0123456789abcdef0123', LLM_MODEL: 'deepseek-flash' }, // not https
      { LLM_BASE_URL: 'https://api.deepseek.com/anthropic', LLM_API_KEY: 'CHANGE_ME_CHANGE_ME_CHANGE', LLM_MODEL: 'deepseek-flash' },
    ]) {
      expect(llmProviderFrom(env, KEY).name).toBe('anthropic');
    }
    expect(warn).toHaveBeenCalledTimes(4);
    // The warning names variables, never a value.
    expect(String(warn.mock.calls[0]![0])).toMatch(/LLM_API_KEY, LLM_MODEL/);
    expect(warn.mock.calls.map((c) => String(c[0])).join(' ')).not.toMatch(/sk-0123|CHANGE_ME/);
  });
});

describe('N6a · the model name reaches the request and the record', () => {
  const fakeClient = (seen: { model?: string }) => ({
    messages: { create: async (req: { model: string }) => {
      seen.model = req.model;
      return { content: [{ type: 'text', text: '{"reply_text":"Hello there."}' }], usage: { input_tokens: 10, output_tokens: 5 } };
    } },
  }) as never;

  it('the reply writer asks for the provider\'s model and says so on the turn', async () => {
    const seen: { model?: string } = {};
    const w = await anthropicReplyWriter(fakeClient(seen), 'deepseek-flash').write({
      state: emptyState(), text: 'hi', quote: null, replyLanguage: 'en', nextQuestion: null, retryAfterViolation: false,
    });
    expect(seen.model).toBe('deepseek-flash');
    expect(w.modelId).toBe('deepseek-flash');
  });

  it('left alone, it is the pinned model, as before', async () => {
    const seen: { model?: string } = {};
    await anthropicReplyWriter(fakeClient(seen)).write({
      state: emptyState(), text: 'hi', quote: null, replyLanguage: 'en', nextQuestion: null, retryAfterViolation: false,
    });
    expect(seen.model).toBe(DEFAULT_MODEL);
    expect(typeof anthropicAnalyzer).toBe('function');
  });

  it('every model-backed part of production is built from the ONE provider', () => {
    const main = read('src/main.ts'); const worker = read('src/worker/main.ts');
    expect(main).not.toMatch(/new Anthropic\(/);
    expect(worker).not.toMatch(/new Anthropic\(/);
    expect(worker).toMatch(/anthropicAnalyzer\(anthropic, llm\.model\)/);
    expect(worker).toMatch(/anthropicReplyWriter\(anthropic, llm\.model\)/);
    expect(worker).toMatch(/anthropicVision\(anthropic, llm\.model\)/);
    expect(main).toMatch(/anthropicPageTranscriber\(llmClient\(llm\), llm\.model\)/);
  });
});
