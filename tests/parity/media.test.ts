import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { driveConversationOutbound, type OutboundStore, type OutboundWorkRow } from '../../src/outbound/worker.js';
import type { ChannelAdapter, OutboundMedia, SendResult } from '../../src/channels/contract.js';
import { REFUSAL_REASONS } from '../../src/api/web/refusals.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * M26 — she can send a picture.
 *
 * She could already READ a buyer's photo and match it to a product; she could
 * not send one back. For a supplier whose trade is "is this the one?", that is
 * half a salesperson.
 *
 * What is on trial here is not that media works — it is that media changed
 * NOTHING about how a message is allowed out. Same single send path, same gate,
 * same ordering, same refusal machinery. And one specific thing must never
 * happen: an image whose picture cannot be carried must be refused, never
 * quietly sent as its caption.
 */

const NOW = new Date('2026-08-06T10:00:00Z');
const RECENT = new Date(NOW.getTime() - 60_000);
const URL_ = 'https://example.test/products/tote.jpg';

type Sent = { kind: 'text'; to: string; body: string } | { kind: 'media'; to: string; media: OutboundMedia };

function adapter(opts: { readonly media?: boolean } = {}): ChannelAdapter & { sent: Sent[] } {
  const sent: Sent[] = [];
  let n = 0;
  const ok = (): SendResult => ({ ok: true, providerMessageId: `wamid.${++n}` });
  const base = {
    kind: 'whatsapp' as const, provider: 'test', sent,
    verifyWebhook: () => true,
    parseWebhook: () => [],
    sendText: async (to: string, body: string) => { sent.push({ kind: 'text', to, body }); return ok(); },
  };
  return opts.media === false
    ? base
    : { ...base, sendMedia: async (to: string, media: OutboundMedia) => { sent.push({ kind: 'media', to, media }); return ok(); } };
}

function store(row: Partial<OutboundWorkRow>): OutboundStore & { statuses: string[]; refusals: string[] } {
  const statuses: string[] = [];
  const refusals: string[] = [];
  const full: OutboundWorkRow = {
    id: 'o1', seq: 1, status: 'queued', requiresOrder: true, attempts: 0, sentAt: null,
    to: '971500001111', body: 'Here it is.', origin: 'employee', sendingSince: null, ...row,
  };
  return {
    statuses, refusals,
    load: async () => ({
      rows: [full],
      ctx: {
        assignedTo: null, paused: false, lastInboundAt: RECENT, template: 'none', silenced: false,
        pilotMode: true, recipientAllowed: true, dailyCeilingReached: false, activated: true,
      },
    }),
    transition: async (_id, to, detail) => { statuses.push(detail ? `${to}:${detail}` : to); },
    recordProviderId: async () => {},
    scheduleRetry: async () => {},
    deadLetter: async () => {},
    recordRefusal: async (_id, _to, reason) => { refusals.push(reason); },
  };
}

const drive = (s: OutboundStore, a: ChannelAdapter) =>
  driveConversationOutbound({ store: s, adapter: a, now: () => NOW }, 'c1');

describe('M26 · a picture goes out through the one send path', () => {
  it('an image row calls sendMedia with the owner’s own url and the caption', async () => {
    const a = adapter();
    const s = store({ kind: 'image', mediaUrl: URL_, body: 'Our non-woven tote.' });
    const effects = await drive(s, a);
    expect(effects).toContainEqual(expect.objectContaining({ kind: 'sent' }));
    expect(a.sent).toEqual([{ kind: 'media', to: '971500001111', media: { url: URL_, caption: 'Our non-woven tote.' } }]);
  });

  it('a text row is untouched — media changed nothing for every message that exists today', async () => {
    const a = adapter();
    const s = store({ body: 'Yes, we can do that.' });        // no kind, no mediaUrl
    await drive(s, a);
    expect(a.sent).toEqual([{ kind: 'text', to: '971500001111', body: 'Yes, we can do that.' }]);
  });

  it('an image is recorded through the SAME transitions as text', async () => {
    const img = store({ kind: 'image', mediaUrl: URL_ });
    const txt = store({});
    await drive(img, adapter());
    await drive(txt, adapter());
    expect(img.statuses).toEqual(txt.statuses);
  });
});

describe('M26 · a caption is never sent without its picture', () => {
  it('an adapter that cannot carry media REFUSES — it does not downgrade to text', async () => {
    // The defect this forbids: the buyer receives "Our non-woven tote." with no
    // tote, which is a different message from the one the owner approved.
    const a = adapter({ media: false });
    const s = store({ kind: 'image', mediaUrl: URL_, body: 'Our non-woven tote.' });
    const effects = await drive(s, a);
    expect(a.sent).toEqual([]);                                     // nothing left the building
    expect(effects).toContainEqual({ kind: 'canceled', id: 'o1', reason: 'media_unsupported' });
    expect(s.refusals).toEqual(['media_unsupported']);              // and the owner is told
  });

  it('an image row with no url is refused, not sent as its caption', async () => {
    const a = adapter();
    const s = store({ kind: 'image', mediaUrl: null, body: 'Our non-woven tote.' });
    const effects = await drive(s, a);
    expect(a.sent).toEqual([]);
    expect(effects).toContainEqual({ kind: 'canceled', id: 'o1', reason: 'media_unsupported' });
  });

  it('the refusal is canceled with its reason, like every other refusal', async () => {
    const s = store({ kind: 'image', mediaUrl: null });
    await drive(s, adapter({ media: false }));
    expect(s.statuses).toContain('canceled:canceled: media_unsupported');
  });
});

describe('M26 · the gate is still the only authority', () => {
  it('a refused image never reaches the adapter, whatever the gate refused for', async () => {
    for (const [label, ctxPatch] of [
      ['handed off', { assignedTo: 'agent:someone' }],
      ['paused', { paused: true }],
      ['not activated', { activated: false }],
      ['not allowlisted', { recipientAllowed: false }],
    ] as const) {
      const a = adapter();
      const base = store({ kind: 'image', mediaUrl: URL_ });
      const s: OutboundStore = {
        ...base,
        load: async () => {
          const r = await base.load('c1');
          return { rows: r.rows, ctx: { ...r.ctx, ...ctxPatch } };
        },
      };
      await drive(s, a);
      expect(a.sent, `${label}: a picture escaped the gate`).toEqual([]);
    }
  });

  it('media added no branch to gateOutbound', async () => {
    // The gate must not have learned what an image is. If it had, media would
    // be a second authority over what may leave.
    const src = await readFile(new URL('../../src/core/channel/sendGate.ts', import.meta.url), 'utf8');
    for (const word of ['image', 'media', 'mediaUrl', 'sendMedia'])
      expect(src.toLowerCase().includes(word.toLowerCase()), `sendGate.ts mentions ${word}`).toBe(false);
  });

  it('exactly one place calls the provider for media', async () => {
    const src = await readFile(new URL('../../src/outbound/worker.ts', import.meta.url), 'utf8');
    expect(src.split('adapter.sendMedia(').length - 1).toBe(1);
    expect(src.split('adapter.sendText(').length - 1).toBe(1);
  });
});

describe('M26 · the owner is told, in her own words', () => {
  it('media_unsupported is a refusal the owner can read and act on', () => {
    expect(REFUSAL_REASONS).toContain('media_unsupported');
    for (const locale of LOCALES) {
      for (const part of ['what', 'why', 'do'] as const) {
        const s = t(locale, `refused.${part}.media_unsupported` as MessageKey, { name: 'Lily' });
        expect(s.length, `${locale}/${part}`).toBeGreaterThan(4);
        expect(s, `${locale}/${part} left a placeholder`).not.toContain('{');
      }
    }
  });

  it('it never reads as a success', () => {
    for (const locale of LOCALES) {
      const what = t(locale, 'refused.what.media_unsupported' as MessageKey, { name: 'Lily' });
      for (const claim of ['sent', 'delivered', '已发送', 'أُرسلت'])
        expect(what.toLowerCase()).not.toContain(claim.toLowerCase());
    }
  });
});

describe('M26 · no real media delivery exists yet', () => {
  it('the meta adapter can carry it, and is only built when a provider is configured', async () => {
    const meta = await readFile(new URL('../../src/channels/whatsapp/meta.ts', import.meta.url), 'utf8');
    expect(meta).toContain('sendMedia');
    const main = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8');
    // Disabled mode mounts no adapter at all, so no media can leave regardless.
    expect(main).toContain("cfg.provider === 'disabled'");
  });

  it('the picture itself is not stored — only a link to the owner’s own image', async () => {
    const mig = await readFile(new URL('../../migrations/0024_outbound_media.sql', import.meta.url), 'utf8');
    expect(mig).toContain('media_url');
    for (const blob of ['bytea', 'blob', 'base64'])
      expect(mig.toLowerCase().includes(blob), `0024 stores ${blob}`).toBe(false);
  });
});
