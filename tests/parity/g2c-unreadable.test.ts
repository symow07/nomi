import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { usd } from '../../src/core/types/money.js';
import { parseWebhook } from '../../src/channels/whatsapp/parse.js';
import { whatsappSimulator } from '../../src/channels/whatsapp/simulator.js';
import { inboundDisposition } from '../../src/core/conversation/inbound.js';
import {
  PROBLEM_SIGNAL_KINDS, TRIGGER_REASONS, isProblemSignal, toTriggerReason,
} from '../../src/core/scoring/signals.js';
import { renderConversationDetail, type ConversationDetail } from '../../src/api/web/inbox.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, EMPLOYEE_NAME } from '../../src/core/owner/i18n/messages.js';

/**
 * G2c — what she cannot read goes to a person, by name.
 *
 * A document, a video, a location, a sticker, a reaction: each used to arrive
 * as an EMPTY STRING and run a turn. An emoji got a reply to nothing; a PDF
 * request for quotation got a confident answer to a file she never opened, and
 * the owner was not shown that a file had arrived. And the two surfaces that
 * listed "why she needed you" each kept their own list of problem kinds —
 * Today's had never learned that an unheard voice note was one.
 */

const NOW = new Date('2026-09-10T10:00:00Z');
const sim = whatsappSimulator([], { tag: 'g2c' });
const parsed = (w: { payload: unknown }) => {
  const [e] = parseWebhook(w.payload);
  if (!e || e.kind !== 'message') throw new Error('expected a message event');
  return e;
};

describe('G2c · the parser says what arrived, not only whether it can be read', () => {
  it('a document keeps its caption and its kind', () => {
    const e = parsed(sim.inboundOther({ type: 'document', body: { id: 'd1', filename: 'rfq.pdf', caption: 'RFQ attached' } }));
    expect(e).toMatchObject({ messageType: 'unsupported', received: 'document', text: 'RFQ attached' });
  });

  it('a sticker, a reaction and a location each say what they are', () => {
    expect(parsed(sim.inboundOther({ type: 'sticker', body: { id: 's1' } }))).toMatchObject({ messageType: 'unsupported', received: 'sticker', text: null });
    expect(parsed(sim.inboundOther({ type: 'reaction', body: { emoji: '👍' } }))).toMatchObject({ received: 'reaction' });
    expect(parsed(sim.inboundOther({ type: 'location', body: { latitude: 29.3, longitude: 120.1 } }))).toMatchObject({ received: 'location' });
  });

  it('text, photos and voice notes are unchanged', () => {
    expect(parsed(sim.inboundText({ text: 'hello' }))).toMatchObject({ messageType: 'text', received: 'text', text: 'hello' });
    expect(parsed(sim.inboundAudio())).toMatchObject({ messageType: 'audio', received: 'audio' });
    expect(parsed(sim.inboundImage({ caption: 'this one' }))).toMatchObject({ messageType: 'image', text: 'this one' });
  });
});

describe('G2c · ignore it, or hand it to a person — never guess', () => {
  it('what she can read is answered on its existing path', () => {
    for (const type of ['text', 'image', 'audio'] as const) {
      expect(inboundDisposition(type, type)).toEqual({ kind: 'answer' });
    }
  });

  it('a reaction or a sticker asks nothing, so nothing is owed', () => {
    expect(inboundDisposition('unsupported', 'reaction')).toEqual({ kind: 'ignore', received: 'reaction' });
    expect(inboundDisposition('unsupported', 'sticker')).toEqual({ kind: 'ignore', received: 'sticker' });
  });

  it('a document, a video, a location or a contact card goes to a person, named', () => {
    for (const r of ['document', 'video', 'location', 'contacts'] as const) {
      expect(inboundDisposition('unsupported', r)).toEqual({ kind: 'owner', received: r });
    }
  });

  it('a kind it has never seen goes to a person too — dropping something real costs a buyer', () => {
    expect(inboundDisposition('unsupported', 'order')).toEqual({ kind: 'owner', received: 'other' });
    expect(inboundDisposition('unsupported', undefined)).toEqual({ kind: 'owner', received: 'other' });
  });
});

describe('G2c · one list of reasons she needed you', () => {
  it('an unreadable message is a PROBLEM signal with its own escalation reason', () => {
    const s = { kind: 'media_unreadable', received: 'document' } as const;
    expect(isProblemSignal(s)).toBe(true);
    expect(toTriggerReason(s)).toBe('media_unreadable');
    expect(PROBLEM_SIGNAL_KINDS).toContain('media_unreadable');
    expect(PROBLEM_SIGNAL_KINDS).toContain('audio_unheard');
  });

  it('the NEWEST migration to define the CHECKs admits every word, or the first PDF fails its insert', async () => {
    // 0039 added 'media_unreadable'; 0042 (G10c) redefined both CHECKs for
    // 'unlisted_number'. The constraint in force is whichever came last.
    const { readdir } = await import('node:fs/promises');
    const dir = new URL('../../migrations/', import.meta.url);
    let sql = '';
    for (const f of (await readdir(dir)).filter((x) => x.endsWith('.sql')).sort()) {
      const text = await readFile(new URL(f, dir), 'utf8');
      if (text.includes('add constraint conversation_signals_kind_check')) sql = text;
    }
    expect(sql).not.toBe('');
    const signalCheck = sql.slice(
      sql.lastIndexOf('conversation_signals_kind_check'), sql.indexOf('alter table escalation_events'));
    for (const k of PROBLEM_SIGNAL_KINDS) expect(signalCheck, k).toContain(`'${k}'`);
    const reasonCheck = sql.slice(sql.lastIndexOf('escalation_events_trigger_reason_check'));
    for (const r of TRIGGER_REASONS) expect(reasonCheck, r).toContain(`'${r}'`);
  });

  it('Today and the inbox read that list rather than keeping copies', async () => {
    for (const f of ['pilot.ts', 'inbox.ts']) {
      const src = await readFile(new URL(`../../src/api/web/${f}`, import.meta.url), 'utf8');
      expect(src, f).toContain('PROBLEM_SIGNAL_KINDS');
      expect(src, `${f} must not hand-list the kinds again`).not.toMatch(/'repeated_ambiguity',\s*'low_confidence_image'/);
    }
  });
});

const detail = (over: Partial<ConversationDetail> = {}): ConversationDetail => ({
  conversationId: 'conv-1', buyer: 'Ahmed', country: 'AE', status: 'awaiting',
  product: { name: 'Vacuum cup', nameZh: '保温杯' }, quantity: null,
  quote: null, order: null, messages: [], pendingDraft: null,
  ownership: 'WAITING_HUMAN', refusals: [], handoffReasons: ['media_unreadable'],
  unheardReason: null, unreadable: 'document', lastHumanAction: null, knowledgeUsed: [],
  rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
  ...over,
});

describe('G2c · the owner is told what arrived, in her language', () => {
  for (const locale of LOCALES) {
    it(`${locale}: the card names the thing and says what to do`, () => {
      const html = renderConversationDetail(detail(), locale, NOW, null);
      expect(html).toContain(t(locale, 'unreadable.title'));
      expect(html).toContain(t(locale, 'unreadable.what', {
        name: EMPLOYEE_NAME[locale], what: t(locale, 'received.document'),
      }).replace(/&/g, '&amp;'));
      expect(html).toContain(t(locale, 'unreadable.do'));
    });
  }

  it('the file shows in the timeline as a file, with his caption as his words', () => {
    const html = renderConversationDetail(detail({
      messages: [{ direction: 'inbound', text: 'RFQ attached', at: null, received: 'document' }],
    }), 'en', NOW, null);
    const bubble = html.slice(html.indexOf('📎'), html.indexOf('RFQ attached') + 40);
    expect(bubble).toContain(t('en', 'received.document'));
    expect(bubble).toContain('class="said"');
  });

  it('with nothing unreadable, there is no card', () => {
    const html = renderConversationDetail(detail({ unreadable: null, handoffReasons: [], quote: { unitPrice: usd(1), total: usd(1), quantity: 1 } }), 'en', NOW, null);
    expect(html).not.toContain(t('en', 'unreadable.title'));
  });
});
