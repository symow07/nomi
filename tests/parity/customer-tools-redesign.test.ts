import { describe, it, expect } from 'vitest';
import { renderContacts, renderSuppressConfirm, renderWriteFirst, type ContactsView } from '../../src/api/web/contacts.js';
import { renderProspects, filterFromQuery, queryOf } from '../../src/api/web/prospects.js';
import { renderSequenceList, renderSequenceDetail } from '../../src/api/web/sequences.js';
import { renderLabels } from '../../src/api/web/labels.js';
import { renderSurveys } from '../../src/api/web/surveys.js';
import type { ContactRow } from '../../src/db/contacts.js';
import type { SequenceDetail } from '../../src/db/sequences.js';

const NOW = new Date('2026-11-06T10:00:00Z');
const ID = '11111111-1111-4111-8111-111111111111';
const contact: ContactRow = { id: ID, channel: 'email', identity: 'sam@example.test', displayName: 'Sam', company: null,
  source: 'manual', firstSeen: NOW, archivedAt: null, consent: { evidence: 'owner_attestation', obtainedAt: NOW, recordedBy: 'Owner' }, suppression: null };
const view = (contacts: readonly ContactRow[], over: Partial<ContactsView> = {}): ContactsView => ({ contacts, outreach: new Map([['email', true]]), satisfied: new Set(['verified_sending_domain']), ...over });
const sequence: SequenceDetail = { id: ID, name: 'A useful follow-up', state: 'draft', createdBy: 'Owner', approvedBy: null, approvedAt: null, archivedAt: null,
  steps: [{ position: 1, delayDays: 0, subject: 'Hello Sam', body: 'The exact words approved by the owner.' }], enrollments: [] };

describe('Customers tools canonical GET navigation and preserved commands', () => {
  it('Follow-ups keeps search, paging and gated writing within Customers while POSTs stay stable', () => {
    const many = Array.from({ length: 26 }, (_, i) => ({ ...contact, id: String(i), displayName: `Sam ${i}` }));
    const h = renderContacts(view(many, { query: 'Sam' }), 'en', null);
    expect(h).toContain('<h1 class="page">Follow-ups</h1>');
    expect(h).toContain('method="get" action="/app/customers/outreach"');
    expect(h).toContain('/app/customers/outreach?q=Sam&amp;page=2');
    expect(h).toContain('href="/app/customers/outreach/write?channel=email&amp;identity=sam%40example.test"');
    expect(h).toContain('method="get" action="/app/customers/outreach/suppress"');
    expect(h).toContain('action="/app/contacts"');
    expect(h).toContain('action="/app/contacts/0/archive"');
    expect(h).toContain('/app/customers/outreach/find');
    expect(h).toContain('/app/customers/outreach/sequences');
  });
  it('suppression still wins newer consent and gives no contact actions', () => {
    const h = renderContacts(view([{ ...contact, suppression: { reason: 'complained', at: NOW } }]), 'en', null);
    const row = /<li class="ct [^"]*stopped[^"]*">([\s\S]*?)<\/li>/.exec(h)?.[1];
    expect(row).toBeDefined();
    expect(row).not.toContain('<form');
    expect(row).not.toContain('/write?');
  });
  it('write and suppression pages retain exact POST targets, identities, kept words and safe cancel doors', () => {
    const h = renderWriteFirst(contact, 'en', { draft: { subject: 'Kept <subject>', body: 'Exact customer words & figures: 10.' } });
    expect(h).toContain('action="/app/contacts/write"');
    expect(h).toContain('name="identity" value="sam@example.test"');
    expect(h).toContain('value="Kept &lt;subject&gt;"');
    expect(h).toContain('Exact customer words &amp; figures: 10.');
    expect(h).toContain('href="/app/customers/outreach"');
    const stop = renderSuppressConfirm(contact, 'en');
    expect(stop).toContain('action="/app/contacts/suppress"');
    expect(stop).toContain('href="/app/customers/outreach" autofocus');
  });
  it('sequence details move within Customers; approval still carries its fingerprint and is owner-only', () => {
    const list = renderSequenceList([{ id: ID, name: sequence.name, state: 'draft', steps: 1, live: 0, finished: 0, stopped: 0, awaiting: 0, createdAt: NOW }], 'en', null);
    expect(list).toContain(`href="/app/customers/outreach/sequences/${ID}"`);
    expect(list).toContain('action="/app/sequences"');
    const own = renderSequenceDetail(sequence, 'en', null);
    expect(own).toContain('href="/app/customers/outreach/sequences"');
    expect(own).toContain(`action="/app/sequences/${ID}/approve"`);
    expect(own).toMatch(/name="fingerprint" value="[0-9a-f]+"/);
    expect(own).toContain('The exact words approved by the owner.');
    expect(renderSequenceDetail(sequence, 'en', null, { viewer: { isOwner: false } })).not.toContain('/approve"');
  });
  it('prospect search remains deliberate and its key commands retain old endpoints', () => {
    const h = renderProspects({ status: { kind: 'none' }, filter: null, outcome: null }, 'en', null);
    expect(h).toContain('href="/app/customers/outreach"');
    expect(h).toContain('action="/app/prospects/key"');
    expect(h).not.toContain('name="search"');
    const filter = filterFromQuery({ search: '1', titles: 'Support', countries: 'GB', keywords: 'Tea & coffee', size: '11-50' })!;
    const results = renderProspects({ status: { kind: 'stored', readable: true, fingerprint: 'local-fingerprint', createdBy: 'Owner', createdAt: NOW }, filter,
      outcome: { kind: 'results', page: 1, totalPages: 2, prospects: [{ sourceId: 'one', name: 'Sam', title: 'Support', organization: 'Example', organizationDomain: null, city: null, country: 'GB' }] } }, 'en', null);
    expect(results).toContain('method="get" action="/app/customers/outreach/find"');
    expect(results).toContain(`href="/app/customers/outreach/find${queryOf(filter, 2).replace(/&/g, '&amp;')}"`);
    expect(results).toContain('action="/app/prospects/add"');
    expect(results).toContain(`name="back" value="${queryOf(filter).replace(/&/g, '&amp;')}"`);
    expect(results).not.toContain('action="/app/contacts/write"');
  });
  it('labels keep Inbox narrowing, archive confirmation and restore; Feedback switch remains owner-only', () => {
    const h = renderLabels('en', [{ id: ID, name: 'Wholesale', archived: false, buyers: 4 }]);
    expect(h).toContain(`/app/inbox?filter=all&amp;label=${ID}`);
    expect(h).toContain(`action="/app/labels/${ID}/archive"`);
    expect(h).toContain('data-confirm=');
    const f = { on: false, business: 'Example', asked: 0, answered: 0, average: null };
    expect(renderSurveys('en', f, [], { isOwner: true }, NOW)).toContain('<h1 class="page">Feedback</h1>');
    expect(renderSurveys('en', f, [], { isOwner: true }, NOW)).toContain('action="/app/surveys"');
    expect(renderSurveys('en', f, [], { isOwner: false }, NOW)).not.toContain('<form');
  });
});
