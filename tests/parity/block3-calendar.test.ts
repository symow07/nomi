import { describe, expect, it } from 'vitest';
import { renderCalendar, parseCalendarQuery } from '../../src/api/web/calendar.js';
import { withZone } from '../../src/api/web/zone.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import type { CalendarEntry, CalendarView } from '../../src/db/calendar.js';

const now = new Date('2026-11-16T04:00:00Z');
const buyer = { id: '11111111-1111-4111-8111-111111111111', name: 'أحمد Chen', country: 'AE', photo: null };
const entry: CalendarEntry = {
  day: '2026-11-16', at: now, allDay: false, category: 'promised', kind: 'promise_delivery',
  buyer, identity: null, conversationId: '22222222-2222-4222-8222-222222222222', orderId: null,
  source: { table: 'promised_dates', id: '33333333-3333-4333-8333-333333333333', column: 'due_on' },
  detail: { said: 'Delivery on Monday.', kept: false },
};
const view: CalendarView = {
  from: '2026-10-26', to: '2026-12-07', today: '2026-11-16', category: null, buyer: null,
  buyers: [buyer], categories: ['promised', 'yours'], entries: [entry],
};

describe('Block 3 F40 — connected calendar context', () => {
  it('keeps month navigation, date choice, filters and the visible mark key together before the agenda', () => {
    for (const locale of LOCALES) withZone('Asia/Shanghai', () => {
      const html = renderCalendar(view, locale, { now, ask: parseCalendarQuery({ day: view.today }, now) });
      const start = html.indexOf('<div class="cal-context">');
      const agenda = html.indexOf('<div class="cal-screen">');
      expect(start).toBeGreaterThan(0);
      const context = html.slice(start, agenda);
      for (const part of ['class="cal-period"', 'class="cal-date-choice"', 'class="cal-tools"', 'class="cal-legend small"']) {
        expect(context, `${locale}: ${part}`).toContain(part);
      }
      expect(html.match(/class="cal-legend small"/g)).toHaveLength(1);
      expect(html.indexOf('class="cal-list"')).toBeLessThan(html.indexOf('class="cal-grid"'));
      expect(html).toContain(`/app/calendar/promises/${entry.source.id}/kept`);
      expect(html).toContain(`href="/app/customers/${buyer.id}"`);
      expect(html).toContain('<span class="mo-n"><bdi>أحمد Chen</bdi></span>');
      expect(html).toContain('data-src="promised_dates:33333333-3333-4333-8333-333333333333" data-col="due_on"');
    });
  });

  it('isolates each Arabic customer option value, since an option cannot contain bdi markup', () => {
    const html=withZone('Asia/Shanghai',()=>renderCalendar(view,'ar',{now}));
    const option=html.match(new RegExp('<option value="'+buyer.id+'"[^>]*>([^<]+)</option>'));
    expect(option).not.toBeNull();
    expect(option![1]).toMatch(/^\u2068.*\u2069$/);
    expect(option![1]).toContain(buyer.name);
  });

  it('does not add duplicate controls or a mark key to an empty month', () => {
    const html = withZone('Asia/Shanghai', () => renderCalendar({ ...view, entries: [] }, 'en', { now }));
    expect(html).toContain('class="cal-context"');
    expect(html).not.toContain('class="cal-legend');
    expect(html.match(/action="\/app\/calendar\/entries"/g)).toHaveLength(1);
    expect(html).not.toContain('class="cal-tools"');
  });
});
