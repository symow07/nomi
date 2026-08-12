import { describe, it, expect } from 'vitest';
import { parseWebhook } from '../../src/channels/whatsapp/parse.js';
import { nextToSend, DELIVERY_WAIT_CAP_MS, type OutboundRow } from '../../src/outbound/sequencer.js';
import { parseOwnerReply } from '../../src/core/conversation/cards.js';
import { capabilityOf, resolveMode, withinWindow } from '../../src/core/conversation/autonomy.js';
import { whatsappClient } from '../../src/channels/whatsapp/client.js';
import { computeQuote } from '../../src/core/commerce/quote.js';
import { product, tiers, policy, PRODUCT } from './fixtures.js';
import type { TurnDecision } from '../../src/core/conversation/decide.js';

/* ── WhatsApp Cloud API parser ─────────────────────────────────────────── */
describe('whatsapp webhook parser', () => {
  const inboundPayload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA_ID',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '8657900001234', phone_number_id: 'PNID_1' },
          contacts: [{ profile: { name: 'Ahmed Dubai' }, wa_id: '971500000000' }],
          messages: [{
            from: '971500000000',
            id: 'wamid.INBOUND1',
            timestamp: '1752710400',
            type: 'text',
            text: { body: 'Can you quote 5000 pcs FOB Ningbo?' },
          }],
        },
      }],
    }],
  };

  it('parses an inbound text message with contact name + tenant number id', () => {
    const events = parseWebhook(inboundPayload);
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.kind).toBe('message');
    if (e.kind === 'message') {
      expect(e.eventId).toBe('wamid.INBOUND1');       // dedup key
      expect(e.waId).toBe('971500000000');
      expect(e.profileName).toBe('Ahmed Dubai');
      expect(e.phoneNumberId).toBe('PNID_1');          // tenant from credential
      expect(e.text).toContain('5000 pcs');
      expect(e.occurredAt.getTime()).toBe(1752710400 * 1000);
    }
  });

  it('parses statuses (the delivery-ordering signal) in the same webhook', () => {
    const events = parseWebhook({
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: 'PNID_1' },
        statuses: [
          { id: 'wamid.OUT1', status: 'delivered', timestamp: '1752710500' },
          { id: 'wamid.OUT2', status: 'failed', timestamp: '1752710501',
            errors: [{ title: 'Message expired (24h window)' }] },
        ],
      } }] }],
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: 'status', eventId: 'wamid.OUT1', status: 'delivered' });
    expect(events[1]).toMatchObject({ kind: 'status', status: 'failed', errorDetail: 'Message expired (24h window)' });
  });

  it('image caption becomes text; media id captured', () => {
    const events = parseWebhook({
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: 'PNID_1' },
        messages: [{ from: '971500000000', id: 'wamid.IMG1', timestamp: '1752710400',
          type: 'image', image: { id: 'media_123', caption: 'need this bag 5000pcs' } }],
      } }] }],
    });
    const e = events[0]!;
    if (e.kind === 'message') {
      expect(e.messageType).toBe('image');
      expect(e.text).toBe('need this bag 5000pcs');
      expect(e.mediaId).toBe('media_123');
    }
  });

  it('malformed payloads produce zero events, never throw (ingress must ack in <5s)', () => {
    expect(parseWebhook(null)).toEqual([]);
    expect(parseWebhook({})).toEqual([]);
    expect(parseWebhook({ entry: [{ changes: [{ value: { messages: [{}] } }] }] })).toEqual([]);
  });
});

/* ── Delivery-ordering sequencer ───────────────────────────────────────── */
describe('outbound sequencer', () => {
  const row = (o: Partial<OutboundRow> & { id: string; seq: number }): OutboundRow => ({
    status: 'queued', requiresOrder: true, attempts: 0, sentAt: null, ...o,
  });
  const now = new Date('2026-07-17T10:00:00Z');

  it('greeting then quote: quote WAITS until greeting is delivered', () => {
    const rows = [
      row({ id: 'greet', seq: 1, status: 'sent', sentAt: new Date(now.getTime() - 5_000) }),
      row({ id: 'quote', seq: 2 }),
    ];
    const d = nextToSend(rows, now);
    expect(d).toMatchObject({ action: 'wait', blockedOn: 'greet' });
  });

  it('...and sends once delivered', () => {
    const rows = [
      row({ id: 'greet', seq: 1, status: 'delivered' }),
      row({ id: 'quote', seq: 2 }),
    ];
    expect(nextToSend(rows, now)).toEqual({ action: 'send', id: 'quote' });
  });

  it('the wait cap unblocks when receipts never arrive (coherence yields to responsiveness)', () => {
    const rows = [
      row({ id: 'greet', seq: 1, status: 'sent', sentAt: new Date(now.getTime() - DELIVERY_WAIT_CAP_MS - 1) }),
      row({ id: 'quote', seq: 2 }),
    ];
    expect(nextToSend(rows, now)).toEqual({ action: 'send', id: 'quote' });
  });

  it('a failed predecessor never blocks; order-independent messages overtake', () => {
    expect(nextToSend([
      row({ id: 'a', seq: 1, status: 'failed' }),
      row({ id: 'b', seq: 2 }),
    ], now)).toEqual({ action: 'send', id: 'b' });

    expect(nextToSend([
      row({ id: 'a', seq: 1, status: 'sent', sentAt: now }),
      row({ id: 'typing', seq: 2, requiresOrder: false }),
    ], now)).toEqual({ action: 'send', id: 'typing' });
  });
});

/* ── Cards ─────────────────────────────────────────────────────────────── */
describe('quote card + approval card + owner commands', () => {
  const quote = (() => {
    const r = computeQuote({ product: product(), tiers: tiers(), policy: policy(), rules: [], quantity: 5000 });
    if (!r.ok) throw new Error('fixture');
    return r.value;
  })();

  /*
   * M34.11 — the quote-card and approval-card blocks went with their renderers.
   * api/web/inbox.ts shows the live equivalents from stored rows: the quote line
   * (quantity · unit price · total) and the draft card whose buttons post the
   * SAME wire words asserted just below — which is the part that has to keep
   * working, and does.
   */

  it.each([
    ['发送', 'approve'], ['好', 'approve'], ['不回', 'skip'], ['收回', 'revoke'],
  ])('owner reply %s → %s', (raw, kind) => {
    expect(parseOwnerReply(raw).kind).toBe(kind);
  });

  it('substantive text is treated as an edit — no syntax to learn', () => {
    const c = parseOwnerReply('告诉他0.46，5000个不够量');
    expect(c.kind).toBe('edit');
    if (c.kind === 'edit') expect(c.text).toContain('0.46');
  });
});

/* ── Night-shift autonomy ──────────────────────────────────────────────── */
describe('autonomy resolution (值夜班)', () => {
  const TZ = 'Asia/Shanghai';
  const grants = [
    { capability: 'greet' as const, mode: 'auto' as const, timeWindow: '22:00-07:00' },
    { capability: 'quote' as const, mode: 'auto' as const, timeWindow: '22:00-07:00' },
  ];
  const nightCST = new Date('2026-07-16T18:30:00Z');  // 02:30 CST
  const dayCST = new Date('2026-07-17T06:00:00Z');    // 14:00 CST

  it('night quote goes AUTO at 02:30 Yiwu time, DRAFT at 14:00', () => {
    expect(resolveMode({ capability: 'quote', grants, now: nightCST, timeZone: TZ })).toBe('auto');
    expect(resolveMode({ capability: 'quote', grants, now: dayCST, timeZone: TZ })).toBe('draft');
  });

  it('cross-midnight window math', () => {
    expect(withinWindow(nightCST, TZ, '22:00-07:00')).toBe(true);
    expect(withinWindow(dayCST, TZ, '22:00-07:00')).toBe(false);
  });

  it('confirm_order is draft FOREVER, even if someone grants it auto', () => {
    const g = [{ capability: 'confirm_order' as const, mode: 'auto' as const, timeWindow: null }];
    expect(resolveMode({ capability: 'confirm_order', grants: g, now: nightCST, timeZone: TZ })).toBe('draft');
  });

  it('no grant / malformed window fail toward drafts', () => {
    expect(resolveMode({ capability: 'negotiate', grants, now: nightCST, timeZone: TZ })).toBe('draft');
    const bad = [{ capability: 'greet' as const, mode: 'auto' as const, timeWindow: 'nonsense' }];
    expect(resolveMode({ capability: 'greet', grants: bad, now: nightCST, timeZone: TZ })).toBe('draft');
  });

  it('capability derivation: worst-case wins', () => {
    const base = {
      nextPhase: 'qualification', scores: { problem: 0, lead: 0 }, pendingQuestion: null,
      product: null, quantity: null, email: null, hotLead: false, injectionDetected: false,
    } as unknown as TurnDecision;
    expect(capabilityOf({ ...base, action: { kind: 'confirm_order' } } as TurnDecision, true)).toBe('confirm_order');
    expect(capabilityOf({ ...base, action: { kind: 'generate_reply' } } as TurnDecision, true)).toBe('quote');
    expect(capabilityOf({ ...base, action: { kind: 'generate_reply' }, product: { productId: PRODUCT, confidence: 0.8, confirmedByClient: false, matchMethod: 'text' } } as TurnDecision, false)).toBe('recommend');
  });
});

/* ── Send client ───────────────────────────────────────────────────────── */
describe('360dialog client', () => {
  it('builds the Cloud API payload and extracts the provider message id', async () => {
    let captured: { url: string; body: string } | null = null;
    const client = whatsappClient({
      baseUrl: 'https://waba-sandbox.360dialog.io', apiKey: 'k',
      fetchImpl: async (url, init) => {
        captured = { url, body: init.body };
        return { status: 200, text: async () => '{"messages":[{"id":"wamid.SENT1"}]}' };
      },
    });
    const r = await client.sendText('971500000000', 'hello');
    expect(r).toEqual({ ok: true, providerMessageId: 'wamid.SENT1' });
    expect(captured!.url).toContain('/messages');
    expect(JSON.parse(captured!.body)).toMatchObject({ messaging_product: 'whatsapp', to: '971500000000' });
  });

  it('429/5xx retryable; 4xx not (a 24h-window rejection must never retry-loop)', async () => {
    const mk = (status: number) => whatsappClient({
      baseUrl: 'x', apiKey: 'k',
      fetchImpl: async () => ({ status, text: async () => 'err' }),
    });
    expect((await mk(429).sendText('1', 'x'))).toMatchObject({ ok: false, retryable: true });
    expect((await mk(500).sendText('1', 'x'))).toMatchObject({ ok: false, retryable: true });
    expect((await mk(400).sendText('1', 'x'))).toMatchObject({ ok: false, retryable: false });
  });
});
