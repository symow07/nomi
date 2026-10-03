import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import Anthropic from '@anthropic-ai/sdk';
import { llmClient, type LlmProvider } from '../../src/llm/provider.js';
import { classifyProviderFailure } from '../../src/llm/providerFailure.js';

/**
 * BILLING RESILIENCE (2026-10-04) — no request to the provider hangs for ever,
 * proved against a stub HTTP server on this machine (nothing leaves it).
 *
 *   · THE STALL: headers at once, then a body that never comes — empty lines
 *     every 150 ms, as DeepSeek documents for a request that waits ("Non-
 *     streaming requests: continuously return empty lines",
 *     api-docs.deepseek.com/quick_start/rate_limit). The SDK alone does NOT
 *     time this out: its timer is cleared once the headers arrive, and the
 *     newlines keep Node's idle-body limit from firing. Through `llmClient`
 *     the SDK's own timeout covers the whole answer, and it fails as a
 *     timeout. Both halves are asserted, so the test also shows why the
 *     wrapper exists.
 *   · THE REFUSAL: HTTP 402 with DeepSeek's words fails at once, is not
 *     retried by the SDK, reads as billing, and the observer sees it.
 */

const body402 = JSON.stringify({ error: { message: 'Insufficient Balance', type: 'unknown_error', param: null, code: 'invalid_request_error' } });
const message = JSON.stringify({
  id: 'msg_stub', type: 'message', role: 'assistant', model: 'deepseek-flash',
  content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', stop_sequence: null,
  usage: { input_tokens: 5, output_tokens: 1 },
});

type Mode = 'refuse' | 'stall' | 'slow' | 'ok';
let mode: Mode = 'ok';
let hits = 0;
let server: Server;
let base = '';
const open = new Set<ServerResponse>();

beforeAll(async () => {
  server = createServer((req, res) => {
    hits++;
    req.resume();
    req.on('end', () => {
      if (mode === 'refuse') { res.writeHead(402, { 'content-type': 'application/json' }); res.end(body402); return; }
      if (mode === 'ok') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(message); return; }
      if (mode === 'slow') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write(message.slice(0, 40));
        setTimeout(() => res.end(message.slice(40)), 300);
        return;
      }
      // stall: the headers, then empty lines, never the body
      open.add(res);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('\n');
      const beat = setInterval(() => { if (!res.writableEnded) res.write('\n'); }, 150);
      res.on('close', () => { clearInterval(beat); open.delete(res); });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  for (const res of open) res.destroy();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

const provider = (): LlmProvider => ({ name: 'custom', apiKey: 'stub-key-not-real-0000', baseURL: base, model: 'deepseek-flash' });
const ask = { model: 'deepseek-flash', max_tokens: 8, messages: [{ role: 'user' as const, content: 'Reply with the word OK.' }] };

describe('a request that gets headers and then never a body', () => {
  it('the SDK alone waits past its own timeout (why the wrapper exists)', async () => {
    mode = 'stall';
    const plain = new Anthropic({ apiKey: 'stub-key-not-real-0000', baseURL: base });
    const stop = new AbortController();
    const call = plain.messages.create(ask, { timeout: 500, maxRetries: 0, signal: stop.signal })
      .then(() => 'answered', () => 'failed');
    const after = await Promise.race([call, new Promise<string>((r) => setTimeout(() => r('still waiting'), 2_500))]);
    expect(after).toBe('still waiting');      // five times its timeout, and no end
    stop.abort();
    expect(await call).toBe('failed');
  });

  it('through llmClient the SDK’s timeout covers the whole answer: it fails, as a timeout, on time', async () => {
    mode = 'stall';
    const client = llmClient(provider());
    const t0 = Date.now();
    const e = await client.messages.create(ask, { timeout: 800, maxRetries: 0 }).then(() => null, (x: unknown) => x);
    const took = Date.now() - t0;
    expect(e).toBeInstanceOf(Anthropic.APIConnectionTimeoutError);
    expect(classifyProviderFailure(e).kind).toBe('timeout');
    expect(took).toBeGreaterThanOrEqual(700);
    expect(took).toBeLessThan(2_500);
  });

  it('…and its retry is the SDK’s own, each attempt under the same limit', async () => {
    mode = 'stall';
    hits = 0;
    const client = llmClient(provider());
    const t0 = Date.now();
    const e = await client.messages.create(ask, { timeout: 600, maxRetries: 1 }).then(() => null, (x: unknown) => x);
    expect(classifyProviderFailure(e).kind).toBe('timeout');
    expect(hits).toBe(2);
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it('an answer that arrives slowly but whole is still read', async () => {
    mode = 'slow';
    const res = await llmClient(provider()).messages.create(ask, { timeout: 3_000, maxRetries: 0 });
    expect(res.content[0]).toEqual({ type: 'text', text: 'OK' });
  });
});

describe('a refusal for billing', () => {
  it('fails at once, is not retried, reads as billing, and the observer sees it', async () => {
    mode = 'refuse';
    hits = 0;
    const seen: { status: number; text: string }[] = [];
    const client = llmClient(provider(), { observe: (a) => seen.push(a) });
    const t0 = Date.now();
    const e = await client.messages.create(ask, { timeout: 5_000, maxRetries: 1 }).then(() => null, (x: unknown) => x);
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(hits).toBe(1);                                  // a 402 is not retried
    expect(classifyProviderFailure(e)).toEqual({ kind: 'billing', status: 402, words: 'Insufficient Balance' });
    expect(seen).toEqual([{ status: 402, text: body402 }]);
  });

  it('a success is seen too: that is how the end of an outage is noticed', async () => {
    mode = 'ok';
    const seen: number[] = [];
    const res = await llmClient(provider(), { observe: (a) => seen.push(a.status) }).messages.create(ask, { timeout: 3_000, maxRetries: 0 });
    expect(res.usage.output_tokens).toBe(1);
    expect(seen).toEqual([200]);
  });

  it('an observer that throws never fails the call', async () => {
    mode = 'ok';
    const res = await llmClient(provider(), { observe: () => { throw new Error('observer down'); } })
      .messages.create(ask, { timeout: 3_000, maxRetries: 0 });
    expect(res.content.length).toBe(1);
  });
});
