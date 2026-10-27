import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CHECK_FRESH_MS, CALL_SLOW_MS, PROBE_SLOW_MS, healthOfModel, modelServes, reasonOf, stateOf, type ModelCheckRow,
} from '../../src/core/ops/modelHealth.js';
import { llmClient, type LlmProvider } from '../../src/llm/provider.js';
import type { CallOutcome } from '../../src/core/ops/modelHealth.js';

/**
 * 0165 — the model's health is what a real call said (the owner, 2026-10-15: "/health reported 'answering' while
 * every single call failed… it must make a real call and report what actually happened"). The record and the check
 * over Postgres: tests/integration/model-health.test.ts.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-15T10:00:00Z');
const row = (o: Partial<ModelCheckRow>): ModelCheckRow => ({
  role: 'primary', provider: 'DeepSeek', model: 'deepseek-flash', state: 'answering', ms: 800, reason: null,
  checkedAt: new Date(NOW.getTime() - 60_000), lastAnswerAt: null, ...o,
});

describe('0165 · the rules', () => {
  it('a call that answered is answering, or slow past its line; the check\'s line is lower than a real call\'s', () => {
    expect(stateOf({ ok: true, ms: 900 }, PROBE_SLOW_MS)).toBe('answering');
    expect(stateOf({ ok: true, ms: PROBE_SLOW_MS }, PROBE_SLOW_MS)).toBe('slow');
    expect(stateOf({ ok: true, ms: 12_000 }, CALL_SLOW_MS)).toBe('answering');
    expect(stateOf({ ok: true, ms: 25_000 }, CALL_SLOW_MS)).toBe('slow');
  });
  it('a timeout, an overload, a refusal, a dead key, a server error, no connection: not answering — with why', () => {
    const cases: [CallOutcome, string][] = [
      [{ ok: false, ms: 30_000, failure: 'timeout', status: null }, 'timeout'],
      [{ ok: false, ms: 300, failure: 'overloaded', status: 503 }, 'overloaded'],
      [{ ok: false, ms: 300, failure: 'billing', status: 402 }, 'billing'],
      [{ ok: false, ms: 300, failure: 'auth', status: 401 }, 'auth'],
      [{ ok: false, ms: 300, failure: 'rate_limited', status: 429 }, 'rate_limited'],
      [{ ok: false, ms: 300, failure: 'server', status: 500 }, 'server'],
      [{ ok: false, ms: 10, failure: 'other', status: null }, 'no_connection'],
    ];
    for (const [o, why] of cases) {
      expect(stateOf(o, PROBE_SLOW_MS), why).toBe('not_answering');
      expect(reasonOf(o)).toBe(why);
    }
  });
  it('a 400 was our request, not the provider: it says nothing about the model', () => {
    expect(stateOf({ ok: false, ms: 200, failure: 'other', status: 400 }, CALL_SLOW_MS)).toBeNull();
  });
  it('/health: refusing wins; a fresh row says what it said; a stale one or none says unknown — never answering', () => {
    expect(healthOfModel(row({ state: 'answering' }), true, NOW)).toBe('refusing');
    expect(healthOfModel(row({ state: 'not_answering' }), false, NOW)).toBe('not_answering');
    expect(healthOfModel(row({ state: 'slow' }), false, NOW)).toBe('slow');
    expect(healthOfModel(row({ checkedAt: new Date(NOW.getTime() - CHECK_FRESH_MS - 1) }), false, NOW)).toBe('unknown');
    expect(healthOfModel(null, false, NOW)).toBe('unknown');
  });
  it('a reply can be written only while it answers, slowly or not', () => {
    expect(modelServes('answering')).toBe(true);
    expect(modelServes('slow')).toBe(true);
    for (const v of ['not_answering', 'refusing', 'unknown'] as const) expect(modelServes(v), v).toBe(false);
  });
});

describe('0165 · every model call is timed, and the caller gets exactly what it got before', () => {
  const PROVIDER: LlmProvider = { name: 'custom', apiKey: 'k'.repeat(24), baseURL: 'https://model.test', model: 'm-1' };
  const message = { id: 'msg_1', type: 'message', role: 'assistant', model: 'm-1', content: [{ type: 'text', text: 'OK' }],
    stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } };
  const ask = (c: ReturnType<typeof llmClient>) => c.messages.create(
    { model: 'm-1', max_tokens: 8, messages: [{ role: 'user', content: 'Reply with the word OK.' }] }, { maxRetries: 0, timeout: 200 });

  it('an answer: the message is returned unchanged, and the call is told as answered', async () => {
    const told: CallOutcome[] = [];
    const c = llmClient(PROVIDER, { fetch: async () => new Response(JSON.stringify(message), { status: 200, headers: { 'content-type': 'application/json' } }), onCall: (o) => told.push(o) });
    const res = await ask(c);
    expect(res.content).toEqual([{ type: 'text', text: 'OK' }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ ok: true });
  });
  it('a timeout and an overload: the caller still gets the error, and the call is told as not answered, with why', async () => {
    const told: CallOutcome[] = [];
    const hang = llmClient(PROVIDER, { fetch: (_u, init) => new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }), onCall: (o) => told.push(o) });
    await expect(ask(hang)).rejects.toThrow();
    const busy = llmClient(PROVIDER, { fetch: async () => new Response(JSON.stringify({ error: { type: 'overloaded_error', message: 'Service is too busy' } }), { status: 503, headers: { 'content-type': 'application/json' } }), onCall: (o) => told.push(o) });
    await expect(ask(busy)).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(told.map((o) => (o.ok ? 'ok' : o.failure))).toEqual(['timeout', 'overloaded']);
  });
  it('a listener that throws never reaches the call', async () => {
    const c = llmClient(PROVIDER, { fetch: async () => new Response(JSON.stringify(message), { status: 200, headers: { 'content-type': 'application/json' } }), onCall: () => { throw new Error('no'); } });
    await expect(ask(c)).resolves.toMatchObject({ id: 'msg_1' });
  });
});

describe('0165 · wired where it is read', () => {
  it('/health and the heartbeat read the same record; /health no longer reads billing alone', () => {
    const main = src('src/main.ts');
    expect(main).toContain('try { view = await readModelView(db, primaryModel); } catch { /* unknown */ }');
    expect(main).not.toMatch(/model = \(await providerRefusing\(db\)\) \? 'refusing' : 'answering'/);
    // 0166 — the heartbeat fails when nobody writes replies (`serving`), the fallback counted when it is on.
    expect(src('src/worker/heartbeat.ts')).toContain(": o.model ? { probeModel: async () => (await readModelView(o.db, o.model!)).serving !== 'none' } : {}),");
    expect(src('src/main.ts')).toContain('db: prod.db, model: prod.primaryModel, alarms: prod.alarms });');
  });
  it('the check runs every five minutes and once at boot; every client the app builds is timed', () => {
    const main = src('src/main.ts');
    expect(main).toContain("await boss.work(QUEUES.provider, async () => { await health.check(); await watch.sweep(); });");
    expect(main).toContain('void health.check();');
    expect(main).not.toMatch(/llmClient\(llm, \{ observe: watch\.observe \}\)/);
    // 0166 — through the worker's factory, which times each provider's calls.
    expect(src('src/worker/main.ts')).toContain("client: llmClient(llm, { ...(observe ? { observe } : {}), onCall: health.callsOf('primary') }) },");
  });
});
