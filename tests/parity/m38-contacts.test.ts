import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  CONSENT_EVIDENCE, CONTACT_CHANNELS, CONTACT_SOURCES, SUPPRESSION_REASONS,
  mayContact, normalizeIdentity, type Consent, type Suppression,
} from '../../src/core/outreach/consent.js';
import { renderContacts, renderSuppressConfirm, type ContactsView } from '../../src/api/web/contacts.js';
import type { ContactRow } from '../../src/db/contacts.js';
import { normalizePhone } from '../../src/core/channel/phone.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, messages, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * M38 — who may be written to, and how we know.
 *
 * Every other thing in Block C is a way of sending something. This is the only
 * thing that says whether it may be sent at all, so it is built first and it
 * fails closed: absence of a consent record is a refusal, not a default.
 */

const AT = new Date('2026-08-01T02:00:00Z');
const consent = (over: Partial<Consent> = {}): Consent =>
  ({ evidence: 'owner_attestation', obtainedAt: AT, recordedBy: 'Mei', ...over });
const suppressed = (over: Partial<Suppression> = {}): Suppression =>
  ({ reason: 'unsubscribed', at: AT, ...over });

describe('M38 · no row means no consent', () => {
  it('nothing recorded is a REFUSAL, not a default', () => {
    const r = mayContact({ consent: null, suppression: null });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error.kind).toBe('no_consent');
  });

  it('a recorded consent allows it, and hands back the evidence', () => {
    const r = mayContact({ consent: consent(), suppression: null });
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.recordedBy).toBe('Mei');
  });

  it('SUPPRESSION BEATS CONSENT — every evidence, every reason', () => {
    // The safety property, over the whole cross product rather than one case.
    // A suppression that any consent record can outvote is not a suppression.
    for (const evidence of CONSENT_EVIDENCE) {
      for (const reason of SUPPRESSION_REASONS) {
        const r = mayContact({ consent: consent({ evidence }), suppression: suppressed({ reason }) });
        expect(r.ok, `${evidence} vs ${reason}`).toBe(false);
        expect(r.ok === false && r.error.kind).toBe('suppressed');
      }
    }
  });

  it('and the refusal names the reason and the day, so her page can say why', () => {
    const r = mayContact({ consent: consent(), suppression: suppressed({ reason: 'complained' }) });
    expect(r.ok === false && r.error.kind === 'suppressed' && r.error.reason).toBe('complained');
    expect(r.ok === false && r.error.kind === 'suppressed' && r.error.at).toEqual(AT);
  });

  it('THE ORDER IS THE GUARANTEE — suppression is read before consent, in code', async () => {
    // Checking consent first produces the same answer today and the wrong one
    // on the first day an unsubscribed address is re-imported with a fresh
    // attestation attached. Asserted against the CODE, comments stripped.
    const src = await readFile(new URL('../../src/core/outreach/consent.ts', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    const fn = code.slice(code.indexOf('export function mayContact'));
    expect(fn.indexOf('input.suppression')).toBeLessThan(fn.indexOf('input.consent'));
  });
});

describe('M38 · the address is the key, so it is canonical', () => {
  it('a phone becomes exactly a wa_id — NOT a second normalisation', () => {
    // `client_channels.channel_user_id` holds the wa_id. A form here that
    // produced '+971…' would compile, pass its own tests, match nothing in
    // production, and fail OPEN on the suppression check for every buyer.
    for (const written of ['+971 50 000 1234', '971-50-000-1234', '00971500001234', '971500001234']) {
      const r = normalizeIdentity('whatsapp', written);
      expect(r.ok, written).toBe(true);
      expect(r.ok && r.value, written).toBe('971500001234');
      expect(r.ok && r.value, written).toBe(normalizePhone(written));
    }
  });

  it('an address differing only in case is the same person', () => {
    for (const written of ['Ahmed@Example.COM', ' ahmed@example.com ']) {
      const r = normalizeIdentity('email', written);
      expect(r.ok && r.value, written).toBe('ahmed@example.com');
    }
  });

  it('what is not an address is refused rather than stored', () => {
    expect(normalizeIdentity('email', 'ahmed at example').ok).toBe(false);
    expect(normalizeIdentity('email', '').ok).toBe(false);
    expect(normalizeIdentity('whatsapp', 'call me').ok).toBe(false);
    expect(normalizeIdentity('whatsapp', '123').ok).toBe(false);
  });

  it('there is ONE phone normaliser, and this file is not a second one', async () => {
    const src = await readFile(new URL('../../src/core/outreach/consent.ts', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    expect(code).toContain('normalizePhone(value)');
    // No second digit-stripping rule living beside the one that is used.
    expect(code).not.toMatch(/replace\(\/\[\\s\(\)/);
  });
});

describe('M38 · a value nothing can write is not storable', () => {
  it('two channels, two sources, two kinds of evidence — and no others yet', () => {
    // M43a's rule on a new axis. 'csv'/'apollo' and 'replied_to_email' are in
    // the roadmap and arrive WITH the importers and the mailbox that produce
    // them: a source nothing can write is a source nothing can display honestly.
    expect([...CONTACT_CHANNELS]).toEqual(['email', 'whatsapp']);
    expect([...CONTACT_SOURCES]).toEqual(['inbound', 'manual']);
    expect([...CONSENT_EVIDENCE]).toEqual(['inbound_message', 'owner_attestation']);
    expect([...SUPPRESSION_REASONS]).toEqual(['unsubscribed', 'bounced', 'complained']);
  });

  it('the migration constrains the columns to exactly those values', async () => {
    const sql = await readFile(new URL('../../migrations/0036_contacts.sql', import.meta.url), 'utf8');
    for (const list of [
      "channel in ('email','whatsapp')",
      "source in ('inbound','manual')",
      "evidence in ('inbound_message','owner_attestation')",
      "reason in ('unsubscribed','bounced','complained')",
    ]) expect(sql, list).toContain(list);
  });

  it('SUPPRESSION IS NEITHER EDITABLE NOR DELETABLE by the app role', async () => {
    const sql = await readFile(new URL('../../migrations/0036_contacts.sql', import.meta.url), 'utf8');
    expect(sql).toContain('revoke update, delete on suppressions from nomi_app');
    expect(sql).toContain('revoke update on contact_consent from nomi_app');
  });

  it('and it is keyed on the address, so archiving cannot shake it off', async () => {
    const sql = await readFile(new URL('../../migrations/0036_contacts.sql', import.meta.url), 'utf8');
    // Not partial and not conditional — one row per identity, forever.
    expect(sql).toMatch(/create unique index if not exists suppressions_identity\s+on suppressions \(business_id, channel, identity\);/);
    expect(sql).not.toMatch(/suppressions_identity[\s\S]{0,120}where/);
    // and no contact_id anywhere in the file: a suppression that points at a
    // row disappears when the row does.
    expect(sql).not.toContain('contact_id');
  });
});

const row = (over: Partial<ContactRow> = {}): ContactRow => ({
  id: 'k1', channel: 'email', identity: 'ahmed@example.com', displayName: 'Ahmed',
  company: 'Gulf Trading', source: 'manual', firstSeen: AT, archivedAt: null,
  consent: null, suppression: null, ...over,
});

/** M42 added two fields to the view; the fixtures build through one place. */
const view = (contacts: readonly ContactRow[], over: Partial<ContactsView> = {}): ContactsView =>
  ({ contacts, outreach: new Map(), satisfied: new Set(), ...over });

describe('M38 · her page', () => {
  it('says what she has not said yet, and offers the one thing that changes it', () => {
    const html = renderContacts(view([row()]), 'en', null);
    expect(html).toContain(t('en', 'contacts.consent.none'));
    expect(html).toContain(t('en', 'contacts.attest.button'));
    expect(html).toContain('/app/contacts/consent');
  });

  it('names the evidence when there is some, and stops offering to attest', () => {
    const html = renderContacts(view([row({ consent: consent({ evidence: 'inbound_message' }) })]), 'en', null);
    expect(html).toContain(t('en', 'contacts.evidence.inbound_message'));
    expect(html).not.toContain(t('en', 'contacts.attest.button'));
  });

  it('A SUPPRESSED PERSON GETS NO ACTIONS AT ALL — there is no undo to offer', () => {
    const html = renderContacts(view([row({
      consent: consent(), suppression: suppressed({ reason: 'complained' }),
    })]), 'en', null);
    expect(html).toContain(t('en', 'contacts.reason.complained'));
    expect(html).not.toContain('/app/contacts/consent');
    expect(html).not.toContain('/app/contacts/suppress');
    expect(html).not.toContain(t('en', 'contacts.archive'));
    // and consent she once gave is not paraded beside the refusal
    expect(html).not.toContain(t('en', 'contacts.evidence.owner_attestation'));
  });

  it('the forms carry the ADDRESS, because half this list has no row', () => {
    const html = renderContacts(view([row({ id: null, source: 'inbound' })]), 'en', null);
    expect(html).toContain('name="identity" value="ahmed@example.com"');
    expect(html).toContain('name="channel" value="email"');
    // No row means nothing to archive, and nothing pretends otherwise.
    expect(html).not.toContain(t('en', 'contacts.archive'));
  });

  it('a phone is shown to her in full — this is her own list, not a buyer’s view', () => {
    const html = renderContacts(view([row({ channel: 'whatsapp', identity: '971500001234' })]), 'en', null);
    expect(html).toContain('+971500001234');
    expect(html).not.toContain('****');
  });

  it('an empty list names the next action', () => {
    for (const locale of LOCALES) {
      const html = renderContacts(view([]), locale, null);
      const visible = html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
      expect(visible, locale).toContain(t(locale, 'contacts.empty'));
      expect(visible, locale).toContain(t(locale, 'contacts.add.button'));
    }
  });

  it('NO SCORE, NO RANK, NO "LEAD" — she has people, not a pipeline', () => {
    // The vocabulary this milestone is most likely to import from every other
    // product in this category, and the one thing the owner never asked for.
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(messages[locale])) {
        if (!key.startsWith('contacts.') && key !== 'nav.contacts') continue;
        expect(value.toLowerCase(), `${locale} ${key}`)
          .not.toMatch(/\blead\b|\bprospect\b|\bscore\b|\bpipeline\b|\bcampaign\b|线索|潜客|评分|عميل محتمل/);
      }
    }
  });

  it('every string exists in all three locales', () => {
    const KEYS: MessageKey[] = [
      'contacts.title', 'contacts.intro', 'contacts.empty', 'contacts.add.title',
      'contacts.add.channel', 'contacts.add.identity', 'contacts.add.name',
      'contacts.add.company', 'contacts.add.button', 'contacts.channel.email',
      'contacts.channel.whatsapp', 'contacts.source.inbound', 'contacts.source.manual',
      'contacts.evidence.inbound_message', 'contacts.evidence.owner_attestation',
      'contacts.consent.none', 'contacts.attest.button', 'contacts.attest.hint',
      'contacts.suppress.button', 'contacts.suppress.hint', 'contacts.reason.unsubscribed',
      'contacts.reason.bounced', 'contacts.reason.complained', 'contacts.suppressed.since',
      'contacts.suppress.title', 'contacts.suppress.confirm', 'contacts.suppress.cancel',
      'contacts.archive', 'contacts.flash.added', 'contacts.flash.attested',
      'contacts.flash.suppressed', 'contacts.flash.archived', 'contacts.flash.not_an_email',
      'contacts.flash.not_a_phone', 'contacts.flash.missing', 'contacts.flash.failed',
      'nav.contacts',
    ];
    for (const locale of LOCALES) {
      for (const k of KEYS) {
        const s = t(locale, k, { date: '1 Aug', who: 'Ahmed' });
        expect(s.length, `${locale} ${k}`).toBeGreaterThan(1);
        expect(s, `${locale} ${k}`).not.toContain('{');
      }
    }
  });

  it('THE PERMANENT ACTION TAKES TWO PRESSES — the list only links to it', () => {
    // A one-click irreversible action on every row of a list of live buyers is
    // what the first screenshot of this page actually showed. The row links;
    // the second page posts.
    const html = renderContacts(view([row({ consent: consent() })]), 'en', null);
    expect(html).toContain('href="/app/contacts/suppress?channel=email&amp;identity=');
    expect(html).not.toMatch(/<form[^>]*action="\/app\/contacts\/suppress"/);

    const confirm = renderSuppressConfirm(
      { channel: 'email', identity: 'ahmed@example.com', displayName: 'Ahmed' }, 'en');
    expect(confirm).toContain(t('en', 'contacts.suppress.hint'));
    expect(confirm).toContain('<form method="post" action="/app/contacts/suppress"');
    expect(confirm).toContain(t('en', 'contacts.suppress.cancel'));
    // Going back is the PRIMARY button: the reflex that carries her through
    // every other page must not land on the one action she cannot take back.
    expect(confirm).toMatch(/class="btn send" href="\/app\/contacts"/);
    expect(confirm).toMatch(/class="btn stop" type="submit"/);
  });

  it('the attest hint appears only where the attest button does', () => {
    // A sentence explaining a control she cannot see reads as a non-sequitur.
    expect(renderContacts(view([row()]), 'en', null))
      .toContain(t('en', 'contacts.attest.hint'));
    expect(renderContacts(view([row({ consent: consent() })]), 'en', null))
      .not.toContain(t('en', 'contacts.attest.hint'));
  });

  it('it is registered as routes, and reachable from the Buyers surface', async () => {
    const app = await readFile(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    for (const r of [
      "app.get('/app/contacts'", "app.post('/app/contacts'",
      "app.post('/app/contacts/consent'", "app.get('/app/contacts/suppress'",
      "app.post('/app/contacts/suppress'",
      "app.post('/app/contacts/:id/archive'",
    ]) expect(app, r).toContain(r);
    const conv = await readFile(new URL('../../src/api/web/conversations.ts', import.meta.url), 'utf8');
    expect(conv).toContain("deeper('/app/contacts'");
  });
});
