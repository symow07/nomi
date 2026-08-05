import { describe, it, expect } from 'vitest';

/** The simulator's default instance tag (M22): wamids are `SIM_OUT_<tag>_<n>`. */
const SIM_TAG = '1';
import {
  driveConversationOutbound,
  type OutboundStore, type OutboundWorkRow, type ConversationSendContext,
} from '../../src/outbound/worker.js';
import { whatsappSimulator, SIMULATOR_SECRET, type SendBehavior } from '../../src/channels/whatsapp/simulator.js';
import { buildIngressApp } from '../../src/api/ingress.js';
import { runTestConnection } from '../../src/channels/testflow.js';
import { applyStatus } from '../../src/core/channel/delivery.js';
import { verifySignature, signBody, isStaleEvent } from '../../src/channels/whatsapp/signature.js';
import {
  deriveKey, encryptSecret, decryptSecret, credentialFingerprint, redactSecrets,
} from '../../src/security/credentials.js';
import type { ChannelEvent } from '../../src/channels/whatsapp/parse.js';

const NOW = new Date('2026-07-18T02:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000);

/* ── In-memory OutboundStore mirroring the DB store's semantics ──────────── */
type Row = { -readonly [K in keyof OutboundWorkRow]: OutboundWorkRow[K] } &
  { nextRetryAt: number | null; deadLettered: boolean };

function memStore(initial: readonly Partial<Row>[], ctx: Partial<ConversationSendContext> = {}) {
  const rows: Row[] = initial.map((r, i) => ({
    id: r.id ?? `m${i + 1}`, seq: r.seq ?? i + 1, status: r.status ?? 'queued',
    requiresOrder: r.requiresOrder ?? true, attempts: r.attempts ?? 0,
    sentAt: r.sentAt ?? null, to: r.to ?? '971500000001', body: r.body ?? 'hello',
    origin: r.origin ?? 'employee', sendingSince: r.sendingSince ?? null,
    nextRetryAt: null, deadLettered: false,
  }));
  const transitions: string[] = [];
  const context: ConversationSendContext = {
    assignedTo: null, paused: false, lastInboundAt: hoursAgo(1), template: 'none',
    // These M3 tests predate the pilot controls and exercise window/retry/
    // ordering. The gate is fail-closed (M18.2, M20.1), so a store supplying no
    // pilot context blocks everything — state the live conditions explicitly.
    pilotMode: false,
    activated: true,
    ...ctx,
  };
  const byId = (id: string) => rows.find((r) => r.id === id)!;
  const store: OutboundStore = {
    async load() { return { rows: rows.map((r) => ({ ...r })), ctx: context }; },
    async transition(id, to, detail) {
      const r = byId(id);
      transitions.push(`${id}:${r.status}->${to}${detail ? ` (${detail})` : ''}`);
      if (to === 'sending') { r.attempts += 1; r.sendingSince = NOW; }
      if (to === 'sent') r.sentAt = NOW;
      r.status = to;
    },
    async recordProviderId(id, pid) { (byId(id) as Row & { pid?: string }).pid = pid; },
    async scheduleRetry(id, delayMs) { byId(id).nextRetryAt = delayMs; },
    async deadLetter(id) { byId(id).deadLettered = true; },
  };
  return { store, rows, transitions };
}

const drive = (store: OutboundStore, script: readonly SendBehavior[] = ['ok']) => {
  const sim = whatsappSimulator(script);
  return driveConversationOutbound({ store, adapter: sim.adapter, now: () => NOW }, 'conv1');
};

/* ── Delivery, retries, ordering, suppression — end to end on the worker ── */
describe('M3 · outbound worker drive', () => {
  it('happy path: queued → sending → sent, provider id recorded, transitions audited', async () => {
    const m = memStore([{ id: 'a' }]);
    const effects = await drive(m.store);
    expect(effects).toEqual([{ kind: 'sent', id: 'a', providerMessageId: `wamid.SIM_OUT_${SIM_TAG}_1` }]);
    expect(m.transitions).toEqual(['a:queued->sending', 'a:sending->sent']);
  });

  it('ordering: quote waits for undelivered greeting; sends after delivery', async () => {
    const m = memStore([
      { id: 'greet', seq: 1, status: 'sent', sentAt: new Date(NOW.getTime() - 5_000) },
      { id: 'quote', seq: 2 },
    ]);
    expect((await drive(m.store))[0]).toMatchObject({ kind: 'waiting', blockedOn: 'greet' });

    // delivery status arrives (as the ingress would apply it) …
    const v = applyStatus('sent', 'delivered');
    if (v.apply) m.rows[0]!.status = v.next;
    expect((await drive(m.store))[0]).toMatchObject({ kind: 'sent', id: 'quote' });
  });

  it('transient 500: bounded retry then success; attempts audited', async () => {
    const m = memStore([{ id: 'a' }]);
    const first = await drive(m.store, ['http500']);
    expect(first[0]).toEqual({ kind: 'retry_scheduled', id: 'a', delayMs: 2_000 });
    expect(m.rows[0]!.status).toBe('queued');
    expect(m.rows[0]!.attempts).toBe(1);

    const second = await drive(m.store, ['ok']);
    expect(second[0]).toMatchObject({ kind: 'sent', id: 'a' });
  });

  it('rate limiting (429) retries with backoff', async () => {
    const m = memStore([{ id: 'a' }]);
    expect((await drive(m.store, ['http429']))[0]).toMatchObject({ kind: 'retry_scheduled' });
  });

  it('connection loss retries; provider 4xx fails permanently without retry', async () => {
    const down = memStore([{ id: 'a' }]);
    expect((await drive(down.store, ['network_down']))[0]).toMatchObject({ kind: 'retry_scheduled' });

    const rejected = memStore([{ id: 'b' }]);
    expect((await drive(rejected.store, ['http400_template']))[0]).toEqual({ kind: 'failed_permanent', id: 'b' });
    expect(rejected.rows[0]!.status).toBe('failed');
  });

  it('retryable failure on the last attempt dead-letters', async () => {
    const m = memStore([{ id: 'a', attempts: 5 }]);
    const effects = await drive(m.store, ['http500']);
    expect(effects[0]).toEqual({ kind: 'dead_lettered', id: 'a' });
    expect(m.rows[0]!.deadLettered).toBe(true);
    expect(m.rows[0]!.status).toBe('failed');
  });

  it('owner takeover cancels queued employee messages; owner text still goes out', async () => {
    const m = memStore(
      [{ id: 'emp', seq: 1, origin: 'employee' }, { id: 'own', seq: 2, origin: 'owner' }],
      { assignedTo: 'owner-1' },
    );
    const effects = await drive(m.store);
    expect(effects).toContainEqual({ kind: 'canceled', id: 'emp', reason: 'handed_off' });
    expect(effects).toContainEqual(expect.objectContaining({ kind: 'sent', id: 'own' }));
  });

  it('paused conversation sends nothing from the employee', async () => {
    const m = memStore([{ id: 'a' }], { paused: true });
    expect(await drive(m.store)).toContainEqual({ kind: 'canceled', id: 'a', reason: 'paused' });
  });

  it('expired window without a template: canceled, buyer must reopen', async () => {
    const m = memStore([{ id: 'a' }], { lastInboundAt: hoursAgo(25), template: 'none' });
    expect((await drive(m.store))[0]).toEqual({ kind: 'canceled', id: 'a', reason: 'window_closed' });
  });

  it('expired window with an approved template: back to the owner, never auto-sent', async () => {
    const m = memStore([{ id: 'a' }], { lastInboundAt: hoursAgo(25), template: 'approved' });
    expect((await drive(m.store))[0]).toEqual({ kind: 'canceled', id: 'a', reason: 'window_needs_owner' });
  });

  it('restart safety: a row stuck in sending is reclaimed, then sent', async () => {
    const m = memStore([{ id: 'a', status: 'sending', sendingSince: new Date(NOW.getTime() - 180_000) }]);
    const effects = await drive(m.store);
    expect(effects).toContainEqual({ kind: 'reclaimed', id: 'a' });
    expect(effects).toContainEqual(expect.objectContaining({ kind: 'sent', id: 'a' }));
  });
});

/* ── Ingress: signature, dedup, staleness, handshake ─────────────────────── */
describe('M3 · webhook ingress', () => {
  function harness() {
    const sim = whatsappSimulator();
    const seen = new Set<string>();
    const delivered: ChannelEvent[] = [];
    const app = buildIngressApp({
      adapter: sim.adapter,
      verifyToken: 'vt-123',
      persistEvent: async (e) => (seen.has(e.dedupKey) ? 'duplicate' : (seen.add(e.dedupKey), 'new')),
      onNewEvent: async (e) => { delivered.push(e); },
      now: () => NOW,
    });
    return { sim, app, delivered };
  }
  const post = (app: ReturnType<typeof buildIngressApp>, w: { rawBody: string; headers: Record<string, string> }) =>
    app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody,
      headers: { 'content-type': 'application/json', ...w.headers } });

  it('valid signed webhook: 200, parsed, persisted, enqueued once', async () => {
    const { sim, app, delivered } = harness();
    const res = await post(app, sim.inboundText({ text: 'price for 5000?' }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, received: 1 });
    expect(delivered[0]).toMatchObject({ kind: 'message', text: 'price for 5000?' });
  });

  it('duplicate webhook (7-day provider retries): acked, processed exactly once', async () => {
    const { sim, app, delivered } = harness();
    const w = sim.inboundText({ text: 'hello' });
    await post(app, w);
    const res = await post(app, w);
    expect(res.json()).toEqual({ ok: true, received: 0 });
    expect(delivered).toHaveLength(1);
  });

  it('tampered or missing signature: 401, nothing persisted', async () => {
    const { sim, app, delivered } = harness();
    const w = sim.inboundText({ text: 'hi' });
    const bad = await post(app, { rawBody: w.rawBody.replace('hi', 'hacked'), headers: w.headers });
    expect(bad.statusCode).toBe(401);
    const missing = await app.inject({ method: 'POST', url: '/webhook/whatsapp',
      payload: w.rawBody, headers: { 'content-type': 'application/json' } });
    expect(missing.statusCode).toBe(401);
    expect(delivered).toHaveLength(0);
  });

  it('replayed ancient events are dropped (beyond the 7-day retry horizon)', async () => {
    const { sim, app } = harness();
    const res = await post(app, sim.inboundText({ text: 'old', at: new Date('2026-06-01T00:00:00Z') }));
    expect(res.json()).toEqual({ ok: true, received: 0 });
    expect(isStaleEvent(new Date('2026-06-01T00:00:00Z'), NOW)).toBe(true);
  });

  it('subscription handshake echoes the challenge only for the right token', async () => {
    const { app } = harness();
    const ok = await app.inject({ method: 'GET',
      url: '/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=vt-123&hub.challenge=c777' });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('c777');
    const bad = await app.inject({ method: 'GET',
      url: '/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=c777' });
    expect(bad.statusCode).toBe(403);
  });

  it('media inbound parses with media id; missing caption still safe', async () => {
    const { sim, app, delivered } = harness();
    await post(app, sim.inboundImage({ caption: null }));
    expect(delivered[0]).toMatchObject({ kind: 'message', messageType: 'image', text: null });
  });

  it('status webhooks flow through the same path (delivery reconciliation input)', async () => {
    const { sim, app, delivered } = harness();
    await post(app, sim.status(`wamid.SIM_OUT_${SIM_TAG}_1`, 'delivered'));
    expect(delivered[0]).toMatchObject({ kind: 'status', status: 'delivered' });
  });

  it('delivered then read BOTH process (statuses share a wamid — compound dedup key), retries still dedup', async () => {
    const { sim, app, delivered } = harness();
    await post(app, sim.status(`wamid.SIM_OUT_${SIM_TAG}_1`, 'delivered'));
    await post(app, sim.status(`wamid.SIM_OUT_${SIM_TAG}_1`, 'read'));           // must NOT be dropped
    const retry = await post(app, sim.status(`wamid.SIM_OUT_${SIM_TAG}_1`, 'delivered'));  // true replay
    expect(delivered.map((e) => e.kind === 'status' && e.status)).toEqual(['delivered', 'read']);
    expect(retry.json()).toEqual({ ok: true, received: 0 });
  });
});

/* ── 测试连接 against the simulator ──────────────────────────────────────── */
describe('M3 · test-connection flow (simulator)', () => {
  const ports = (script: readonly SendBehavior[], inbound: boolean) => {
    const sim = whatsappSimulator(script);
    return {
      adapter: sim.adapter, ownerPhone: '8613800001234',
      waitForStatus: async () => script[0] === 'ok',
      hasInboundEvents: async () => inbound,
      checkOrdering: async () => true,
      checkPersistence: async () => true,
    };
  };

  it('everything works → 连接正常', async () => {
    const r = await runTestConnection(ports(['ok'], true));
    expect(r.verdict).toBe('all_good');
  });
  it('send rejected → 可以收到消息但暂时无法发送', async () => {
    const r = await runTestConnection(ports(['http401'], true));
    expect(r.verdict).toBe('inbound_only');
    expect(r.checks.outboundAccepted).toBe(false);
  });
  it('no inbound yet → 可以发送但还没收到客户消息', async () => {
    const r = await runTestConnection(ports(['ok'], false));
    expect(r.verdict).toBe('outbound_only');
  });
});

/* ── Security: encryption, redaction, no leakage ─────────────────────────── */
describe('M3 · credential security', () => {
  const key = deriveKey('a-solid-passphrase-for-tests');

  it('AES-256-GCM roundtrip; wrong key and tampering both fail closed', () => {
    const packed = encryptSecret('sk-live-SECRET-VALUE', key, 2);
    expect(decryptSecret(packed, key)).toEqual({ plain: 'sk-live-SECRET-VALUE', keyVersion: 2 });
    expect(() => decryptSecret(packed, deriveKey('wrong'))).toThrow();
    const parts = packed.split('.');
    parts[4] = Buffer.from('tampered-data-xx').toString('base64');
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
  });

  it('ciphertext never contains the plaintext; fingerprints are stable and short', () => {
    const packed = encryptSecret('my-api-key-value-123', key);
    expect(packed).not.toContain('my-api-key-value-123');
    expect(credentialFingerprint('abc')).toMatch(/^[0-9a-f]{12}$/);
    expect(credentialFingerprint('abc')).toBe(credentialFingerprint('abc'));
  });

  it('redaction strips known secrets and secret-shaped patterns from logs', () => {
    const line = 'POST failed D360-API-KEY: ak_live_9f8e7d6c Bearer eyJhbGciOi.payload password="hunter2!" key=ak_live_9f8e7d6c';
    const out = redactSecrets(line, ['ak_live_9f8e7d6c']);
    expect(out).not.toContain('ak_live_9f8e7d6c');
    expect(out).not.toContain('eyJhbGciOi');
    expect(out).not.toContain('hunter2');
    expect(out).toContain('[redacted]');
  });

  it('webhook signatures verify raw bytes; near-misses fail', () => {
    const sig = signBody('{"a":1}', 's3cret');
    expect(verifySignature('{"a":1}', sig, 's3cret')).toBe(true);
    expect(verifySignature('{"a":2}', sig, 's3cret')).toBe(false);
    expect(verifySignature('{"a":1}', sig, 'other')).toBe(false);
    expect(verifySignature('{"a":1}', undefined, 's3cret')).toBe(false);
    expect(verifySignature('{"a":1}', 'sha256=short', 's3cret')).toBe(false);
  });

  it('simulator carries no real-looking credentials; drive effects leak no secrets', async () => {
    expect(SIMULATOR_SECRET).toContain('not-a-real-credential');
    const m = memStore([{ id: 'a' }]);
    const effects = await drive(m.store);
    const blob = JSON.stringify(effects) + JSON.stringify(m.transitions);
    expect(blob).not.toContain('sim-key');
    expect(blob).not.toContain(SIMULATOR_SECRET);
  });
});

/* ── Audit M1: bounded provider timeouts ─────────────────────────────────── */
import { whatsappClient, PROVIDER_TIMEOUT_MS } from '../../src/channels/whatsapp/client.js';
import { whatsappMediaFetcher } from '../../src/channels/whatsapp/media.js';

describe('M1 · provider HTTP timeouts', () => {
  it('every send carries an abort signal; abort classifies as retryable', async () => {
    let sawSignal: AbortSignal | undefined;
    const client = whatsappClient({
      baseUrl: 'https://x', apiKey: 'k',
      fetchImpl: async (_url, init) => {
        sawSignal = init.signal;
        throw new DOMException('The operation timed out.', 'TimeoutError');
      },
    });
    const r = await client.sendText('1', 'x');
    expect(sawSignal).toBeInstanceOf(AbortSignal);
    expect(r).toMatchObject({ ok: false, retryable: true });
    expect(PROVIDER_TIMEOUT_MS).toBe(15_000);
  });

  it('aborted media request is a retryable failure with a signal attached', async () => {
    let sawSignal: AbortSignal | undefined;
    const fetcher = whatsappMediaFetcher({
      baseUrl: 'https://x', apiKey: 'k',
      fetchImpl: async (_url: string, init: { signal?: AbortSignal }) => {
        sawSignal = init.signal;
        throw new DOMException('The operation timed out.', 'TimeoutError');
      },
    });
    const r = await fetcher('media1');
    expect(sawSignal).toBeInstanceOf(AbortSignal);
    expect(r).toMatchObject({ ok: false, retryable: true });
  });
});

/* ── Audit M3: provider error text is redacted before every sink ─────────── */
describe('M3 · error-sink redaction', () => {
  it('secret-shaped provider errors are redacted in transitions and retry storage', async () => {
    const m = memStore([{ id: 'a' }]);
    const leakyAdapter = {
      kind: 'whatsapp' as const, provider: 'test',
      verifyWebhook: () => true, parseWebhook: () => [],
      sendText: async () => ({ ok: false as const, retryable: true,
        error: '500: {"api_key": "sk-live-supersecret-123", "msg": "boom"}' }),
    };
    const effects = await driveConversationOutbound(
      { store: m.store, adapter: leakyAdapter, now: () => NOW }, 'conv1');
    expect(effects[0]).toMatchObject({ kind: 'retry_scheduled' });
    const everything = m.transitions.join('\n');
    expect(everything).not.toContain('sk-live-supersecret-123');
    expect(everything).toContain('[redacted]');
  });
});
