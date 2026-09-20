import { describe, it, expect, vi, afterEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MODEL, llmClient, llmProviderFrom, requestExtrasFor } from '../../src/llm/provider.js';
import { validateEnv } from '../../src/main.js';
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

/** The one method the adapters call, typed — so a fake cannot drift from what they read. */
type Answer = { content: ({ type: 'text'; text: string } | { type: 'thinking'; thinking: string })[]; usage: { input_tokens: number; output_tokens: number } };
const clientThat = (create: (req: Record<string, unknown>) => Promise<Answer>): Anthropic =>
  ({ messages: { create } }) as unknown as Anthropic;


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
  const fakeClient = (seen: { model?: string }) => clientThat(async (req) => {
    seen.model = String(req['model']);
    return { content: [{ type: 'text', text: '{"reply_text":"Hello there."}' }], usage: { input_tokens: 10, output_tokens: 5 } };
  });

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

  it('N6a.1 — a provider that thinks out loud: the answer is the first TEXT block, not whatever comes first', async () => {
    // What DeepSeek really returned on 2026-09-19: a thinking block, then the text.
    const thinker = clientThat(async () => ({
      content: [{ type: 'thinking', thinking: 'The buyer asks about tote bags…' }, { type: 'text', text: '{"reply_text":"Yes, we do."}' }],
      usage: { input_tokens: 61, output_tokens: 115 },
    }));
    const w = await anthropicReplyWriter(thinker, 'deepseek-flash').write({
      state: emptyState(), text: 'do you sell tote bags?', quote: null, replyLanguage: 'en', nextQuestion: null, retryAfterViolation: false,
    });
    expect(w.reply).toBe('Yes, we do.');   // it used to be read as empty, and the stand-in sentence went out

    const a = await anthropicAnalyzer(clientThat(async () => ({
      content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text: JSON.stringify({
        language: { detected: 'fr', reply_in: 'fr' },
        intent: { primary: 'inquiry', quantity_mentioned: 500, quantity_unit: 'pcs' }, recommended_phase: 'clarification' }) }],
      usage: { input_tokens: 10, output_tokens: 5 },
    })), 'deepseek-flash').analyze({ text: 'combien pour 500 sacs ?', state: emptyState(), candidates: [], recentMessages: [] });
    expect(a.analysis.language.detected).toBe('fr');
    expect(a.analysis.intent.quantityMentioned?.value).toBe(500);
  });

  it('N6a.1 — such a provider is told not to think; Anthropic\'s pinned model is sent nothing extra, as before', async () => {
    expect(requestExtrasFor({ name: 'custom', apiKey: 'k', baseURL: 'https://x.test', model: 'm' })).toEqual({ thinking: { type: 'disabled' } });
    expect(requestExtrasFor({ name: 'anthropic', apiKey: 'k', baseURL: null, model: DEFAULT_MODEL })).toEqual({});
    const sent: Record<string, unknown>[] = [];
    const spy = clientThat(async (req) => {
      sent.push(req);
      return { content: [{ type: 'text', text: '{"reply_text":"ok"}' }], usage: { input_tokens: 1, output_tokens: 1 } };
    });
    const input = { state: emptyState(), text: 'hi', quote: null, replyLanguage: 'en', nextQuestion: null, retryAfterViolation: false };
    await anthropicReplyWriter(spy, 'deepseek-flash', { thinking: { type: 'disabled' } }).write(input);
    await anthropicReplyWriter(spy).write(input);
    expect(sent[0]!['thinking']).toEqual({ type: 'disabled' });
    expect('thinking' in sent[1]!).toBe(false);
  });

  it('every model-backed part of production is built from the ONE provider', () => {
    const main = read('src/main.ts'); const worker = read('src/worker/main.ts');
    expect(main).not.toMatch(/new Anthropic\(/);
    expect(worker).not.toMatch(/new Anthropic\(/);
    expect(worker).toMatch(/anthropicAnalyzer\(anthropic, llm\.model, extras\)/);
    expect(worker).toMatch(/anthropicReplyWriter\(anthropic, llm\.model, extras\)/);
    expect(worker).toMatch(/anthropicVision\(anthropic, llm\.model, extras\)/);
    expect(main).toMatch(/anthropicPageTranscriber\(llmClient\(llm\), llm\.model, requestExtrasFor\(llm\)\)/);
  });
});

/**
 * PR 1 — A MODEL TO CALL: one key or the other, never a key kept to satisfy a
 * check. `ANTHROPIC_API_KEY` was required unconditionally, so an installation
 * that had moved to DeepSeek still had to keep a live Anthropic credential set
 * in order to start — a secret held for no reason is a secret waiting to leak.
 */
describe('N6a · the boot needs a model it can actually call', () => {
  const base = {
    WHATSAPP_PROVIDER: 'disabled',
    DATABASE_URL: 'postgres://u:p@h/db',
    WEBHOOK_VERIFY_TOKEN: 'verify-token-of-length',
    CREDENTIAL_KEY: 'a'.repeat(64),
  };
  const trio = {
    LLM_BASE_URL: 'https://api.deepseek.com/anthropic',
    LLM_API_KEY: 'sk-0123456789abcdef0123',
    LLM_MODEL: 'deepseek-flash',
  };
  const problems = (env: Record<string, string>) => {
    const v = validateEnv(env);
    return v.ok ? [] : v.problems;
  };

  it('another provider configured: the Anthropic key is not needed and need not be kept', () => {
    expect(problems({ ...base, ...trio })).toEqual([]);
  });

  it('no other provider: the Anthropic key is still required, and says what else would do', () => {
    const p = problems(base);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain('ANTHROPIC_API_KEY: missing');
    expect(p[0]).toContain('LLM_BASE_URL');
  });

  it('a HALF-set trio is no provider at all — the Anthropic key is required again', () => {
    expect(problems({ ...base, LLM_BASE_URL: trio.LLM_BASE_URL, LLM_MODEL: trio.LLM_MODEL })[0])
      .toContain('ANTHROPIC_API_KEY: missing');
  });

  it('the Anthropic key alone still boots, exactly as before', () => {
    expect(problems({ ...base, ANTHROPIC_API_KEY: 'sk-ant-not-a-real-key-but-long-enough' })).toEqual([]);
  });

  it('a placeholder or a stub key is refused, as it always was', () => {
    expect(problems({ ...base, ANTHROPIC_API_KEY: 'CHANGE_ME_CHANGE_ME_CHANGE' })[0]).toContain('placeholder');
    expect(problems({ ...base, ANTHROPIC_API_KEY: 'short' })[0]).toContain('invalid shape');
  });
});
