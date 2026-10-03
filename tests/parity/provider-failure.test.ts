import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { classifyProviderFailure, classifyProviderResponse, providerWords, PROVIDER_WORDS_MAX } from '../../src/llm/providerFailure.js';

/**
 * BILLING RESILIENCE (2026-10-04) — a refusal FOR MONEY told apart from every
 * other way a provider fails, with the documented bodies:
 *
 *   · DeepSeek, api-docs.deepseek.com/quick_start/error_codes: "402 —
 *     Insufficient Balance: You have run out of balance"; 429 Rate Limit
 *     Reached; 500 Server Error; 503 Server Overloaded; 401 Authentication
 *     Fails; 422 Invalid Parameters. The page gives no example bodies, and
 *     the Anthropic-compatible endpoint's page (guides/anthropic_api) says
 *     nothing about errors — so both body shapes a 402 can take are here,
 *     and the status alone decides.
 *   · Anthropic, platform.claude.com/docs/en/api/errors: 402 `billing_error`;
 *     429 `rate_limit_error`; 529 `overloaded_error`; 504 `timeout_error`;
 *     400 `invalid_request_error` (the prefill body is the page's own).
 *     …/api/rate-limits: a spend limit the operator set (400, "You have
 *     reached your specified API usage limits"), and the tier's monthly cap
 *     (429 with `details.error_code` "enforced_spend_limit_reached", the
 *     page's own body).
 *   · Anthropic's "credit balance is too low" — a 400 `invalid_request_error`
 *     whose words, not its status, say it is money.
 */

type Case = { readonly name: string; readonly status: number; readonly body: unknown; readonly kind: string };

const BILLING: readonly Case[] = [
  { name: 'DeepSeek 402 Insufficient Balance (OpenAI-format body)', status: 402,
    body: { error: { message: 'Insufficient Balance', type: 'unknown_error', param: null, code: 'invalid_request_error' } }, kind: 'billing' },
  { name: 'DeepSeek 402 at the Anthropic-format endpoint', status: 402,
    body: { type: 'error', error: { type: 'invalid_request_error', message: 'Insufficient Balance' } }, kind: 'billing' },
  { name: 'a 402 with no body at all', status: 402, body: '', kind: 'billing' },
  { name: 'Anthropic 402 billing_error', status: 402,
    body: { type: 'error', error: { type: 'billing_error', message: 'There’s an issue with your billing or payment information.' } }, kind: 'billing' },
  { name: 'Anthropic 400 credit balance too low', status: 400,
    body: { type: 'error', error: { type: 'invalid_request_error',
      message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } }, kind: 'billing' },
  { name: 'Anthropic 400 — a spend limit the operator set', status: 400,
    body: { type: 'error', error: { type: 'invalid_request_error',
      message: 'You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.' } }, kind: 'billing' },
  { name: 'Anthropic 400 — a workspace spend limit', status: 400,
    body: { type: 'error', error: { type: 'invalid_request_error',
      message: 'You have reached your specified workspace API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.' } }, kind: 'billing' },
  { name: 'Anthropic 429 — the tier’s monthly spend cap (the page’s own body)', status: 429,
    body: { type: 'error', error: { type: 'rate_limit_error',
      message: 'You have reached your API usage limits: your organization has crossed its monthly API usage threshold, set based on your organization\'s API tier. You will regain access on 2026-09-01 at 00:00 UTC.',
      details: { error_code: 'enforced_spend_limit_reached' } }, request_id: 'req_018EeWyXxfu5pfWkrYcMdjWG' }, kind: 'billing' },
  { name: 'Insufficient Balance said with another status (a proxy in between)', status: 400,
    body: { error: { message: 'Insufficient Balance' } }, kind: 'billing' },
];

const NOT_BILLING: readonly Case[] = [
  { name: 'Anthropic 429 — an ordinary rate limit', status: 429,
    body: { type: 'error', error: { type: 'rate_limit_error', message: 'Number of request tokens has exceeded your per-minute rate limit' } }, kind: 'rate_limited' },
  { name: 'DeepSeek 429 Rate Limit Reached', status: 429, body: { error: { message: 'Rate Limit Reached' } }, kind: 'rate_limited' },
  { name: 'Anthropic 529 overloaded', status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, kind: 'overloaded' },
  { name: 'DeepSeek 503 Server Overloaded', status: 503, body: { error: { message: 'Server Overloaded' } }, kind: 'overloaded' },
  { name: 'DeepSeek 500 Server Error', status: 500, body: { error: { message: 'Server Error' } }, kind: 'server' },
  { name: 'Anthropic 504 timeout_error', status: 504, body: { type: 'error', error: { type: 'timeout_error', message: 'Request timed out' } }, kind: 'timeout' },
  { name: 'Anthropic 400 — prefill not supported (the page’s own body)', status: 400,
    body: { type: 'error', error: { type: 'invalid_request_error',
      message: 'This model does not support assistant message prefill. The conversation must end with a user message.' } }, kind: 'other' },
  { name: 'DeepSeek 422 Invalid Parameters', status: 422, body: { error: { message: 'Invalid Parameters' } }, kind: 'other' },
  { name: 'DeepSeek 401 Authentication Fails', status: 401, body: { error: { message: 'Authentication Fails' } }, kind: 'auth' },
  { name: 'Anthropic 403 permission_error', status: 403, body: { type: 'error', error: { type: 'permission_error', message: 'nope' } }, kind: 'auth' },
  // A body that merely mentions a balance is not a billing refusal.
  { name: 'a 400 that mentions "balance" in another sense', status: 400,
    body: { type: 'error', error: { type: 'invalid_request_error', message: 'balance_tokens: Extra inputs are not permitted' } }, kind: 'other' },
  { name: 'a 429 that says "usage limits" without the spend-cap code', status: 429,
    body: { type: 'error', error: { type: 'rate_limit_error', message: 'You have reached your API usage limits for this minute' } }, kind: 'rate_limited' },
];

describe('a provider’s answer — billing, or not', () => {
  for (const c of [...BILLING, ...NOT_BILLING]) {
    it(`${c.name} → ${c.kind}`, () => {
      expect(classifyProviderResponse(c.status, c.body)?.kind).toBe(c.kind);
    });
  }

  it('a success is no failure at all', () => {
    expect(classifyProviderResponse(200, { content: [] })).toBeNull();
    expect(classifyProviderResponse(204, '')).toBeNull();
  });

  it('a billing refusal keeps the provider’s own words, on one line and cut', () => {
    const r = classifyProviderResponse(402, { error: { message: 'Insufficient Balance' } });
    expect(r).toEqual({ kind: 'billing', status: 402, words: 'Insufficient Balance' });
    const long = classifyProviderResponse(402, { error: { message: `line one\nline two ${'x'.repeat(400)}` } });
    expect(long?.kind === 'billing' && long.words.includes('\n')).toBe(false);
    expect(long?.kind === 'billing' && long.words.length).toBe(PROVIDER_WORDS_MAX);
    expect(providerWords('  a\u0000b\tc  ')).toBe('a b c');
  });
});

describe('a thrown error — the SDK’s own, read the same way', () => {
  const headers = new Headers({ 'content-type': 'application/json' });
  const thrown = (status: number, body: unknown) => Anthropic.APIError.generate(status, body as object, undefined, headers);

  for (const c of [...BILLING, ...NOT_BILLING]) {
    it(`SDK ${c.status}: ${c.name} → ${c.kind}`, () => {
      // A body the SDK could not parse arrives as its message instead.
      const e = typeof c.body === 'string'
        ? Anthropic.APIError.generate(c.status, undefined, c.body || `${c.status} status code (no body)`, headers)
        : thrown(c.status, c.body);
      expect(classifyProviderFailure(e).kind).toBe(c.kind);
    });
  }

  it('the SDK’s own timeout, an abort and the platform’s timeout are timeouts', () => {
    expect(classifyProviderFailure(new Anthropic.APIConnectionTimeoutError()).kind).toBe('timeout');
    expect(classifyProviderFailure(new DOMException('The operation was aborted.', 'AbortError')).kind).toBe('timeout');
    expect(classifyProviderFailure(new DOMException('The operation timed out.', 'TimeoutError')).kind).toBe('timeout');
  });

  it('a connection error, a plain error, and not-an-error are other — never billing', () => {
    expect(classifyProviderFailure(new Anthropic.APIConnectionError({ message: 'Connection error.' })).kind).toBe('other');
    expect(classifyProviderFailure(new Error('relation "turns" does not exist')).kind).toBe('other');
    expect(classifyProviderFailure('boom').kind).toBe('other');
    expect(classifyProviderFailure(null).kind).toBe('other');
  });
});
