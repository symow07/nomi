import { describe, expect, it } from 'vitest';
import { renderFollowUps } from '../../src/api/web/followUps.js';
import { renderEmployee, PERMISSIONS_SAVE } from '../../src/api/web/employee.js';
import { OWNER_VIEW } from '../../src/core/conversation/people.js';
import { NEW_PROFILE as profile, followUpSection as renderFollowUpRule } from './employee-screens.js';
import type { FollowUpRun } from '../../src/db/followUps.js';
import { buttonsAndDoors } from './buttons-and-doors.js';
import { FOLLOW_UPS_EN } from '../../src/core/owner/i18n/followUps.js';
import { readFileSync } from 'node:fs';
import { renderMonthReport } from '../../src/api/web/monthReport.js';
import { FIXTURE_MONTH_REPORT } from '../../src/core/report/month.js';
const now = new Date('2031-05-03T09:00:00Z');
const run: FollowUpRun = {
  id: '00000000-0000-4000-8000-000000000001', business_id: 'b', client_id: 'c', conversation_id: 'conversation',
  source_quote_id: 'quote', source_outbound_id: 'outbound', episode_message_id: null, episode_key: 'c',
  channel: 'whatsapp', quoted_at: new Date('2031-05-01T09:00:00Z'), due_at: now, delay_days: 2, wording: 'My words',
  state: 'scheduled', reason: null, draft_id: null, presented_at: null, answered_after_approval: false,
};
// Rule 104 — the follow-up rule is a section of Settings › Assistant › Reply permissions: its three fields wait for
// the page's one Save (`PERMISSIONS_SAVE`, which calls the same `readFollowUpRule` and `saveFollowUpRule`).
describe('Follow-up owner states', () => {
  it('lists every new English-only sentence for native review, with no invented translations', () => {
    const doc = readFileSync(new URL('../../docs/NATIVE-REVIEW-UI.md', import.meta.url), 'utf8');
    for (const [key, text] of Object.entries(FOLLOW_UPS_EN)) expect(doc).toContain(`| \`${key}\` | ${text} |`);
  });
  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}: the off rule has labelled controls, exact preview, and no grant promise`, () => {
      const html = renderFollowUpRule(locale, { enabled: false, delayDays: 2, wording: 'My <exact> words' }, true);
      const whole = renderEmployee(profile, locale, null, OWNER_VIEW, { followUps: { enabled: false, delayDays: 2, wording: 'My <exact> words' } });
      // The section is inside the page's one form, which the one Save sends.
      const form = whole.slice(whole.indexOf(`<form method="post" action="${PERMISSIONS_SAVE}"`));
      expect(form).toContain('data-save');
      expect(form.indexOf('id="follow-ups"')).toBeGreaterThan(0);
      expect(form.indexOf('id="follow-ups"')).toBeLessThan(form.indexOf('</form>'));
      expect(html).toContain('for="follow-up-enabled"');
      expect(html).toContain('for="follow-up-wording"');
      expect(html).toContain('for="follow-up-delay"');
      // The words exactly as saved, in the field that holds them: escaped, nothing added.
      expect(html).toContain('dir="auto" aria-describedby="follow-up-words-help">My &lt;exact&gt; words</textarea>');
      expect(html).toContain('You choose Send');
      expect(html).toContain('Nothing goes on its own');
      expect(html).toContain('Follow-ups already planned keep their words and date');
      expect(html).not.toContain('checked');
      // English is marked as English only on a page in another language (layout.ts `wordsHtml`).
      expect(html.includes('<bdi lang="en" dir="ltr">')).toBe(locale !== 'en');
      expect(html.match(/<button[^>]*type="submit"[^>]*>/g)).toHaveLength(1);   // the page's Save (the template's), and no other
      expect(buttonsAndDoors(whole)).toEqual([]);
    });
    it(`${locale}: staff can read the rule and run but cannot save or skip`, () => {
      const html = renderFollowUpRule(locale, { enabled: true, delayDays: 2, wording: 'My words' }, false)
        + renderFollowUps(locale, [run], false, now);
      expect(html).toContain('My words');
      expect(html).toContain('Follow-up');
      expect(html).not.toMatch(/<form|<button/);
    });
    it(`${locale}: due, closed and canceled states say what happened; skip is a button`, () => {
      const html = renderFollowUps(locale, [{ ...run, state: 'window_closed', reason: 'window_closed' }], true, now);
      expect(html).toContain('until the customer writes');
      expect(html).toContain('method="post"');
      expect(html).toContain('type="submit"');
      expect(html).not.toMatch(/<span[^>]*dir="auto"[^>]*>\s*<bdi/);
      expect(renderFollowUps(locale, [{ ...run, state: 'canceled', reason: 'customer_answered' }], true, now))
        .toContain('The customer answered');
      expect(buttonsAndDoors(html)).toEqual([]);
    });
    it(`${locale}: the monthly subset says zero honestly and adds no second estimate`, () => {
      const html = renderMonthReport({ ...FIXTURE_MONTH_REPORT, followUpsSent: 0 }, locale, {
        canSetMinutes: true, months: ['2026-10'], flash: null, now, startedAt: now, setupDone: true,
      });
      expect(html).toMatch(/Follow-ups you sent: [\u2068\u2069]*0/);
      expect(html.match(/Follow-ups you sent:/g)).toHaveLength(1);
    });
  }
});
