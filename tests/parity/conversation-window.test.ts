import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TRANSCRIPT_WINDOW, encodeCursor, parseCursor } from '../../src/db/transcript.js';
import { renderConversationDetail, type ConversationDetail, type TimelineMessage } from '../../src/api/web/inbox.js';
import { renderSandbox, type SandboxView } from '../../src/api/web/sandbox.js';
import { usd } from '../../src/core/types/money.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * CC-25 — the transcript window's cursor and the page it draws (2026-09-27).
 * The window itself, over Postgres and 450 messages, is
 * tests/integration/conversation-window.test.ts; this holds what needs no
 * database: the cursor's shape, both ways, and what each window shows.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (f: string) => readFileSync(`${ROOT}${f}`, 'utf8');
const ID = '0b5e7c1a-2f3d-4e8a-9c6b-1d2e3f4a5b6c';
const CONV = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-09-27T10:00:00Z');

describe('CC-25 · the cursor', () => {
  it('the window is fifty', () => {
    expect(TRANSCRIPT_WINDOW).toBe(50);
  });

  it('round-trips: what it writes, it reads back exactly — and nothing a URL must encode', () => {
    for (const at of [
      new Date('2026-09-27T10:15:30.123Z'), new Date('2026-01-01T00:00:00.000Z'),
      new Date(0), new Date('2099-12-31T23:59:59.999Z'), new Date(8_640_000_000_000_000),
      // a mail's own date header is its stamp; one before 1970 must still page back, not loop
      new Date('1969-07-20T20:17:40.001Z'), new Date(-8_640_000_000_000_000),
    ]) {
      const c = encodeCursor({ sentAt: at, id: ID });
      expect(parseCursor(c)).toEqual({ at: at.getTime(), id: ID });
      expect(encodeCursor({ sentAt: new Date(parseCursor(c)!.at), id: parseCursor(c)!.id })).toBe(c);
      expect(c).toMatch(/^[0-9a-f_-]+$/);
      expect(encodeURIComponent(c)).toBe(c);   // so no `%` reaches an href
    }
  });

  it('refuses anything that is not exactly that shape — which the page reads as the newest window', () => {
    const ms = '1790000000123';
    for (const raw of [
      '', 'garbage', ms, `${ms}_`, `_${ID}`, `${ms}__${ID}`, `${ms}-${ID}`, `${ms}_${ID}x`, `x${ms}_${ID}`,
      ` ${ms}_${ID}`, `${ms}_${ID} `, `${ms}_${ID}\n`,
      `0${ms}_${ID}`, `-0${ms}_${ID}`, `-0_${ID}`,      // a leading zero, a signed zero: not the form it writes
      `+${ms}_${ID}`, `--${ms}_${ID}`, `${ms}.5_${ID}`, `1e12_${ID}`, `0x1f_${ID}`,
      `${ms}_${ID.toUpperCase()}`,                      // it writes lowercase
      `${ms}_${ID.replace(/-/g, '')}`, `${ms}_{${ID}}`, `${ms}_${ID.slice(0, 35)}`,
      `99999999999999999_${ID}`,                        // seventeen digits
      `9007199254740993_${ID}`,                         // past what a number holds exactly
      `8640000000000001_${ID}`, `-8640000000000001_${ID}`,   // past the last instant a Date can hold
      `${ms}%5F${ID}`, encodeURIComponent(`${ms}_${ID}'; drop table messages; --`),
    ]) {
      expect(parseCursor(raw), JSON.stringify(raw)).toBeNull();
    }
    for (const raw of [undefined, null, 1790000000123, [`${ms}_${ID}`], { at: 1, id: ID }, true]) {
      expect(parseCursor(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it('the next window is bounded by the message ROW, never by the cursor’s milliseconds; ties go to the id', () => {
    const src = read('src/db/transcript.ts');
    expect(src).toMatch(/order by m\.sent_at desc, m\.id desc/);
    expect(src).toMatch(/\(m\.sent_at, m\.id\) < \(\s*select a\.sent_at, a\.id from messages a\s*where a\.id = \$\{cursor\.id\}::uuid and a\.conversation_id = \$\{conversationId\}::uuid\)/);
    expect(src).toContain('limit ${TRANSCRIPT_WINDOW + 1}');
    expect(src).not.toMatch(/\boffset\s+\$\{/i);   // keyset, never an offset that shifts as messages arrive
  });

  it('both transcript pages read the one window; neither reads the oldest two hundred', () => {
    expect(read('src/api/web/inbox.ts')).toContain('loadTranscriptWindow(tx, head.id, before)');
    expect(read('src/api/web/sandbox.ts')).toContain('loadTranscriptWindow(tx, conversationId, before)');
    for (const f of ['src/api/web/inbox.ts', 'src/api/web/sandbox.ts', 'src/api/web/conversations.ts']) {
      expect(read(f), f).not.toMatch(/order by (m\.)?sent_at asc limit/);
    }
  });
});

const msgs = (n: number, from = 1): TimelineMessage[] => Array.from({ length: n }, (_, i) => ({
  direction: (from + i) % 2 === 1 ? 'inbound' : 'outbound', text: `m-${String(from + i).padStart(3, '0')}`,
  at: new Date(NOW.getTime() - (n - i) * 60_000),
}));

const detail = (over: Partial<ConversationDetail> = {}): ConversationDetail => ({
  conversationId: CONV, buyer: 'Ahmed', country: 'AE', status: 'awaiting',
  product: { name: null, nameZh: null }, quantity: null,
  quote: { unitPrice: usd(0.92), total: usd(4600), quantity: 5000 }, order: null,
  messages: msgs(50, 401), transcript: { earlier: `1790000000123_${ID}`, older: false },
  pendingDraft: { draftId: 'd-1', draftText: 'For 5,000 pcs: $0.92/pc FOB Ningbo.', capability: 'quote' },
  ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [], unheardReason: 'transcription_failed',
  lastHumanAction: null, knowledgeUsed: ['Lead time'], rate: null, leadTimeBlocked: null, sampleAsked: null,
  proof: { quoteId: null, token: null }, ...over,
});

describe('CC-25 · the conversation page', () => {
  it('the newest window: the door back at the top, the newest message marked, the approval under it, the rest after', () => {
    const html = renderConversationDetail(detail(), 'en', NOW, null);
    const door = html.indexOf(`href="/app/inbox/${CONV}?before=1790000000123_${ID}#latest"`);
    const first = html.indexOf('<bdi>m-401</bdi>');
    const newest = html.indexOf('<bdi>m-450</bdi>');
    const marked = html.indexOf('id="latest"');
    const draft = html.indexOf('class="card draft"');
    const own = html.indexOf('class="card takeover');
    const unheard = html.indexOf(t('en', 'unheard.title'));
    const knew = html.indexOf('class="block knew"');
    const ctx = html.indexOf('class="ctx"');
    expect(door).toBeGreaterThan(-1);
    expect(html).toContain(t('en', 'inbox.log.earlier'));
    expect(door).toBeLessThan(first);
    expect(first).toBeLessThan(newest);
    expect(marked).toBeLessThan(newest);
    expect(html.indexOf('id="latest"', marked + 1)).toBe(-1);   // one mark
    expect(newest).toBeLessThan(draft);
    expect(draft).toBeLessThan(own);
    expect(own).toBeLessThan(unheard);                          // what went wrong follows what to do
    // while a reply waits, what it leaned on is one of the card's reasons, not a section after
    expect(knew).toBe(-1);
    expect(unheard).toBeLessThan(ctx);
    expect(html).not.toContain(t('en', 'inbox.log.latest'));    // already there
  });

  it('a window further back: the way home, and nothing to act on', () => {
    const html = renderConversationDetail(detail({ messages: msgs(50, 351), transcript: { earlier: `1790000000000_${ID}`, older: true } }), 'en', NOW, null);
    expect(html).toContain(`href="/app/inbox/${CONV}#latest"`);
    expect(html).toContain(t('en', 'inbox.log.latest'));
    expect(html).toContain(`?before=1790000000000_${ID}#latest`);
    expect(html).toMatch(/id="latest" class="msg (?:inbound|outbound)">\s*<div dir="auto" class="bubble(?: by-as)?"><bdi>m-400<\/bdi>/);
    for (const gone of ['class="card draft"', 'class="card takeover', 'class="ctx"', 'class="block knew"', t('en', 'unheard.title'), 'class="as-hand"']) {
      expect(html, gone).not.toContain(gone);
    }
    // the first window of all has no door back
    const first = renderConversationDetail(detail({ messages: msgs(50, 1), transcript: { earlier: null, older: true } }), 'en', NOW, null);
    expect(first).not.toContain('?before=');
    expect(first).toContain(t('en', 'inbox.log.latest'));
  });

  it('"No messages yet" only where it is true', () => {
    const none = renderConversationDetail(detail({ messages: [], transcript: { earlier: null, older: false } }), 'en', NOW, null);
    expect(none).toContain(t('en', 'inbox.detail.noMessages'));
    expect(none).not.toContain('id="latest"');
    // every message of the newest fifty was a reaction, left out: there IS more
    const filtered = renderConversationDetail(detail({ messages: [], transcript: { earlier: `1790000000123_${ID}`, older: false } }), 'en', NOW, null);
    expect(filtered).not.toContain(t('en', 'inbox.detail.noMessages'));
    expect(filtered).toContain('?before=');
  });

  it('a detail built before CC-25 (no transcript field) reads as the newest window with nothing before it', () => {
    const { transcript: _, ...old } = detail();
    const html = renderConversationDetail(old, 'en', NOW, null);
    expect(html).not.toContain('?before=');
    expect(html).not.toContain(t('en', 'inbox.log.latest'));
    expect(html).toContain('class="card draft"');
  });

  it('every locale names both doors in its own words; Arabic mirrors their chevrons', () => {
    for (const l of LOCALES) {
      const newest = renderConversationDetail(detail(), l, NOW, null);
      const older = renderConversationDetail(detail({ transcript: { earlier: `1790000000000_${ID}`, older: true } }), l, NOW, null);
      expect(newest, l).toContain(t(l, 'inbox.log.earlier'));
      expect(older, l).toContain(t(l, 'inbox.log.latest'));
      // doors, never buttons: a link that changes the page is a door
      expect(newest, l).toMatch(/<a class="back" href="\/app\/inbox\/[^"]+\?before=[^"]+#latest"><span class="go" aria-hidden="true">‹<\/span>/);
      expect(older, l).toMatch(/<a class="deeper" href="\/app\/inbox\/[^"]+#latest">[^<]+<span class="go" aria-hidden="true">›<\/span><\/a>/);
    }
    expect(t('ar', 'inbox.log.earlier')).not.toBe(t('en', 'inbox.log.earlier'));
    expect(t('ar', 'inbox.log.latest')).not.toBe(t('en', 'inbox.log.latest'));
  });
});

describe('CC-25 · the practice page reads the same window', () => {
  const view = (over: Partial<SandboxView> = {}): SandboxView => ({
    hasConversation: true, lastTurn: null, ownership: 'AI',
    messages: Array.from({ length: 50 }, (_, i) => ({ direction: i % 2 ? 'outbound' : 'inbound', text: `p-${i + 1}`, isImage: false })),
    transcript: { earlier: `1790000000123_${ID}`, older: false }, ...over,
  });

  it('the door back pages Practice back; the newest line is marked', () => {
    const html = renderSandbox(view(), 'en', { flash: null });
    expect(html).toContain(`href="/app/sandbox?before=1790000000123_${ID}#latest"`);
    expect(html).toMatch(/id="latest" class="msg (?:inbound|outbound)">\s*<div dir="auto" class="bubble(?: by-as)?"><bdi>p-50<\/bdi>/);
    expect(html).not.toContain(t('en', 'inbox.log.latest'));
    const older = renderSandbox(view({ transcript: { earlier: null, older: true } }), 'en', { flash: null });
    expect(older).toContain('href="/app/sandbox#latest"');
    expect(older).not.toContain('before=');
  });
});
