import { describe, expect, it } from 'vitest';
import { renderSequenceDetail, renderSequenceList } from '../../src/api/web/sequences.js';
import { renderContacts, renderWriteFirst, renderSuppressConfirm } from '../../src/api/web/contacts.js';
import { renderProspects } from '../../src/api/web/prospects.js';
import { stepsFingerprint, type SequenceDetail } from '../../src/db/sequences.js';
import type { ContactRow } from '../../src/db/contacts.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';

const id = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-11-16T04:00:00Z');
const d: SequenceDetail = { id, name: 'A useful introduction', state: 'draft', createdBy: 'Owner', approvedBy: null, approvedAt: null, archivedAt: null,
  steps: [{ position: 1, delayDays: 0, subject: 'Hello أحمد', body: 'A full saved message.\nEvery word remains readable.' }], enrollments: [] };
const c: ContactRow = { id, channel: 'email', identity: 'sam@example.test', displayName: 'Sam', company: null, source: 'manual', firstSeen: now, archivedAt: null, consent: null, suppression: null };

describe('Block 3 F41 — compact outreach browsing and deliberate editing', () => {
  it('shows saved words and timing, with draft editing and an empty next message behind separate closed disclosures', () => {
    for (const locale of LOCALES) {
      const html = renderSequenceDetail(d, locale, null);
      expect(html).toContain('<details class="seq-edit" name="sequence-editor">');
      expect(html).toContain('<details class="seq-add" name="sequence-editor">');
      expect(html).not.toMatch(/class="seq-(?:add|edit)"[^>]* open/);
      expect(html).toContain(`<div class="st-b" dir="auto">${d.steps[0]!.body}</div>`);
      expect(html).toContain(`/app/sequences/${id}/steps/1`);
      expect(html).toContain(`name="fingerprint" value="${stepsFingerprint(d.steps)}"`);
      expect(html).toContain('class="seq-overview"');
      expect(renderSequenceDetail(d, locale, null, { viewer: { isOwner: false } })).not.toContain(`/app/sequences/${id}/approve`);
      const approved = renderSequenceDetail({ ...d, state: 'approved' }, locale, null);
      expect(approved).not.toContain('class="seq-edit"');
      expect(approved).not.toContain('class="seq-add"');
    }
  });
  it('puts creation behind a clear door and keeps existing list counts and POST', () => {
    const html = renderSequenceList([{ id, name: d.name, state: 'draft', steps: 1, live: 0, finished: 0, stopped: 0, awaiting: 0, createdAt: now }], 'en', null);
    expect(html).toContain('<details class="seq-new" id="new">');
    expect(html).toContain('action="/app/sequences"');
    expect(html).toContain('1 e-mails');
  });
  it('moves contact explanation after rows and keeps consent guidance at its decision', () => {
    for (const locale of LOCALES) {
      const html = renderContacts({ contacts: [c], outreach: new Map([['email', true]]), satisfied: new Set(['verified_sending_domain']) }, locale, null);
      const row = html.slice(html.indexOf('<li class="ct '), html.indexOf('</li>', html.indexOf('<li class="ct ')));
      expect(row).toContain(esc(t(locale, 'contacts.attest.hint')));
      expect(html.indexOf('class="contacts-about"')).toBeGreaterThan(html.indexOf('<li class="ct '));
      expect(html).toContain('action="/app/contacts/consent"');
      expect(html).toContain('action="/app/customers/outreach/suppress"');
    }
  });
  it('identifies the exact channel and address on both consequential pages, with send guidance before the action', () => {
    const html = renderWriteFirst(c, 'en');
    expect(html).toContain('<bdi>sam@example.test</bdi>');
    expect(html).toContain('class="outreach-recipient"');
    expect(html.indexOf('counts towards')).toBeGreaterThan(html.indexOf('</textarea>'));
    expect(html.indexOf('counts towards')).toBeLessThan(html.indexOf('class="wact"'));
    expect(renderSuppressConfirm(c, 'en')).toContain('<bdi>sam@example.test</bdi>');
  });
  it('folds an already working directory connection while retaining every key control', () => {
    const html = renderProspects({ status: { kind: 'stored', readable: true, fingerprint: 'synthetic', createdBy: 'Owner', createdAt: now }, filter: null, outcome: null }, 'en', null);
    expect(html).toContain('<details class="prospect-connection">');
    expect(html).toContain('action="/app/prospects/key"');
    expect(html).toContain('action="/app/prospects/key/remove"');
    expect(html).toContain('name="titles"');
    expect(html).not.toContain('value="synthetic"');
  });
});
