import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import { renderAnalytics, parseRange, type AnalyticsData } from '../../src/api/web/analytics.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

const active: AnalyticsData = {
  range: 'week', hasActivity: true,
  summary: { newClients: 6, activeConvos: 5, quotes: 2, orders: 1 },
  activity: { inbound: 6, replied: 3, waiting: 4 },
  commerce: { quotes: 2, orders: 1, deals: [{ status: 'confirmed', n: 1 }], totals: [usd(4600)] },
  employee: { handled: 8, waiting: 4, edits: 2 },
};

const empty: AnalyticsData = {
  range: 'today', hasActivity: false,
  summary: { newClients: 0, activeConvos: 0, quotes: 0, orders: 0 },
  activity: { inbound: 0, replied: 0, waiting: 0 },
  commerce: { quotes: 0, orders: 0, deals: [], totals: [] },
  employee: { handled: 0, waiting: 0, edits: 0 },
};

describe('M9.8 · business review (localized)', () => {
  it('parseRange whitelists today/week/month; defaults to week', () => {
    expect(parseRange('today')).toBe('today');
    expect(parseRange('month')).toBe('month');
    expect(parseRange(undefined)).toBe('week');
    expect(parseRange('../etc')).toBe('week');
  });

  it('zh: four sections with real numbers', () => {
    const html = renderAnalytics(active, 'zh');
    expect(html).toContain('经营情况');
    expect(html).toContain('新增客户'); expect(html).toContain('客户沟通');
    expect(html).toContain('沟通情况'); expect(html).toContain('买家咨询');
    expect(html).toContain('报价与订单'); expect(html).toContain('小雅工作总结');
    expect(html).toContain('>6<'); expect(html).toContain('>8<');
  });

  it('en: four sections with real numbers', () => {
    const html = renderAnalytics(active, 'en');
    expect(html).toContain('Results');
    expect(html).toContain('New customers'); expect(html).toContain('Activity');
    expect(html).toContain('Buyer inquiries'); expect(html).toContain("Lily's work");
    expect(html).toContain('Inquiries handled');
    expect(html).toContain('>6<'); expect(html).toContain('>8<');
  });

  it('ar: renders Arabic + employee name', () => {
    const html = renderAnalytics(active, 'ar');
    expect(html).toContain('النتائج');
    expect(html).toContain('عملاء جدد');
    expect(html).toContain('عمل ياسمين');
  });

  it('real order value only when orders exist — localized status + note', () => {
    expect(renderAnalytics(active, 'en')).toContain('Confirmed 1');
    expect(renderAnalytics(active, 'en')).toContain('Deal value $4,600');
    expect(renderAnalytics(active, 'zh')).toContain('已成交 1');
    const noOrders = renderAnalytics({ ...active, commerce: { quotes: 2, orders: 0, deals: [], totals: [] } }, 'en');
    expect(noOrders).not.toContain('Deal value');
    expect(noOrders).toContain('No deals yet.');
  });

  it('empty range: honest data-collecting state per locale, no fake chart', () => {
    expect(renderAnalytics(empty, 'zh')).toContain('还没什么可看的');
    expect(renderAnalytics(empty, 'en')).toContain('Nothing to show yet');
    expect(renderAnalytics(empty, 'ar')).toContain('لا شيء لعرضه بعد');
    const en = renderAnalytics(empty, 'en');
    expect(en).not.toContain('Overview');   // no number cards
    expect(en).not.toContain('<svg'); expect(en).not.toContain('<canvas');
    expect(en).toContain('href="/app/analytics?range=week"');
  });

  it('range tabs reflect the active range', () => {
    const html = renderAnalytics(active, 'en');
    expect(html).toContain('class="tab on" href="/app/analytics?range=week"');
    expect(html).toContain('href="/app/analytics?range=today"');
  });

  it('no percentages, rates, scores, or technical vocabulary — every locale', () => {
    const strip = (s: string) => s.replace(/<style[\s\S]*?<\/style>/g, '');
    for (const l of LOCALES) {
      const html = (strip(renderAnalytics(active, l)) + strip(renderAnalytics(empty, l))).toLowerCase();
      expect(html, l).not.toContain('%');
      for (const w of ['\\bai\\b', '\\bllm\\b', '\\bmodel\\b', '\\btoken\\b', '\\bapi\\b',
        '\\bconversion\\b', '\\bengagement\\b', '\\bconfidence\\b', '\\bperformance\\b']) {
        expect(new RegExp(w).test(html), `${l}:${w}`).toBe(false);
      }
      for (const zh of ['转化率', '置信度', '模型', '人工智能', '准确率']) {
        expect(html.includes(zh), `${l}:${zh}`).toBe(false);
      }
    }
  });

  it('mobile: no tables', () => {
    expect(renderAnalytics(active, 'en')).not.toContain('<table');
  });
});
