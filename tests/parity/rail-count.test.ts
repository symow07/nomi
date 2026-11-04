import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderInboxList, type InboxList, type ConversationSummary } from '../../src/api/web/inbox.js';
import { shell } from '../../src/api/web/layout.js';
import { railFigure } from '../../src/api/web/values.js';
import { railSaid } from '../../src/api/web/live.js';
import { withWorkspace } from '../../src/api/web/say.js';
import { messages, t } from '../../src/core/owner/i18n/messages.js';
import { withZone } from '../../src/api/web/zone.js';
import { linkedCss } from './linked-css.js';
import { withoutIsolates } from './isolates.js';

/**
 * THE OWNER'S NOTIFICATIONS (2026-11-04). No "3 waiting" pill: a small wine count beside Customers, hidden at nothing,
 * "9+" above nine; a dot at the start of each row that needs you; its name bold until it is opened. And a name is cut at
 * its end in either direction, because the element that cuts takes its direction from the name.
 */

const SCOPE = { name: null, several: false, outreach: true, setup: null, business: 'Atlas', zone: 'UTC' };
const page = (needsYou: number, split = false) => withWorkspace({ ...SCOPE, needsYou }, () =>
  shell({ title: 'T', active: 'inbox', locale: 'en', path: '/app/inbox', bodyHtml: '', ...(split ? { split: { me: 'p-1' } } : {}) }));
const CSS = linkedCss(page(1));
const ruleOf = (sel: string): string => new RegExp(`(?:^|[\\s}])${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`).exec(CSS)?.[1] ?? '';

const conv = (id: string, over: Partial<ConversationSummary>): ConversationSummary => ({
  conversationId: id, buyer: `Customer ${id}`, country: 'AE', status: 'handled', needsAction: false, ownership: 'AI', heldBy: null,
  awaitingReview: false, handoffReason: null, deletionWaiting: false, latestMessage: 'hello', latestAt: new Date('2026-11-04T09:00:00Z'),
  product: { name: 'Rose Serum', nameZh: null }, quantity: null, unitPrice: null, channel: 'whatsapp', unanswered: false, lastFrom: 'assistant', ...over,
} as ConversationSummary);
const LIST = (conversations: ConversationSummary[]): InboxList =>
  ({ filter: 'all', lens: 'waiting', waitingCount: 1, blockedCount: 0, conversations, query: '' } as unknown as InboxList);
const rows = (conversations: ConversationSummary[]) => withWorkspace({ ...SCOPE, needsYou: 0 }, () => withZone('UTC', () =>
  renderInboxList(LIST(conversations), 'en', new Date('2026-11-04T10:00:00Z'))));
const rowHtml = (h: string, id: string): string => {
  const at = h.indexOf(`href="/app/inbox/${id}#latest"`);
  return h.slice(h.lastIndexOf('<div class="irow', at), h.indexOf('</a></div>', at));
};
const WAITS = { ownership: 'WAITING_HUMAN', heldBy: 'unclaimed', handoffReason: 'human_requested' } as const;

describe('the rail\'s count', () => {
  it('is the figure, and "9+" above nine', () => {
    expect(withoutIsolates(railFigure('en', 1))).toBe('1');
    expect(withoutIsolates(railFigure('en', 9))).toBe('9');
    expect(withoutIsolates(railFigure('en', 10))).toBe('9+');
    expect(railFigure('ar', 12)).toBe('\u20689+\u2069');
  });

  it('on the plain rail and the Split rail: hidden at nothing, capped on the page, the true number spoken', () => {
    for (const split of [false, true]) {
      expect(page(0, split)).not.toContain('navcount"');
      const ten = withoutIsolates(page(10, split));
      expect(ten).toContain('<span class="navcount" aria-hidden="true">9+</span>');
      expect(ten).toContain('10 customers need you');
      expect(ten).not.toContain('nl-long');
    }
  });

  it('a live update says the same', () => {
    const said = railSaid('en', { n: 12, at: 1 } as Parameters<typeof railSaid>[1]);
    expect(withoutIsolates(said.shown)).toBe('9+');
    expect(said.label).toContain('12 customers need you');
    expect(said).not.toHaveProperty('words');
  });

  it('is wine under a white figure, on every rail', () => {
    const rule = ruleOf('nav.side .navcount');
    expect(rule).toContain('background:var(--color-coin)');
    expect(rule).toContain('color:var(--color-surface)');
    expect(CSS).toMatch(/--color-coin:\s*#5A0A2E/i);
    expect(CSS).not.toMatch(/navcount::before/);
    expect(readFileSync('src/api/web/splitStyle.ts', 'utf8')).not.toContain('navcount');
  });
});

describe('a row that needs you', () => {
  const h = rows([
    conv('a', { ...WAITS, unopened: true }),
    conv('b', { ...WAITS, unopened: false }),
    conv('c', { unopened: true }),
  ]);

  it('has one dot, at its start, and a row that does not has none', () => {
    const a = rowHtml(h, 'a');
    expect(a.match(/class="row-dot"/g)).toHaveLength(1);
    expect(a.indexOf('row-dot')).toBeLessThan(a.indexOf('ir-main'));
    expect(rowHtml(h, 'b').match(/class="row-dot"/g)).toHaveLength(1);
    expect(rowHtml(h, 'c')).not.toContain('row-dot');
  });

  it('is bold until it is opened; bold says nothing else', () => {
    expect(rowHtml(h, 'a')).toContain('is-new');
    expect(rowHtml(h, 'a')).toContain('<span class="sr">Not opened yet</span>');
    expect(rowHtml(h, 'b')).not.toContain('is-new');
    expect(rowHtml(h, 'c')).not.toContain('is-new');   // unopened, but nothing asks for the owner
    expect(ruleOf('.irow.is-new .ir-name')).toContain('font-weight:700');
    expect(CSS).not.toContain('.irow.unanswered .ir-name');
    expect(CSS).not.toContain('.crow.unanswered .cr-name');
  });

  it('keeps its reason in words: the dot is never alone', () => {
    expect(rowHtml(h, 'a')).toContain('class="ir-wait"');
  });
});

describe('a long name in either direction', () => {
  it('the element that cuts is itself the isolate, so it reads its own direction', () => {
    const h = rows([conv('a', { buyer: 'Bartholomew Featherstonehaugh-Cholmondeley' })]);
    expect(rowHtml(h, 'a')).toContain('<bdi class="ir-name">Bartholomew');
    expect(ruleOf('.ir-name')).toContain('text-overflow:ellipsis');
  });

  it('a name that is cut is never a <span dir="auto"> around a <bdi>: dir="auto" reads past it, and finds no words', () => {
    const wrong = readdirSync('src/api/web').filter((f) => f.endsWith('.ts'))
      .filter((f) => /<(?!bdi\b)\w+ class="(?:ir|cr|ar|tw)-name"|<(?!bdi\b)\w+ class="sp-rname"/.test(readFileSync(join('src/api/web', f), 'utf8')));
    expect(wrong).toEqual([]);
  });
});

describe('the page is "Customers", in every word for it (the owner, 2026-11-05)', () => {
  it('the rail, the phone tab, the page title and the way back all say it', () => {
    for (const l of ['en', 'zh', 'ar', 'es', 'fr'] as const) {
      for (const k of ['nav.inbox', 'nav.conversations', 'nav.short.inbox', 'inbox.detail.back'] as const) {
        expect(t(l, k), `${l} ${k}`).toBe(t(l, 'nav.customers'));
      }
    }
  });

  it('no sentence sends the owner to a page by its old name', () => {
    const old = { en: /\bInbox\b/, zh: /收件箱里|「收件箱」/, ar: /«الرسائل»|صندوق الوارد\b(?! الخاص)/, es: /(?:en|a) Mensajes\b|Bandeja de entrada/, fr: /dans Messages\b|Boîte de réception/ } as const;
    for (const l of ['en', 'zh', 'ar', 'es', 'fr'] as const) {
      const hits = Object.entries(messages[l]).filter(([, v]) => old[l].test(String(v))).map(([k]) => k);
      expect(hits, l).toEqual([]);
    }
  });
});
