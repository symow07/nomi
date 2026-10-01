import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { whereSeenFrom } from '../../src/core/owner/whereSeen.js';
import { renderApprovalCard } from '../../src/api/web/connectionApproval.js';
import { goesByMail, renderOwnerAlert } from '../../src/pipeline/notify.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { OWNER_VIEW } from '../../src/core/conversation/people.js';

/**
 * KS6 (0115) — approval before the first connection: the address rule, the
 * card, the two routes, the owner's e-mail. Over Postgres and the web app:
 * tests/integration/ks6-approval.test.ts.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const STAFF = { ...OWNER_VIEW, isOwner: false };

describe('KS6 · where the business can be seen', () => {
  it('a Page, an Instagram handle, a website — one https address each', () => {
    expect(whereSeenFrom('Facebook.com/SoapHouse')).toBe('https://facebook.com/SoapHouse');
    expect(whereSeenFrom(' https://www.instagram.com/soap.house/ ')).toBe('https://www.instagram.com/soap.house/');
    expect(whereSeenFrom('@soap.house')).toBe('https://www.instagram.com/soap.house');
    expect(whereSeenFrom('http://soap.example')).toBe('https://soap.example');
    expect(whereSeenFrom('soap.example/shop?ref=1')).toBe('https://soap.example/shop?ref=1');
  });
  it('anything else is not an address', () => {
    for (const v of ['', 'not an address', 'soap', 'javascript:alert(1)', 'ftp://soap.example', 'https://user:pw@soap.example', '@', 'x'.repeat(301)]) {
      expect(whereSeenFrom(v), v).toBeNull();
    }
  });
});

describe('KS6 · the card', () => {
  const when = new Date('2026-10-01T10:00:00Z');
  for (const l of LOCALES) {
    it(`${l} · nothing unless needed; the form for the owner; where the ask stands; a refusal with the contact`, () => {
      expect(renderApprovalCard({ needed: false, ask: null }, l, OWNER_VIEW, null)).toBe('');
      const form = renderApprovalCard({ needed: true, ask: null }, l, OWNER_VIEW, null);
      expect(form).toContain('id="approval"');
      expect(form).toContain('action="/app/channels/approval"');
      expect(form).toContain(t(l, 'approval.lead'));
      const staff = renderApprovalCard({ needed: true, ask: null }, l, STAFF, null);
      expect(staff).not.toContain('<form');
      expect(staff).toContain(t(l, 'staff.ownerDecides'));
      const waiting = renderApprovalCard({ needed: true, ask: { page: 'https://facebook.com/x', askedAt: when, decision: null } }, l, OWNER_VIEW, null);
      expect(waiting).not.toContain('<form');
      expect(waiting).toContain('https://facebook.com/x');
      const refused = renderApprovalCard({ needed: true, ask: { page: 'https://facebook.com/x', askedAt: when, decision: 'refused' } }, l, OWNER_VIEW, 'legal@nomi.example');
      expect(refused).toContain(t(l, 'approval.refused'));
      expect(refused).toContain(t(l, 'approval.refusedContact', { email: 'legal@nomi.example' }));
      expect(renderApprovalCard({ needed: true, ask: { page: 'p.example', askedAt: when, decision: 'refused' } }, l, OWNER_VIEW, null)).not.toContain('legal@');
    });
  }
  it('first on the Channels page, before the WhatsApp card', () => {
    const page = src('src/api/web/channels.ts');
    expect(page.indexOf('${approvalHtml}')).toBeLessThan(page.indexOf('${whatsappCard}'));
  });
});

describe('KS6 · the two connect routes ask one question', () => {
  const app = src('src/api/web/app.ts');
  it('no route asks the old stop flag alone', () => {
    expect(app).not.toContain('connectionsStopped(');
    expect(app).toContain("return gate === 'stopped' ? 'connect.flash.paused' : gate === 'approval' ? 'connect.flash.approval' : null;");
  });
  for (const route of ["app.post('/app/channels/whatsapp/connect'", "app.get('/app/connect/meta/start'", "app.get('/app/connect/meta/callback'", "app.post('/app/connect/meta/choose'"]) {
    it(`${route} refuses before it connects anything`, () => {
      const body = app.slice(app.indexOf(route), app.indexOf(route) + 1500);
      const asked = body.indexOf('await connectionRefusal(s.businessId)');
      expect(asked, route).toBeGreaterThan(0);
      for (const later of ['connectConfiguredNumber(', 'metaDialogUrl(', 'completeMetaConnection(', 'chooseMetaPage(']) {
        if (body.includes(later)) expect(asked, `${route} · ${later}`).toBeLessThan(body.indexOf(later));
      }
    });
  }
});

describe('KS6 · the owner hears, by e-mail always', () => {
  it('both decisions go by mail; the approval opens Channels', () => {
    expect(goesByMail('connection_approved')).toBe(true);
    expect(goesByMail('connection_refused')).toBe(true);
    expect(src('src/pipeline/notify.ts')).toContain("job.kind === 'connection_approved' ? CONNECTION_APPROVAL_PAGE");
    expect(src('src/main.ts')).toContain('...await connectionDecisionAlerts(db)]');
  });
  for (const l of LOCALES) {
    it(`${l} · the words and the subjects`, () => {
      expect(renderOwnerAlert(l, 'connection_approved', null, {})).toBe(t(l, 'notify.connection_approved'));
      expect(renderOwnerAlert(l, 'connection_refused', null, {})).toBe(t(l, 'notify.connection_refused'));
      expect(renderOwnerAlert(l, 'signup_digest', null, { signups: [], approvals: 3 })).toContain(t(l, 'notify.signup_digest.approvals', { n: 3 }));
      for (const k of ['notify.connection_approved.subject', 'notify.connection_refused.subject'] as const) expect(t(l, k)).not.toBe(k);
    });
  }
});

describe('KS6 · the table is read, never written, by the app', () => {
  const m = src('migrations/0115_connection_approval.sql');
  it('select only, its own row; the switch is the installation\'s', () => {
    expect(m).toContain('revoke all on connection_approvals from public, nomi_app;');
    expect(m).toContain('grant select on connection_approvals to nomi_app;');
    expect(m).toContain('for select to nomi_app');
    expect(m).toContain("check (flag <> 'approve_connections' or business_id is null);");
  });
});
