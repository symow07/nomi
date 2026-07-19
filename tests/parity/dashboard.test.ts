import { describe, it, expect } from 'vitest';
import { renderDashboardHtml, type DashboardData } from '../../src/api/dashboard.js';

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
    expect(html).toContain('>12<');           // products stat
    expect(html).toContain('15 migrations');
    expect(html).toContain('Database connected');
  });

  it('shows the live quote card as real product output', () => {
    const html = renderDashboardHtml(base);
    expect(html).toContain('报价卡');
    expect(html).toContain('price came from the SQL');
  });

  it('reflects provider mode', () => {
    expect(renderDashboardHtml(base)).toContain('deployment mode');
    expect(renderDashboardHtml({ ...base, provider: 'meta' })).toContain('Messaging: meta');
  });

  it('degrades honestly: no db, no schema, no sample card', () => {
    const html = renderDashboardHtml({
      ...base, dbOk: false, migrations: 0, sampleCard: null,
      counts: { businesses: 0, products: 0, conversations: 0, orders: 0 },
    });
    expect(html).toContain('Database unreachable');
    expect(html).toContain('seed:demo');       // sample-card fallback
    expect(html).toContain('starting or database not yet migrated');
  });

  it('escapes html to prevent injection from data values', () => {
    const html = renderDashboardHtml({ ...base, sampleCard: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
