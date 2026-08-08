import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { metaAdapter, metaMediaFetcher, META_GRAPH_BASE } from '../../src/channels/whatsapp/meta.js';
import { whatsappAdapter } from '../../src/channels/whatsapp/adapter.js';
import { signBody } from '../../src/channels/whatsapp/signature.js';
import { MAX_MEDIA_BYTES } from '../../src/channels/whatsapp/media.js';
import { buildIngressApp } from '../../src/api/ingress.js';
import { validateEnv, ensureGeneratedSecrets } from '../../src/main.js';
import type { ChannelEvent } from '../../src/channels/whatsapp/parse.js';

const META = {
  accessToken: 'meta-test-token-not-real-abcdef',
  phoneNumberId: '123456789012345',
  appSecret: 'meta-app-secret-not-real',
  graphVersion: 'v23.0',
} as const;

/* ── Outbound: Graph URL, Bearer auth, same classification ───────────────── */
describe('meta adapter · outbound send', () => {
  const capture = () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const adapter = metaAdapter({ ...META, fetchImpl: async (url, init) => {
      calls.push({ url, headers: init.headers });
      return { status: 200, text: async () => '{"messages":[{"id":"wamid.META1"}]}' };
    } });
    return { calls, adapter };
  };

  it('posts to graph.facebook.com/{version}/{phoneNumberId}/messages with Bearer auth', async () => {
    const { calls, adapter } = capture();
    const r = await adapter.sendText('971500000000', 'hello');
    expect(r).toEqual({ ok: true, providerMessageId: 'wamid.META1' });
    expect(calls[0]!.url).toBe(`${META_GRAPH_BASE}/v23.0/123456789012345/messages`);
    expect(calls[0]!.headers['Authorization']).toBe(`Bearer ${META.accessToken}`);
    expect(calls[0]!.headers['D360-API-KEY']).toBeUndefined();   // no BSP header leakage
    expect(adapter.provider).toBe('meta');
  });

  it('retry classification and timeout behavior are the shared ones', async () => {
    const mk = (status: number) => metaAdapter({ ...META,
      fetchImpl: async () => ({ status, text: async () => 'err' }) });
    expect(await mk(429).sendText('1', 'x')).toMatchObject({ ok: false, retryable: true });
    expect(await mk(500).sendText('1', 'x')).toMatchObject({ ok: false, retryable: true });
    expect(await mk(401).sendText('1', 'x')).toMatchObject({ ok: false, retryable: false });

    let sawSignal: AbortSignal | undefined;
    const hung = metaAdapter({ ...META, fetchImpl: async (_u, init) => {
      sawSignal = init.signal;
      throw new DOMException('timeout', 'TimeoutError');
    } });
    expect(await hung.sendText('1', 'x')).toMatchObject({ ok: false, retryable: true });
    expect(sawSignal).toBeInstanceOf(AbortSignal);
  });
});

/* ── Webhook security: App Secret signatures + normalization reuse ───────── */
describe('meta adapter · webhook verification and normalization', () => {
  const TEST_NOW = new Date('2026-07-19T02:00:00Z');
  const fresh = String(Math.floor(TEST_NOW.getTime() / 1000) - 60);   // one minute old
  const metaInbound = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '15550001111', phone_number_id: META.phoneNumberId },
      contacts: [{ profile: { name: 'Pilot Owner' }, wa_id: '971500000000' }],
      messages: [{ from: '971500000000', id: 'wamid.META_IN1', timestamp: fresh,
        type: 'text', text: { body: 'hello from meta' } }],
    } }] }],
  });

  it('verifies X-Hub-Signature-256 with the APP SECRET (timing-safe, raw body)', () => {
    const adapter = metaAdapter(META);
    const sig = signBody(metaInbound, META.appSecret);
    expect(adapter.verifyWebhook(metaInbound, sig)).toBe(true);
    expect(adapter.verifyWebhook(metaInbound.replace('hello', 'hacked'), sig)).toBe(false);
    expect(adapter.verifyWebhook(metaInbound, signBody(metaInbound, 'wrong-secret'))).toBe(false);
  });

  it('normalizes into the existing event model: wamid + wamid#status dedup keys', () => {
    const adapter = metaAdapter(META);
    const events = adapter.parseWebhook(JSON.parse(metaInbound));
    expect(events[0]).toMatchObject({
      kind: 'message', eventId: 'wamid.META_IN1', dedupKey: 'wamid.META_IN1',
      phoneNumberId: META.phoneNumberId, text: 'hello from meta',
    });

    const statuses = adapter.parseWebhook({
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: META.phoneNumberId },
        statuses: [
          { id: 'wamid.META_OUT1', status: 'delivered', timestamp: '1752710500' },
          { id: 'wamid.META_OUT1', status: 'read', timestamp: '1752710510' },
        ],
      } }] }],
    });
    expect(statuses.map((s) => s.dedupKey)).toEqual(['wamid.META_OUT1#delivered', 'wamid.META_OUT1#read']);
  });

  it('flows through the real ingress: GET challenge + signed POST + dedup', async () => {
    const adapter = metaAdapter(META);
    const seen = new Set<string>();
    const delivered: ChannelEvent[] = [];
    const app = buildIngressApp({
      adapter, verifyToken: 'meta-verify-token',
      persistEvent: async (e) => (seen.has(e.dedupKey) ? 'duplicate' : (seen.add(e.dedupKey), 'new')),
      onNewEvent: async (e) => { delivered.push(e); },
      now: () => TEST_NOW,
    });

    const challenge = await app.inject({ method: 'GET',
      url: '/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=meta-verify-token&hub.challenge=meta-c1' });
    expect(challenge.statusCode).toBe(200);
    expect(challenge.body).toBe('meta-c1');

    const headers = { 'content-type': 'application/json', 'x-hub-signature-256': signBody(metaInbound, META.appSecret) };
    const first = await app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: metaInbound, headers });
    expect(first.json()).toEqual({ ok: true, received: 1 });
    const replay = await app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: metaInbound, headers });
    expect(replay.json()).toEqual({ ok: true, received: 0 });
  });
});

/* ── Media: Graph two-step, Bearer both hops, limits ─────────────────────── */
describe('meta adapter · media', () => {
  const fetcher = (bytes: number, mime = 'image/jpeg') => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const f = metaMediaFetcher({ ...META, fetchImpl: (async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, headers: init.headers });
      if (url.includes('/media_')) {
        return { status: 200, text: async () => JSON.stringify({ url: 'https://lookaside.test/bin', mime_type: mime }) };
      }
      return { status: 200, text: async () => '',
        arrayBuffer: async () => new ArrayBuffer(bytes) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any });
    return { calls, f };
  };

  it('two-step retrieval from the Graph root with Bearer on BOTH hops, no token in URLs', async () => {
    const { calls, f } = fetcher(3);
    const r = await f('media_123');
    expect(r.ok).toBe(true);
    expect(calls[0]!.url).toBe(`${META_GRAPH_BASE}/v23.0/media_123`);
    for (const c of calls) {
      expect(c.headers['Authorization']).toBe(`Bearer ${META.accessToken}`);
      expect(c.url).not.toContain(META.accessToken);
    }
  });

  it('size limit and unsupported types are permanent failures', async () => {
    expect(await fetcher(MAX_MEDIA_BYTES + 1).f('media_big'))
      .toMatchObject({ ok: false, retryable: false });
    expect(await fetcher(10, 'video/mp4').f('media_vid'))
      .toMatchObject({ ok: false, retryable: false });
  });
});

/* ── Provider selection: explicit, exclusive, no silent fallback ─────────── */
describe('provider selection (validateEnv)', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@h/db',
    ANTHROPIC_API_KEY: 'sk-ant-not-real-shape-ok-xx',
    WEBHOOK_VERIFY_TOKEN: 'verify-token-16chars',
    CREDENTIAL_KEY: 'a'.repeat(64),
  };
  const metaVars = {
    META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok',
    META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
    META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321012345',
    META_APP_SECRET: 'meta-app-secret-xx',
  };
  const d360Vars = {
    D360_API_KEY: 'd360-key-x', D360_BASE_URL: 'https://waba-sandbox.360dialog.io',
    WEBHOOK_SECRET: 'w'.repeat(32),
  };

  it('meta mode requires META_* and NOT D360 variables', () => {
    const v = validateEnv({ WHATSAPP_PROVIDER: 'meta', ...base, ...metaVars });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.cfg.provider).toBe('meta');
      expect(v.cfg.META_GRAPH_API_VERSION).toBe('v23.0');   // default applied
    }
    const missing = validateEnv({ WHATSAPP_PROVIDER: 'meta', ...base });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.problems.join()).toContain('META_WHATSAPP_ACCESS_TOKEN');
      expect(missing.problems.join()).not.toContain('D360');
    }
  });

  it('360dialog mode requires D360_* and NOT Meta variables', () => {
    const v = validateEnv({ WHATSAPP_PROVIDER: '360dialog', ...base, ...d360Vars });
    expect(v.ok).toBe(true);
    const missing = validateEnv({ WHATSAPP_PROVIDER: '360dialog', ...base });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.problems.join()).toContain('D360_API_KEY');
      expect(missing.problems.join()).not.toContain('META_');
    }
  });

  it('an unknown provider is a hard failure — no silent fallback', () => {
    for (const p of ['twilio', 'META', 'sms']) {
      const v = validateEnv({ WHATSAPP_PROVIDER: p, ...base, ...metaVars, ...d360Vars });
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.problems.join()).toContain('WHATSAPP_PROVIDER');
    }
  });

  it('deployment mode: WHATSAPP_PROVIDER=disabled (or unset) requires no provider creds', () => {
    const disabled = validateEnv({ WHATSAPP_PROVIDER: 'disabled', ...base });
    expect(disabled.ok).toBe(true);
    if (disabled.ok) expect(disabled.cfg.provider).toBe('disabled');

    const unset = validateEnv({ ...base });   // no WHATSAPP_PROVIDER at all
    expect(unset.ok).toBe(true);
    if (unset.ok) expect(unset.cfg.provider).toBe('disabled');

    // Anthropic + DATABASE_URL stay required even in deployment mode.
    const noDb = validateEnv({ WHATSAPP_PROVIDER: 'disabled', ...base, DATABASE_URL: undefined });
    expect(noDb.ok).toBe(false);
    if (!noDb.ok) expect(noDb.problems.join()).toContain('DATABASE_URL');
    const noLlm = validateEnv({ WHATSAPP_PROVIDER: 'disabled', ...base, ANTHROPIC_API_KEY: undefined });
    expect(noLlm.ok).toBe(false);
    if (!noLlm.ok) expect(noLlm.problems.join()).toContain('ANTHROPIC_API_KEY');
  });

  it('M10.1 fail-closed output names the variable but never echoes a secret VALUE', () => {
    // validateEnv's problems are console.error'd on boot — they must never leak a
    // value. Feed distinctive but invalid secrets and confirm only names surface.
    const v = validateEnv({
      ...base,
      DATABASE_URL: 'mysql://LEAKDB', // wrong shape (not postgres)
      ANTHROPIC_API_KEY: 'sk-LEAKKEY', // too short → invalid shape
      CREDENTIAL_KEY: 'LEAKCREDNOTHEX', // not 64-hex → invalid shape
      WEBHOOK_VERIFY_TOKEN: 'LEAKTOKEN', // <16 → invalid shape
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      const out = v.problems.join('\n');
      expect(out).toContain('DATABASE_URL');
      expect(out).toContain('CREDENTIAL_KEY');
      for (const secret of ['LEAKDB', 'LEAKKEY', 'LEAKCRED', 'LEAKTOKEN', 'sk-']) {
        expect(out, secret).not.toContain(secret);
      }
    }
  });

  it('360dialog compatibility: default adapter still sends the D360 header', async () => {
    let headers: Record<string, string> = {};
    const a = whatsappAdapter({ baseUrl: 'https://x', apiKey: 'd360-key', webhookSecret: 's'.repeat(32),
      fetchImpl: async (_u, init) => { headers = init.headers; return { status: 200, text: async () => '{"messages":[{"id":"w1"}]}' }; } });
    await a.sendText('1', 'x');
    expect(headers['D360-API-KEY']).toBe('d360-key');
    expect(headers['Authorization']).toBeUndefined();
  });
});

/* ── Automatic secret generation ─────────────────────────────────────────── */
describe('internal secret generation', () => {
  // A fresh path per test, under the OS temp directory. This was an absolute
  // macOS scratchpad path, so it existed on exactly one machine and both tests
  // here failed with ENOENT anywhere else — including any CI runner. The uuid
  // also stops two concurrent runs from sharing one file.
  let TMP = '';
  const NAMES = ['WEBHOOK_SECRET', 'WEBHOOK_VERIFY_TOKEN', 'CREDENTIAL_KEY'] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => { TMP = join(tmpdir(), `yiwuflow-test-${randomUUID()}.env`); });

  afterEach(() => {
    for (const n of NAMES) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
    rmSync(TMP, { force: true });
  });

  it('generates missing secrets with correct entropy shape; never overwrites', () => {
    for (const n of NAMES) { saved[n] = process.env[n]; delete process.env[n]; }
    process.env['CREDENTIAL_KEY'] = 'f'.repeat(64);           // pre-existing → untouched
    rmSync(TMP, { force: true });

    const generated = ensureGeneratedSecrets(TMP);
    expect(generated.sort()).toEqual(['WEBHOOK_SECRET', 'WEBHOOK_VERIFY_TOKEN']);
    expect(process.env['WEBHOOK_SECRET']).toMatch(/^[0-9a-f]{64}$/);   // 32 bytes hex
    expect(process.env['WEBHOOK_VERIFY_TOKEN']).toMatch(/^[0-9a-f]{32}$/); // 16 bytes hex
    expect(process.env['CREDENTIAL_KEY']).toBe('f'.repeat(64));        // preserved

    const file = readFileSync(TMP, 'utf8');
    expect(file).toContain('WEBHOOK_SECRET=');
    expect(file).not.toContain('CREDENTIAL_KEY=');                     // existing not rewritten
    expect(process.env['WEBHOOK_SECRET']).not.toBe(process.env['WEBHOOK_VERIFY_TOKEN']);

    // Second run: nothing regenerated, file untouched.
    expect(ensureGeneratedSecrets(TMP)).toEqual([]);
    expect(readFileSync(TMP, 'utf8')).toBe(file);
  });

  it('appends to an existing .env without touching other lines', () => {
    for (const n of NAMES) { saved[n] = process.env[n]; delete process.env[n]; }
    writeFileSync(TMP, 'WHATSAPP_PROVIDER=meta\n');
    ensureGeneratedSecrets(TMP);
    const file = readFileSync(TMP, 'utf8');
    expect(file.startsWith('WHATSAPP_PROVIDER=meta\n')).toBe(true);
    expect(existsSync(TMP)).toBe(true);
  });
});
