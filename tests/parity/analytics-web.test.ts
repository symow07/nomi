import { describe, it, expect } from 'vitest';
import { renderAnalytics, parseRange, type AnalyticsData } from '../../src/api/web/analytics.js';

const active: AnalyticsData = {
  range: 'week', rangeZh: '本周', hasActivity: true,
  summary: { newClients: 6, activeConvos: 5, quotes: 2, orders: 1 },
  activity: { inbound: 6, replied: 3, waiting: 4 },
  commerce: { quotes: 2, orders: 1, deals: [{ statusZh: '已成交', n: 1 }], totalValueUsd: 4600 },
  employee: { handled: 8, waiting: 4, edits: 2 },
};

const empty: AnalyticsData = {
  range: 'today', rangeZh: '今天', hasActivity: false,
  summary: { newClients: 0, activeConvos: 0, quotes: 0, orders: 0 },
  activity: { inbound: 0, replied: 0, waiting: 0 },
  commerce: { quotes: 0, orders: 0, deals: [], totalValueUsd: null },
  employee: { handled: 0, waiting: 0, edits: 0 },
};

describe('M9.8 · business performance (pure)', () => {
  it('parseRange whitelists today/week/month; defaults to week', () => {
    expect(parseRange('today')).toBe('today');
    expect(parseRange('month')).toBe('month');
    expect(parseRange('week')).toBe('week');
    expect(parseRange(undefined)).toBe('week');
    expect(parseRange('../etc')).toBe('week'); // no injection, safe default
  });

  it('renders the four business sections with the real numbers', () => {
    const html = renderAnalytics(active);
    expect(html).toContain('经营数据');
    expect(html).toContain('本周概况');
    expect(html).toContain('新增客户');
    expect(html).toContain('客户沟通');
    expect(html).toContain('沟通趋势');
    expect(html).toContain('买家咨询');
    expect(html).toContain('报价与订单');
    expect(html).toContain('小雅工作总结');
    expect(html).toContain('已处理询盘');
    // the actual counts appear
    expect(html).toContain('>6<'); // newClients / inbound
    expect(html).toContain('>8<'); // handled
  });

  it('shows real order value only when orders exist — never invented', () => {
    const html = renderAnalytics(active);
    expect(html).toContain('已成交 1');
    expect(html).toContain('成交金额 $4,600');
    // when there are no orders, no value line, honest note instead
    const noOrders = renderAnalytics({ ...active, commerce: { quotes: 2, orders: 0, deals: [], totalValueUsd: null } });
    expect(noOrders).not.toContain('成交金额');
    expect(noOrders).toContain('暂无成交记录');
  });

  it('empty range shows an honest data-collecting state, never a fake chart', () => {
    const html = renderAnalytics(empty);
    expect(html).toContain('数据积累中');
    expect(html).not.toContain('概况');   // no number cards when there is nothing
    expect(html).not.toContain('<svg');   // no fabricated chart
    expect(html).not.toContain('<canvas');
    // range tabs still present so the owner can switch
    expect(html).toContain('href="/app/analytics?range=week"');
  });

  it('range tabs reflect the active range', () => {
    const html = renderAnalytics(active);
    expect(html).toContain('class="tab on" href="/app/analytics?range=week"');
    expect(html).toContain('href="/app/analytics?range=today"');
    expect(html).toContain('href="/app/analytics?range=month"');
  });

  it('no percentages, rates, scores, or technical vocabulary', () => {
    // Scan the visible content only — %/units inside <style> are layout, not owner text.
    const strip = (s: string) => s.replace(/<style[\s\S]*?<\/style>/g, '');
    const html = (strip(renderAnalytics(active)) + strip(renderAnalytics(empty))).toLowerCase();
    expect(html).not.toContain('%');
    for (const w of ['\\bai\\b', '\\bllm\\b', '\\bmodel\\b', '\\btoken\\b', '\\bapi\\b',
      '\\bconversion\\b', '\\bengagement\\b', '\\bconfidence\\b', '\\bperformance\\b']) {
      expect(new RegExp(w).test(html), w).toBe(false);
    }
    for (const zh of ['转化率', '置信度', '模型', '人工智能', '准确率']) {
      expect(html.includes(zh), zh).toBe(false);
    }
  });

  it('mobile: numbers in cards, no tables', () => {
    expect(renderAnalytics(active)).not.toContain('<table');
  });
});
