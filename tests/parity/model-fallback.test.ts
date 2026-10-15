import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type Anthropic from '@anthropic-ai/sdk';
import {
  breaker, failoverClient, fallbackSwitchedOn, llmFallbackFrom, type LlmProvider,
} from '../../src/llm/provider.js';
import { servingOf } from '../../src/core/ops/modelHealth.js';
import { renderPrivacy } from '../../src/api/web/legal.js';
import { HOSTING } from '../../src/core/legal/processors.js';
// @ts-expect-error — the operator tools, plain JS on purpose.
import { uptime } from '../../tools/model-uptime.mjs';
// @ts-expect-error — the operator tools, plain JS on purpose.
import { modelEnvFor } from '../../tools/lib/model-env.mjs';

/**
 * 0166 — a FALLBACK provider behind a flag (the owner, 2026-10-15: "the system fails over when the primary times out
 * or refuses, and says so in the logs and on /health"). The record and the check over Postgres:
 * tests/integration/model-fallback.test.ts.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const KEY = 'k'.repeat(24);
const PRIMARY: LlmProvider = { name: 'custom', apiKey: KEY, baseURL: 'https://api.deepseek.com/anthropic', model: 'deepseek-flash' };
const FALLBACK: LlmProvider = { name: 'custom', apiKey: KEY, baseURL: 'https://api.anthropic.com', model: 'claude-haiku-5-5' };
const timeout = () => Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });
const status = (s: number) => Object.assign(new Error(`HTTP ${s}`), { status: s, error: { error: { type: s === 400 ? 'invalid_request_error' : 'api_error' } } });

/** A client that records what it was asked and answers, or throws, as told. */
function fake(answer: () => unknown) {
  const asked: { params: Record<string, unknown>; options: Record<string, unknown> | undefined }[] = [];
  const client = { messages: { create: async (params: Record<string, unknown>, options?: Record<string, unknown>) => {
    asked.push({ params, options });
    return answer();
  } } } as unknown as Anthropic;
  return { client, asked };
}

describe('0166 · the settings', () => {
  it('all three or none; a half-set trio is no fallback; the switch is LLM_FALLBACK=on', () => {
    expect(llmFallbackFrom({})).toBeNull();
    expect(llmFallbackFrom({ LLM_FALLBACK_BASE_URL: 'https://api.anthropic.com', LLM_FALLBACK_MODEL: 'claude-haiku-5-5' })).toBeNull();
    const f = llmFallbackFrom({ LLM_FALLBACK_BASE_URL: 'https://api.anthropic.com/', LLM_FALLBACK_API_KEY: KEY, LLM_FALLBACK_MODEL: 'claude-haiku-5-5' });
    expect(f).toEqual({ name: 'custom', apiKey: KEY, baseURL: 'https://api.anthropic.com', model: 'claude-haiku-5-5' });
    expect(fallbackSwitchedOn({}, f)).toBe(false);
    expect(fallbackSwitchedOn({ LLM_FALLBACK: 'on' }, f)).toBe(true);
    expect(fallbackSwitchedOn({ LLM_FALLBACK: 'on' }, null)).toBe(false);
  });
  it('a tool\'s --fallback puts the fallback in the primary\'s place, and refuses when none is set', () => {
    const env = { LLM_BASE_URL: 'https://api.deepseek.com/anthropic', LLM_API_KEY: KEY, LLM_MODEL: 'deepseek-flash',
      LLM_FALLBACK_BASE_URL: 'https://api.anthropic.com', LLM_FALLBACK_API_KEY: KEY, LLM_FALLBACK_MODEL: 'claude-haiku-5-5' };
    expect(modelEnvFor(['--fallback'], env)).toMatchObject({ LLM_BASE_URL: 'https://api.anthropic.com', LLM_MODEL: 'claude-haiku-5-5' });
    expect(modelEnvFor([], env)).toBe(env);
    expect(modelEnvFor(['--fallback'], { LLM_MODEL: 'deepseek-flash' })).toBeNull();
    for (const f of ['tools/capability-sweep.mjs', 'tools/check-person-model.mjs', 'tools/check-language-release.mjs']) {
      expect(src(f), f).toContain('const modelEnv = modelEnvFor(process.argv, process.env);');
    }
  });
});

describe('0166 · failing over', () => {
  const PARAMS = { model: 'deepseek-flash', thinking: { type: 'disabled' }, max_tokens: 1200, messages: [{ role: 'user', content: 'hi' }] };
  const make = (p: ReturnType<typeof fake>, f: ReturnType<typeof fake>, on = true, b = breaker()) => {
    const logs: string[] = [];
    const client = failoverClient({
      primary: { provider: PRIMARY, client: p.client, name: 'DeepSeek' },
      fallback: { provider: FALLBACK, client: f.client, name: 'Anthropic' },
      on, breaker: b, log: (l) => logs.push(l),
    });
    const call = () => (client.messages.create as unknown as (p: unknown, o: unknown) => Promise<unknown>)(PARAMS, { timeout: 30_000, maxRetries: 1 });
    return { client, call, logs, b };
  };

  it('switched off: exactly the primary\'s client, and the fallback is never asked', async () => {
    const p = fake(() => { throw timeout(); });
    const f = fake(() => ({ id: 'fb' }));
    const { client } = make(p, f, false);
    expect(client).toBe(p.client);
  });
  it('the primary answers: it is asked once, with no retries (the fallback is the retry), and the fallback not at all', async () => {
    const p = fake(() => ({ id: 'primary' }));
    const f = fake(() => ({ id: 'fb' }));
    const { call } = make(p, f);
    await expect(call()).resolves.toEqual({ id: 'primary' });
    expect(p.asked[0]!.options).toEqual({ timeout: 30_000, maxRetries: 0 });
    expect(f.asked).toHaveLength(0);
  });
  it('the primary times out: the fallback answers with its OWN model, it is logged, and the next calls skip the primary for two minutes', async () => {
    let t = 0;
    const b = breaker(120_000, () => t);
    const p = fake(() => { throw timeout(); });
    const f = fake(() => ({ id: 'fb' }));
    const { call, logs } = make(p, f, true, b);
    await expect(call()).resolves.toEqual({ id: 'fb' });
    expect(f.asked[0]!.params).toMatchObject({ model: 'claude-haiku-5-5', thinking: { type: 'disabled' }, max_tokens: 1200 });
    expect(f.asked[0]!.options).toEqual({ timeout: 30_000, maxRetries: 1 });
    expect(logs).toEqual(['[model] DeepSeek did not answer (timeout): failing over to Anthropic for 2 minutes']);
    t += 60_000;
    await call();
    expect(p.asked).toHaveLength(1);                // skipped while the breaker is open
    expect(f.asked).toHaveLength(2);
    t += 61_000;
    p.client.messages.create = (async () => ({ id: 'primary' })) as never;
    await expect(call()).resolves.toEqual({ id: 'primary' });
    expect(b.isOpen()).toBe(false);
  });
  it('a refusal, an overload, a dead key, a server error fail over too; a 400 does not (it was our request)', async () => {
    for (const s of [402, 503, 401, 500]) {
      const p = fake(() => { throw status(s); });
      const f = fake(() => ({ id: 'fb' }));
      await expect(make(p, f).call(), String(s)).resolves.toEqual({ id: 'fb' });
    }
    const p = fake(() => { throw status(400); });
    const f = fake(() => ({ id: 'fb' }));
    await expect(make(p, f).call()).rejects.toThrow('HTTP 400');
    expect(f.asked).toHaveLength(0);
  });
  it('neither answers: the caller gets the error, as before, and the log says both', async () => {
    const p = fake(() => { throw timeout(); });
    const f = fake(() => { throw status(529); });
    const { call, logs } = make(p, f);
    await expect(call()).rejects.toThrow('HTTP 529');
    expect(logs[1]).toBe('[model] the fallback Anthropic did not answer either (overloaded)');
  });
});

describe('0166 · who writes replies now, and where it is said', () => {
  it('the primary while it answers; the fallback only when switched on and answering; nobody otherwise', () => {
    expect(servingOf('answering', 'off', false)).toBe('primary');
    expect(servingOf('slow', 'answering', true)).toBe('primary');
    expect(servingOf('not_answering', 'answering', true)).toBe('fallback');
    expect(servingOf('refusing', 'slow', true)).toBe('fallback');
    expect(servingOf('not_answering', 'answering', false)).toBe('none');
    expect(servingOf('not_answering', 'not_answering', true)).toBe('none');
    expect(servingOf('unknown', 'off', false)).toBe('none');
  });
  it('/health says it, the heartbeat fails only when nobody writes, every client the app builds fails over', () => {
    const main = src('src/main.ts');
    expect(main).toContain('fallback: view.fallback, fallback_on: view.fallbackOn, serving: view.serving,');
    expect(main).not.toMatch(/llmClient\(/);
    expect(src('src/worker/heartbeat.ts')).toContain(": o.model ? { probeModel: async () => (await readModelView(o.db, o.model!)).serving !== 'none' } : {}),");
    expect(src('src/worker/main.ts')).toContain('const anthropic = modelClient((a) => watchOf?.observe(a));');
  });
  it('the privacy page names the fallback only while failing over to it is on — in every language', () => {
    const facts = { processor: { name: 'DeepSeek', country: 'CN' }, hosting: HOSTING };
    for (const l of ['en', 'zh', 'ar', 'es', 'fr'] as const) {
      expect(renderPrivacy(l, null, facts), l).not.toContain('Anthropic');
      expect(renderPrivacy(l, null, { ...facts, fallback: { name: 'Anthropic', country: 'US' } }), l).toContain('Anthropic');
    }
  });
});

describe('0166 · how reliable it was', () => {
  it('the share of each state, the median latency, the longest outage and why', () => {
    const at = (m: number) => new Date(Date.parse('2026-10-15T00:00:00Z') + m * 60_000);
    const rows = [
      { state: 'answering', ms: 800, reason: null, at: at(0) },
      { state: 'not_answering', ms: null, reason: 'timeout', at: at(5) },
      { state: 'not_answering', ms: null, reason: 'timeout', at: at(10) },
      { state: 'not_answering', ms: 300, reason: 'overloaded', at: at(15) },
      { state: 'slow', ms: 6000, reason: null, at: at(20) },
    ];
    expect(uptime(rows)).toMatchObject({
      checks: 5, answering: 20, slow: 20, notAnswering: 60, medianMs: 800,
      longestOutageMinutes: 15, longestOutageFrom: at(5), reasons: { timeout: 2, overloaded: 1 },
    });
  });
});
