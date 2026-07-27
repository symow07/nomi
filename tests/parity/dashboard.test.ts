import { describe, it, expect } from 'vitest';
import { renderDashboardHtml, renderHomeBody, type DashboardData } from '../../src/api/dashboard.js';

const base: DashboardData = {
  provider: 'disabled', dbOk: true, migrations: 15,
  counts: { businesses: 1, products: 12, conversations: 5, orders: 0 },
  sampleCard: '┌ 报价卡 ─────────────\n│ 产品：Canvas Tote Bag\n└──────────────────',
  generatedAt: new Date('2026-07-19T12:00:00Z'),
};

describe('operator dashboard (pure renderer)', () => {
  it('renders a complete HTML document with the live counts', () => {
    const html = renderDashboardHtml(base);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('YiwuFlow');
    expect(html).toContain('>12<');            // products stat
    expect(html).toContain('数据结构：15 项');
    expect(html).toContain('数据已连接');
  });

  it('home body shows the live quote card as real product output', () => {
    const body = renderHomeBody(base);
    expect(body).toContain('报价卡');
    expect(body).toContain('价格来自你的价格表');
  });

  it('reflects provider mode', () => {
    expect(renderHomeBody(base)).toContain('暂未连接接待渠道');
    expect(renderHomeBody({ ...base, provider: 'meta' })).toContain('接待渠道：meta');
  });

  it('degrades honestly: no db, no schema, no sample card', () => {
    const body = renderHomeBody({
      ...base, dbOk: false, migrations: 0, sampleCard: null,
      counts: { businesses: 0, products: 0, conversations: 0, orders: 0 },
    });
    expect(body).toContain('数据连接异常');
    expect(body).toContain('还没有产品目录');
    expect(body).toContain('系统正在启动');
  });

  it('escapes html to prevent injection from data values', () => {
    const body = renderHomeBody({ ...base, sampleCard: '<script>alert(1)</script>' });
    expect(body).not.toContain('<script>alert(1)</script>');
    expect(body).toContain('&lt;script&gt;');
  });
});
