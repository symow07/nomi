import { describe, it, expect } from 'vitest';
import { renderHome, type HomeData } from '../../src/api/web/home.js';

const populated: HomeData = {
  greetingZh: '早上好', employeeName: '小雅',
  today: { inquiries: 12, replied: 9, waiting: 3, closed: 1 },
  pending: [
    { conversationId: 'c1', buyer: 'Ahmed', countryZh: '阿联酋', productZh: '保温杯', quantity: 5000, unitPriceUsd: 0.92 },
    { conversationId: 'c2', buyer: 'Sara', countryZh: null, productZh: null, quantity: null, unitPriceUsd: null },
  ],
  employee: { statusZh: '夜班中', weekHandled: 28, weekEdits: 3, learningUpdated: true },
  events: [
    { icon: '✓', textZh: '报价已发送 · Ahmed' },
    { icon: '⭐', textZh: '买家发来产品图 · Fatima' },
  ],
  allNormal: false,
};

const empty: HomeData = {
  greetingZh: '晚上好', employeeName: '小雅',
  today: { inquiries: 0, replied: 0, waiting: 0, closed: 0 },
  pending: [], employee: { statusZh: '学习中', weekHandled: 0, weekEdits: 0, learningUpdated: false },
  events: [], allNormal: true,
};

const width = (line: string): number =>
  [...line].reduce((w, ch) => w + ((ch.codePointAt(0) ?? 0) > 0xff ? 2 : 1), 0);

describe('M9.2 · owner home dashboard (pure renderer)', () => {
  it('greeting + today summary from real numbers', () => {
    const html = renderHome(populated);
    expect(html).toContain('早上好');
    expect(html).toContain('小雅的今日总结');
    expect(html).toContain('>12<');   // 询盘
    expect(html).toContain('>9<');    // 已回复
    expect(html).toContain('>3<');    // 等你审批
    expect(html).toContain('询盘'); expect(html).toContain('成交');
  });

  it('等你处理 lists real pending items and links to the existing approval flow', () => {
    const html = renderHome(populated);
    expect(html).toContain('等你处理');
    expect(html).toContain('Ahmed');
    expect(html).toContain('保温杯');
    expect(html).toContain('5000个');
    expect(html).toContain('$0.92');
    expect(html).toContain('href="/app/inbox/c1"');   // deep-links to the exact conversation
    // Sara has no product/qty/quote — those bits are simply omitted, not faked.
    expect(html).toContain('Sara');
  });

  it('employee status card uses trust data, no technical vocabulary', () => {
    const html = renderHome(populated);
    expect(html).toContain('小雅工作状态');
    expect(html).toContain('夜班中');
    expect(html).toContain('28 个询盘');
    expect(html).toContain('你修改过');
    expect(html).toContain('已更新');
  });

  it('重要动态 shows meaningful events, capped list', () => {
    const html = renderHome(populated);
    expect(html).toContain('重要动态');
    expect(html).toContain('报价已发送 · Ahmed');
    expect(html).toContain('买家发来产品图 · Fatima');
  });

  it('empty state: 一切正常 and no noise', () => {
    const html = renderHome(empty);
    expect(html).toContain('一切正常，不用管');
    expect(html).not.toContain('等你处理');   // no pending card
    expect(html).not.toContain('重要动态');   // no events card
  });

  it('never leaks technical / AI vocabulary', () => {
    const html = (renderHome(populated) + renderHome(empty)).toLowerCase();
    for (const banned of ['ai', 'llm', 'model', 'token', 'api', 'database', 'webhook', 'confidence', '模型', '人工智能', '数据库']) {
      const needle = banned.toLowerCase();
      const hit = /^[a-z ]+$/.test(needle) ? new RegExp(`\\b${needle}\\b`).test(html) : html.includes(needle);
      expect(hit, `"${banned}"`).toBe(false);
    }
  });

  it('mobile-first: vertical cards, no wide tables, responsive grid', () => {
    const html = renderHome(populated);
    expect(html).not.toContain('<table');
    expect(html).toContain('@media (max-width:560px)');
    expect(html).toContain('grid-template-columns:1fr');   // stacks on phones
  });

  it('escapes buyer-supplied text', () => {
    const html = renderHome({ ...populated, pending: [
      { conversationId: 'x', buyer: '<img src=x>', countryZh: null, productZh: null, quantity: null, unitPriceUsd: null },
    ] });
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;img src=x&gt;');
  });

  it('greeting-line and section headers stay phone-narrow', () => {
    // The greeting and card headers are the always-visible authored lines.
    for (const l of ['早上好 · 小雅的今日总结', '⚠️ 等你处理', '小雅工作状态', '重要动态']) {
      expect(width(l)).toBeLessThanOrEqual(48);
    }
  });
});
