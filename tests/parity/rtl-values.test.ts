import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as show from '../../src/api/web/values.js';
import { t, tn } from '../../src/api/web/say.js';
import { renderOperationsHome, type OperationsSnapshot } from '../../src/api/web/operations.js';
import { renderInboxList, type ConversationSummary } from '../../src/api/web/inbox.js';
import type { TodayData } from '../../src/api/web/today.js';
import { t as plain } from '../../src/core/owner/i18n/messages.js';
import { usd } from '../../src/core/types/money.js';
import { unisolatedFigures } from './isolates.js';

/**
 * RIGHT TO LEFT, BY DESIGN (the design pass §9, 2026-09-30) — the parts that
 * need no database: the reader the test uses, the value functions, the one
 * layer every page takes its values from. Every owner page in Arabic over real
 * rows: tests/integration/surface-walk.test.ts.
 */

const FSI = '\u2068';
const PDI = '\u2069';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('the reader: a figure outside an isolate is found, one inside is not', () => {
  it('finds a price, a count and a sign standing in the words', () => {
    expect(unisolatedFigures('<p>السعر 1.95 US$ للقطعة</p>')).toHaveLength(3);   // 1, 95 and the sign
    expect(unisolatedFigures('<p>٣ رسائل</p>')).toHaveLength(1);   // Arabic-Indic digits too
    // the page's own direction is not an isolate
    expect(unisolatedFigures('<html lang="ar" dir="rtl"><body><p>5 رسائل</p></body></html>')).toHaveLength(1);
  });

  it('leaves alone a <bdi>, dir="auto" or "ltr", the isolate marks, attributes, scripts and the head', () => {
    for (const html of [
      '<p>السعر <bdi>1.95 US$</bdi></p>',
      `<p>السعر ${FSI}1.95 US$${PDI}</p>`,
      `<p>${FSI}${FSI}5${PDI} من ${FSI}9${PDI}${PDI}</p>`,
      '<div dir="auto" class="bubble">I need 500 pcs</div>',
      '<code dir="ltr">0x1f</code>',
      '<a href="/app/inbox/123?page=2" title="5">افتح</a>',
      '<script>var n = 5;</script><style>.a{margin:4px}</style>',
      '<head><title>2 رسائل</title></head>',
      '<textarea>12 x 40cm</textarea>',
    ]) expect(unisolatedFigures(html), html).toEqual([]);
  });
});

describe('the value functions', () => {
  it('Arabic: the locale\'s own form, Western digits, isolated', () => {
    // The sign is a left-to-right word of its own inside the value: without
    // it the browser drew "$US 1.95".
    expect(show.money('ar', usd(1.95))).toBe(`${FSI}\u200F1.95\u00A0\u2066US$${PDI}${PDI}`);
    expect(show.money('ar', { amount: 2.4, currency: 'CNY' })).toBe(`${FSI}\u200F2.40\u00A0\u2066CN¥${PDI}${PDI}`);
    expect(show.quantityOf('ar', 5000, 'قطعة')).toBe(`${FSI}5,000\u00A0قطعة${PDI}`);
    expect(show.phone('ar', '+971501234567')).toBe(`${FSI}+971501234567${PDI}`);
    expect(show.date('ar', new Date('2026-09-29T08:00:00Z'))).toBe(`${FSI}الثلاثاء، 29 سبتمبر${PDI}`);
    expect(show.count('ar', 12000)).toBe(`${FSI}12,000${PDI}`);
  });

  it('left to right: exactly what the pages always said, nothing added', () => {
    expect(show.money('en', usd(1.95))).toBe('$1.95');
    expect(show.money('zh', usd(1.95))).toBe('$1.95');
    expect(show.quantityOf('zh', 12000, '个')).toBe('1.2万个');
    expect(show.phone('en', '+971501234567')).toBe('+971501234567');
  });

  it('a value already isolated is not isolated twice', () => {
    const once = show.money('ar', usd(3));
    expect(show.isolate('ar', once)).toBe(once);
  });
});

describe('sentences: every figure in them isolated, right to left', () => {
  it('a counted sentence, a value put in, and the catalogue\'s own numbers', () => {
    const counted = tn('ar', 'today.blocked', 3);
    expect(unisolatedFigures(`<p>${counted}</p>`)).toEqual([]);
    const withPrice = t('ar', 'samples.current.paid', { price: show.money('ar', usd(5)) });
    expect(unisolatedFigures(`<p>${withPrice}</p>`)).toEqual([]);
    // "{done}/{total}" reads as one figure, not two
    expect(show.isolateFigures('ar', 'الإعداد 1/5')).toBe(`الإعداد ${FSI}1/5${PDI}`);
  });

  it('English and Chinese sentences are the catalogue\'s, unchanged', () => {
    expect(tn('en', 'today.blocked', 3)).toBe(plain('en', 'today.blocked.other', { n: '3' }));
    expect(t('zh', 'samples.current.paid', { price: '$5.00' })).toBe(plain('zh', 'samples.current.paid', { price: '$5.00' }));
  });
});

describe('pages, in Arabic, from fixtures', () => {
  const NOW = new Date('2026-09-29T08:00:00Z');
  const row = (o: Partial<ConversationSummary>): ConversationSummary => ({
    conversationId: 'c-1', buyer: 'Maya 2', country: 'AE', status: 'awaiting', needsAction: true,
    ownership: 'AI', heldBy: null, awaitingReview: true, handoffReason: null,
    latestMessage: 'I need 500 pcs', latestAt: new Date('2026-09-29T07:40:00Z'),
    product: { name: 'Tote 38x40cm', nameZh: null }, quantity: 20000, unitPrice: usd(0.38), ...o,
  });
  const snapshot: OperationsSnapshot = {
    range: 'today',
    attention: { pendingApprovals: 1, handoffs: 1, ownerHandling: 0, blockedMessages: 2, deletionAsks: 1 },
    activity: { handled: 9, draftsCreated: 3, corrections: 1 },
    knowledge: { openGaps: 4, recentCorrections: 0, recentlyTaught: 0 },
    channel: { status: 'connected', provider: 'meta', live: true }, budget: { pctUsed: 84, stops: true, reached: false, renewsAt: new Date('2026-09-30T00:00:00Z') },
    hasAttention: true,
  };
  const today: TodayData = {
    now: NOW, needs: { total: 12, rows: [row({})] },
    // The warmth run — the hero (+N more past 60 faces) and the three figures, every figure isolated too.
    handled: { total: 140, people: [{ conversationId: 'h1', clientId: '44444444-4444-4444-8444-444444444444', name: 'Ana', photo: null, word: 'confirmed' }] },
    tally: { orders: 12, quotes: 5, afterHours: 3 }, sending: ['whatsapp'],
  };

  it('Today', () => {
    expect(unisolatedFigures(renderOperationsHome(snapshot, 'ar', today))).toEqual([]);
  });

  it('the Buyers list', () => {
    const html = renderInboxList({ filter: 'pending', waitingCount: 12, blockedCount: 2, conversations: [row({}), row({ conversationId: 'c-2', awaitingReview: false, ownership: 'WAITING_HUMAN' })] }, 'ar', NOW);
    expect(unisolatedFigures(html)).toEqual([]);
  });
});

describe('one layer', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });

  it('pages take their values from values.ts, never the display formatters directly', () => {
    const DISPLAY = /\b(formatMoney|formatMoneyCompact|formatQty|formatQtyUnit|withUnit|formatDate|formatDayLong|formatTime|formatRelative|formatShortWhen|formatUntil|formatTimeLeft|formatMonth)\b/;
    const offenders = files(path.join(ROOT, 'src/api/web'))
      .filter((p) => !p.endsWith('values.ts'))
      .filter((p) => {
        const src = readFileSync(p, 'utf8');
        return [...src.matchAll(/import \{([^}]*)\} from '[./]+core\/owner\/(?:i18n\/)?format\.js'/g)].some((m) => DISPLAY.test(m[1]!));
      })
      .map((p) => path.relative(ROOT, p));
    expect(offenders).toEqual([]);
  });

  it('no invisible direction character is written into the source — they are escaped (\\u2068), so a reader sees them', () => {
    const LITERAL = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/;
    const offenders = [...files(path.join(ROOT, 'src')), ...files(path.join(ROOT, 'tests'))]
      .filter((p) => LITERAL.test(readFileSync(p, 'utf8')))
      .map((p) => path.relative(ROOT, p));
    expect(offenders).toEqual([]);
  });
});
