import { describe, it, expect } from 'vitest';
import { renderHome, type HomeData } from '../../src/api/web/home.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

const populated: HomeData = {
  greeting: 'morning',
  today: { inquiries: 12, replied: 9, waiting: 3, closed: 1 },
  pending: [
    { conversationId: 'c1', buyer: 'Ahmed', countryCode: 'AE', product: { name: 'Vacuum Cup', nameZh: '保温杯' }, quantity: 5000, unitPriceUsd: 0.92 },
    { conversationId: 'c2', buyer: 'Sara', countryCode: null, product: { name: null, nameZh: null }, quantity: null, unitPriceUsd: null },
  ],
  employee: { status: 'night', weekHandled: 28, weekEdits: 3, learningUpdated: true },
  events: [{ kind: 'quote_sent', buyer: 'Ahmed' }, { kind: 'buyer_image', buyer: 'Fatima' }],
  allNormal: false,
};

const empty: HomeData = {
  greeting: 'evening',
  today: { inquiries: 0, replied: 0, waiting: 0, closed: 0 },
  pending: [], employee: { status: 'learning', weekHandled: 0, weekEdits: 0, learningUpdated: false },
  events: [], allNormal: true,
};

const width = (line: string): number =>
  [...line].reduce((w, ch) => w + ((ch.codePointAt(0) ?? 0) > 0xff ? 2 : 1), 0);

describe('M9.2 · owner home dashboard (localized renderer)', () => {
  it('zh: greeting, summary, stats, pending (prefers name_zh), status, events', () => {
    const html = renderHome(populated, 'zh');
    expect(html).toContain('早上好');
    expect(html).toContain('小雅的今日总结');
    expect(html).toContain('>12<'); expect(html).toContain('>9<'); expect(html).toContain('>3<');
    expect(html).toContain('询盘'); expect(html).toContain('成交');
    expect(html).toContain('等你处理');
    expect(html).toContain('保温杯');          // zh picks name_zh
    expect(html).toContain('5000'); expect(html).toContain('$0.92');
    expect(html).toContain('href="/app/inbox/c1"');
    expect(html).toContain('Sara');
    expect(html).toContain('小雅工作状态'); expect(html).toContain('夜班中');
    expect(html).toContain('28 个询盘'); expect(html).toContain('你修改过'); expect(html).toContain('已更新');
    expect(html).toContain('重要动态');
    expect(html).toContain('报价已发送 · Ahmed');
    expect(html).toContain('买家发来产品图 · Fatima');
  });

  it('en (default): fully English, employee is Lily, prefers latin product name', () => {
    const html = renderHome(populated, 'en');
    expect(html).toContain('Good morning');
    expect(html).toContain("Lily's summary today");
    expect(html).toContain('Inquiries'); expect(html).toContain('Deals');
    expect(html).toContain('Needs you');
    expect(html).toContain('Vacuum Cup');       // en picks latin name
    expect(html).toContain('5,000 pcs');         // grouped + unit
    expect(html).toContain("Lily's status"); expect(html).toContain('Night shift');
    expect(html).toContain('28 inquiries'); expect(html).toContain('You corrected');
    expect(html).toContain('Quote sent · Ahmed');
    expect(html).toContain('Buyer sent a photo · Fatima');
    expect(html).not.toContain('小雅'); expect(html).not.toContain('询盘');
  });

  it('ar: Arabic strings, employee is ياسمين', () => {
    const html = renderHome(populated, 'ar');
    expect(html).toContain('صباح الخير');
    expect(html).toContain('ياسمين');
    expect(html).toContain('تحتاج إليك');        // "needs you"
    expect(html).toContain('مناوبة ليلية');      // night shift
    expect(html).toContain('تم إرسال عرض السعر · Ahmed');
  });

  it('empty state per locale: "all good", no pending/events cards', () => {
    expect(renderHome(empty, 'zh')).toContain('一切正常，不用管');
    expect(renderHome(empty, 'en')).toContain('All good');
    expect(renderHome(empty, 'ar')).toContain('كل شيء على ما يرام');
    const en = renderHome(empty, 'en');
    expect(en).not.toContain('Needs you');
    expect(en).not.toContain("What's new");
  });

  it('never leaks technical / AI vocabulary — in every locale', () => {
    for (const l of LOCALES) {
      const html = (renderHome(populated, l) + renderHome(empty, l)).toLowerCase();
      for (const banned of ['ai', 'llm', 'model', 'token', 'api', 'database', 'webhook', 'confidence', '模型', '人工智能', '数据库']) {
        const hit = /^[a-z ]+$/.test(banned) ? new RegExp(`\\b${banned}\\b`).test(html) : html.includes(banned);
        expect(hit, `${l}:"${banned}"`).toBe(false);
      }
    }
  });

  it('mobile-first: no wide tables, responsive grid (any locale)', () => {
    const html = renderHome(populated, 'en');
    expect(html).not.toContain('<table');
    expect(html).toContain('@media (max-width:560px)');
    expect(html).toContain('grid-template-columns:1fr');
  });

  it('escapes buyer-supplied text', () => {
    const html = renderHome({ ...populated, pending: [
      { conversationId: 'x', buyer: '<img src=x>', countryCode: null, product: { name: null, nameZh: null }, quantity: null, unitPriceUsd: null },
    ] }, 'en');
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;img src=x&gt;');
  });

  it('zh authored lines stay phone-narrow', () => {
    for (const l of ['早上好 · 小雅的今日总结', '⚠️ 等你处理', '小雅工作状态', '重要动态']) {
      expect(width(l)).toBeLessThanOrEqual(48);
    }
  });
});
