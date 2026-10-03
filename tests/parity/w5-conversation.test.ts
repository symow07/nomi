import { describe, it, expect } from 'vitest';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { usd } from '../../src/core/types/money.js';
import { esc } from '../../src/api/web/layout.js';
import { withAssistantName } from '../../src/api/web/say.js';
import { renderConversationDetail, type ConversationDetail } from '../../src/api/web/inbox.js';
import * as show from '../../src/api/web/values.js';
import type { CatchUp } from '../../src/db/catchUp.js';
import { conversationDetail } from './fixtures.js';

/**
 * THE WARMTH RUN, phase 9 — the fix wave for a conversation, the draft card,
 * the customer's file and Practice (`docs/UI-AUDIT.md` §5). Each block names
 * the finding it holds; each fails without its fix.
 */

const NOW = new Date('2026-10-03T19:50:00Z');
const MIN = 60_000;
const DAY = 86_400_000;
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);
const CLIENT = 'c1c1c1c1-0000-4000-8000-000000000002';
const plain = (s: string): string => s.replace(/[⁦-⁩]/g, '');

const rows = (over: Partial<CatchUp> = {}): CatchUp => ({
  clientId: CLIENT, channel: 'whatsapp', address: '5511900000001', photo: null,
  value: { clientId: CLIENT, spent: null, orders: 0, lastOrderAt: null, regular: false, quietSince: null },
  bought: [], boughtMore: 0, askedAbout: null, lastOrder: null,
  quoteSentAt: null, lastFromThemAt: null, lastMessage: null, ...over,
});
const detail = (over: Partial<ConversationDetail> = {}, catchUp: Partial<CatchUp> = {}): ConversationDetail => conversationDetail({
  buyer: 'Carlos Mendes', country: 'BR', channel: 'whatsapp', status: 'handled', pendingDraft: null, ownership: 'AI',
  product: { name: 'LED String Lights 10m', nameZh: 'LED灯串' }, quantity: 2000,
  catchUp: rows(catchUp), ...over,
});
const page = (d: ConversationDetail, l: Locale): string =>
  plain(withAssistantName('Mira', () => renderConversationDetail(d, l, NOW, null)));
const strip = (html: string): string => /<header class="catchup[^"]*">[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
const facts = (html: string): string => /<p class="cu-facts">[\s\S]*?<\/p>/.exec(strip(html))?.[0] ?? '';
const stateLine = (html: string): string => /<p class="cu-state">[\s\S]*?<\/p>/.exec(strip(html))?.[0] ?? '';

describe('w4-conversation-05, -13 · the strip says what they asked about, that nothing was bought, and that a quote waits', () => {
  it('Carlos: quoted at 15:21, asked "What plug type?" at 15:56, answered at 16:31 — the quote still waits on him', () => {
    const carlos = detail({}, {
      quoteSentAt: ago(4 * 60 * MIN + 29 * MIN), lastFromThemAt: ago(3 * 60 * MIN + 54 * MIN),
      lastMessage: { from: 'assistant', at: ago(3 * 60 * MIN + 19 * MIN) },
    });
    for (const l of LOCALES) {
      const html = page(carlos, l);
      expect(stateLine(html), l).toContain(`<b>${esc(t(l, 'catchup.state.quoted'))}</b>`);
      expect(stateLine(html), l).not.toContain(esc(t(l, 'catchup.state.last')));
      const f = facts(html);
      expect(f, l).toContain('<bdi>' + (l === 'zh' ? 'LED灯串' : 'LED String Lights 10m') + '</bdi>');
      expect(f, l).toContain(`<bdi class="fig">${plain(show.quantityOf(l, 2000, t(l, 'product.unit.pcs')))}</bdi>`);
      expect(f, l).toContain(esc(t(l, 'catchup.none')));
    }
  });

  it('an order after the quote answers it: the state moves on, and the strip says what they bought and spent', () => {
    const bought = detail({ product: { name: 'Stainless Steel Thermos 500ml', nameZh: '保温杯' }, quantity: 5000 }, {
      quoteSentAt: ago(9 * DAY), lastOrder: { reference: 'USAB-de300000-0001', confirmedAt: ago(2 * DAY) },
      bought: [{ name: 'Stainless Steel Thermos 500ml', nameZh: '保温杯', orders: 1 }],
      value: { clientId: CLIENT, spent: usd(11750), orders: 1, lastOrderAt: ago(2 * DAY), regular: false, quietSince: null },
    });
    for (const l of LOCALES) {
      const html = page(bought, l);
      expect(stateLine(html), l).toContain(`<b>${esc(t(l, 'catchup.state.ordered'))}</b>`);
      expect(stateLine(html), l).toContain('<bdi class="fig">USAB-de300000-0001</bdi>');
      // w4-conversation-15 — the product they bought is said once: no "asked about" for it, no line under the strip
      const name = l === 'zh' ? '保温杯' : 'Stainless Steel Thermos 500ml';
      expect(strip(html).split(`<bdi>${name}</bdi>`).length - 1, l).toBe(1);
      expect(html, l).not.toContain('class="muted subline"');
      expect(facts(html), l).not.toContain(esc(t(l, 'catchup.none')));
    }
  });

  it('bought one thing and now asking about another: both, each labelled', () => {
    const html = page(detail({}, {
      bought: [{ name: 'Stainless Steel Thermos 500ml', nameZh: '保温杯', orders: 2 }],
      value: { clientId: CLIENT, spent: usd(23500), orders: 2, lastOrderAt: ago(40 * DAY), regular: false, quietSince: null },
    }), 'en');
    const f = facts(html);
    expect(f.indexOf('Bought')).toBeLessThan(f.indexOf('Asked about'));
    expect(f).toContain('<bdi>LED String Lights 10m</bdi>');
    expect(f).toContain('spent');
  });
});

describe('the owner\'s deletion form names the profile photo, as the privacy page does', () => {
  it('in five languages, beside who they are on every channel', () => {
    const words: Record<Locale, RegExp> = {
      en: /their profile photo as Instagram or Messenger showed it to the business/,
      zh: /Instagram 或 Messenger 上的头像/,
      ar: /صورة الملف الشخصي كما ظهرت للشركة على إنستغرام أو ماسنجر/,
      es: /su foto de perfil tal como Instagram o Messenger se la mostraba al negocio/,
      fr: /sa photo de profil telle qu’Instagram ou Messenger la montrait à l’entreprise/,
    };
    for (const l of LOCALES) {
      expect(t(l, 'conv.deletion.erased'), l).toMatch(words[l]);
      expect(t(l, 'conv.deletion.erased'), l).not.toMatch(/WhatsApp/);
    }
  });
});
