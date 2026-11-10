import { describe, it, expect } from 'vitest';
import {
  driveConversationOutbound, REFUSAL_REASONS, type ConversationSendContext, type OutboundStore, type OutboundWorkRow,
} from '../../src/outbound/worker.js';
import type { ChannelAdapter, OutboundProduct, SendResult } from '../../src/channels/contract.js';
import { whatsappClient } from '../../src/channels/whatsapp/client.js';
import { metaAdapter } from '../../src/channels/whatsapp/meta.js';
import { productCardText } from '../../src/db/waProductCard.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * Part B (5.3) — a WhatsApp product card the owner sends goes through the ONE outbound path and its gate, unchanged:
 * inside the customer's 24 hours it goes as one `sendProduct`; outside them it is refused — even where an approved
 * reopening template exists — with no adapter call at all. A card whose item changed is refused as such; an adapter
 * that cannot carry one refuses it; it is never sent as its transcript words.
 */

const NOW = new Date('2031-05-12T12:00:00Z');
const RECENT = new Date(NOW.getTime() - 60_000);
const OLD = new Date(NOW.getTime() - 3 * 24 * 3600_000);
const CARD: OutboundProduct = { catalogId: '456', retailerId: 'nomi_abc' };
const REOPEN = { name: 'nomi_reply_waiting', language: 'en', params: ['The shop'], text: 'A reply is waiting.' };

type Call = { kind: 'text' | 'template' | 'product'; to: string; what: unknown };
function adapter(opts: { readonly product?: boolean; readonly answer?: SendResult } = {}): ChannelAdapter & { calls: Call[] } {
  const calls: Call[] = [];
  let n = 0;
  const ok = (): SendResult => opts.answer ?? { ok: true, providerMessageId: `wamid.${++n}` };
  const base = {
    kind: 'whatsapp' as const, provider: 'test', calls,
    verifyWebhook: () => true, parseWebhook: () => [],
    sendText: async (to: string, body: string) => { calls.push({ kind: 'text', to, what: body }); return ok(); },
    sendTemplate: async (to: string, tpl: unknown) => { calls.push({ kind: 'template', to, what: tpl }); return ok(); },
  };
  return opts.product === false ? base
    : { ...base, sendProduct: async (to: string, p: OutboundProduct) => { calls.push({ kind: 'product', to, what: p }); return ok(); } };
}

type Store = OutboundStore & { statuses: string[]; refusals: string[]; reopened: number };
function store(row: Partial<OutboundWorkRow>, ctx: Partial<ConversationSendContext> = {}): Store {
  const statuses: string[] = [];
  const refusals: string[] = [];
  const s: Store = {
    statuses, refusals, reopened: 0,
    load: async () => ({
      rows: [{
        id: 'o1', seq: 1, status: 'queued', requiresOrder: true, attempts: 0, sentAt: null, to: '447700900001',
        body: 'Product card: Linen shirt, £24.50', origin: 'owner', sendingSince: null, channel: 'whatsapp',
        kind: 'product', product: CARD, ...row,
      }],
      ctx: {
        assignedTo: 'owner', paused: false, lastInboundAt: RECENT, template: 'none', silenced: false, stopped: false, frozen: false,
        pilotMode: false, recipientAllowed: true, dailyCeilingReached: false, activated: true, ...ctx,
      },
    }),
    transition: async (_id, to, detail) => { statuses.push(detail ? `${to}:${detail}` : to); },
    recordProviderId: async () => {},
    scheduleRetry: async () => {},
    deadLetter: async () => {},
    recordRefusal: async (_id, _to, reason) => { refusals.push(reason); },
    reopenedWith: async () => { s.reopened++; },
  };
  return s;
}
const drive = (s: OutboundStore, a: ChannelAdapter | undefined) =>
  driveConversationOutbound({ store: s, ...(a ? { adapter: a } : {}), now: () => NOW, mediaOrigin: 'https://nomi.example' }, 'c1');
const text: Partial<OutboundWorkRow> = { kind: 'text', product: null, body: 'Hello' };

describe('Part B · test 15 — inside the window, ONE sendProduct through the ordinary path', () => {
  it('the card goes once, as the catalogue item; never text, never a template', async () => {
    const a = adapter();
    const s = store({});
    const fx = await drive(s, a);
    expect(fx).toContainEqual(expect.objectContaining({ kind: 'sent', id: 'o1' }));
    expect(a.calls).toEqual([{ kind: 'product', to: '447700900001', what: CARD }]);
    expect(s.statuses).toEqual(['sending', 'sent']);
  });
  it('the same transitions as a text row', async () => {
    const card = store({}); const words = store(text);
    await drive(card, adapter()); await drive(words, adapter());
    expect(card.statuses).toEqual(words.statuses);
  });
  it('the transcript says what the snapshot said', () => {
    expect(productCardText({ name: 'Linen shirt', price: '24.5000', currency: 'GBP' })).toBe('Product card: Linen shirt, £24.50');
    expect(productCardText({ name: 'Tote', price: '12', currency: 'USD' })).toBe('Product card: Tote, $12.00');
  });
});

describe('Part B · test 16 — outside the window it is refused, with zero adapter calls', () => {
  it('with an APPROVED reopening template: window_needs_owner, no template, no card, no text', async () => {
    const a = adapter();
    const s = store({}, { lastInboundAt: OLD, template: 'approved', reopen: REOPEN });
    const fx = await drive(s, a);
    expect(fx).toContainEqual({ kind: 'canceled', id: 'o1', reason: 'window_needs_owner' });
    expect(a.calls).toEqual([]); expect(s.reopened).toBe(0);
  });
  it('the same row as an owner TEXT reply would have gone as the template — the approved line is what stops the card', async () => {
    const a = adapter();
    const s = store(text, { lastInboundAt: OLD, template: 'approved', reopen: REOPEN });
    await drive(s, a);
    expect(a.calls.map((c) => c.kind)).toEqual(['template']);
  });
  it('without a template: the free-form refusal a text row gets, no adapter call', async () => {
    const a = adapter();
    const card = store({}, { lastInboundAt: OLD });
    const words = store(text, { lastInboundAt: OLD });
    await drive(card, a); await drive(words, adapter());
    expect(card.refusals).toEqual(words.refusals);
    expect(card.refusals).toHaveLength(1);
    expect(a.calls).toEqual([]);
  });
});

describe('Part B · test 17 — every existing control binds a card as it binds words', () => {
  const controls: readonly [string, Partial<ConversationSendContext>][] = [
    ['stopped', { stopped: true }], ['silenced', { silenced: true }], ['frozen', { frozen: true }],
    ['paused', { paused: true }], ['not activated', { activated: false }],
    ['not on the pilot list', { pilotMode: true, recipientAllowed: false }],
    ['daily ceiling', { dailyCeilingReached: true }],
    ['opted out', { optOut: { lastAskedAt: RECENT } }],
    ['the assistant holds it', { assignedTo: null }],
  ];
  it.each(controls)('%s: the same outcome as a text row, and no card leaves', async (_name, ctx) => {
    const a = adapter(); const b = adapter();
    const card = store({}, ctx); const words = store(text, ctx);
    const fxCard = await drive(card, a); const fxWords = await drive(words, b);
    expect(fxCard).toEqual(fxWords);
    expect(card.refusals).toEqual(words.refusals);
    expect(a.calls.filter((c) => c.kind !== 'product')).toEqual([]);
    if (b.calls.length === 0) expect(a.calls).toEqual([]);
  });
  it('a send stuck past the reclaim is uncertain, never sent again', async () => {
    const a = adapter();
    const s = store({ status: 'sending', sendingSince: new Date(NOW.getTime() - 10 * 60_000) });
    expect(await drive(s, a)).toContainEqual({ kind: 'uncertain', id: 'o1' });
    expect(a.calls).toEqual([]);
  });
  it('a provider answer that may have left is uncertain; a 5xx is retried by the one rule', async () => {
    const lost = store({});
    expect(await drive(lost, adapter({ answer: { ok: false, retryable: false, uncertain: true, error: 'timeout' } })))
      .toContainEqual({ kind: 'uncertain', id: 'o1' });
    const busy = store({});
    expect(await drive(busy, adapter({ answer: { ok: false, retryable: true, error: '503: busy' } })))
      .toContainEqual(expect.objectContaining({ kind: 'retry_scheduled', id: 'o1' }));
  });
});

describe('Part B · a stale or uncarried card is refused, never downgraded', () => {
  it('stale (no matching item): product_changed, zero adapter calls', async () => {
    const a = adapter();
    const s = store({ product: null });
    expect(await drive(s, a)).toContainEqual({ kind: 'canceled', id: 'o1', reason: 'product_changed' });
    expect(s.refusals).toEqual(['product_changed']);
    expect(a.calls).toEqual([]);
  });
  it('an adapter without sendProduct: media_unsupported, its words never sent as text', async () => {
    const a = adapter({ product: false });
    const s = store({});
    expect(await drive(s, a)).toContainEqual({ kind: 'canceled', id: 'o1', reason: 'media_unsupported' });
    expect(a.calls).toEqual([]);
  });
  it('no adapter at all: the same refusal a text row gets', async () => {
    const card = store({}); const words = store(text);
    await drive(card, undefined); await drive(words, undefined);
    expect(card.refusals).toEqual(words.refusals);
    expect(card.refusals).toEqual(['channel_unavailable']);
  });
  it('product_changed is a refusal the owner can read, in every locale', () => {
    expect(REFUSAL_REASONS).toContain('product_changed');
    for (const locale of LOCALES) for (const part of ['what', 'why', 'do'] as const) {
      const s = t(locale, `refused.${part}.product_changed` as MessageKey, { name: 'Lily' });
      expect(s.length).toBeGreaterThan(4); expect(s).not.toContain('{');
    }
  });
});

describe('Part B · the wire', () => {
  it('a single-product message: interactive product, the catalogue and the retailer id, no header or body', async () => {
    const seen: { url: string; body: string; auth: string }[] = [];
    const a = metaAdapter({
      accessToken: 'token-not-real', phoneNumberId: '1091', appSecret: 's', graphVersion: 'v27.0',
      fetchImpl: async (url, init) => { seen.push({ url, body: init.body, auth: init.headers['Authorization'] ?? '' }); return { status: 200, text: async () => '{"messages":[{"id":"wamid.X"}]}' }; },
    });
    expect(await a.sendProduct!('447700900001', CARD)).toEqual({ ok: true, providerMessageId: 'wamid.X' });
    expect(seen[0]!.url).toBe('https://graph.facebook.com/v27.0/1091/messages');
    expect(JSON.parse(seen[0]!.body)).toEqual({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: '447700900001', type: 'interactive',
      interactive: { type: 'product', action: { catalog_id: '456', product_retailer_id: 'nomi_abc' } },
    });
  });
  it('a yes that names no message is uncertain, as every send is', async () => {
    const c = whatsappClient({ baseUrl: 'https://x.test', apiKey: 'k', fetchImpl: async () => ({ status: 200, text: async () => '{}' }) });
    expect(await c.sendProduct('1', CARD)).toMatchObject({ ok: false, uncertain: true });
  });
});
