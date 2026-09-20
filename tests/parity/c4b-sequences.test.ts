import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MAX_HOLD_DAYS, SEQUENCE_STOPS, decideStep, dueAfter, nextShanghaiDay, type StepInput,
} from '../../src/core/outreach/sequence.js';
import { OUTREACH_REFUSALS, type OutreachInput } from '../../src/core/outreach/gate.js';
import { stepsFingerprint, type SequenceDetail } from '../../src/db/sequences.js';
import { renderSequenceDetail, renderSequenceList, stepFromForm } from '../../src/api/web/sequences.js';
import type { ContactRow } from '../../src/db/contacts.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { formatDate } from '../../src/core/owner/i18n/format.js';
import { gateOutbound } from '../../src/core/channel/sendGate.js';

/**
 * C4.b — a first e-mail and its follow-ups.
 *
 * The one feature that keeps writing to a stranger after she has stopped
 * looking. What is on trial here is the policy, as one pure function: that each
 * thing which should end a sequence ends it, in the right order, and that the
 * two things which are only true today hold it instead — for a week, and not
 * forever.
 */

const NOW = new Date('2026-09-14T02:00:00Z');   // 10:00 in Shanghai
const DAY = 24 * 3600_000;

const yes = (over: Partial<OutreachInput> = {}): OutreachInput => ({
  channel: 'email', availableHere: true, enabled: true,
  satisfied: new Set(['verified_sending_domain']),
  consent: { evidence: 'owner_attestation', obtainedAt: NOW, recordedBy: 'Lily' },
  suppression: null, ceilingReached: false, ...over,
});

const STEPS = [{ position: 1, delayDays: 0 }, { position: 2, delayDays: 2 }, { position: 3, delayDays: 3 }];

const input = (over: Partial<StepInput> = {}): StepInput => ({
  now: NOW, steps: STEPS, nextPosition: 2,
  nextDueAt: new Date(NOW.getTime() - 60_000), stepDueSince: new Date(NOW.getTime() - 60_000),
  sequenceArchived: false, repliedSinceEnrolment: false, handedOff: false,
  previous: 'sent', outreach: yes(),
  repliesObservable: true, confirmedPosition: null, awaitingConfirmationSince: null, ...over,
});

describe('C4.b · what ends a sequence, and in what order', () => {
  it('everything well: the due step goes', () => {
    expect(decideStep(input())).toEqual({ kind: 'send', position: 2 });
  });

  it('HE ANSWERED — that outranks every other state, because it is what the sequence was for', () => {
    expect(decideStep(input({ repliedSinceEnrolment: true, handedOff: true, previous: 'not_sent' })))
      .toEqual({ kind: 'stop', reason: 'replied' });
  });

  it('her archiving it outranks even that: a sequence out of use does nothing at all', () => {
    expect(decideStep(input({ sequenceArchived: true, repliedSinceEnrolment: true })))
      .toEqual({ kind: 'stop', reason: 'sequence_archived' });
  });

  it('a suppression stops it BY ITS OWN REASON, so she is told which', () => {
    for (const reason of ['unsubscribed', 'bounced', 'complained'] as const) {
      expect(decideStep(input({ outreach: yes({ suppression: { reason, at: NOW } }) })))
        .toEqual({ kind: 'stop', reason });
    }
  });

  it('a person holding the thread stops it', () => {
    expect(decideStep(input({ handedOff: true }))).toEqual({ kind: 'stop', reason: 'handed_off' });
  });

  it('A FOLLOW-UP TO A MAIL THAT NEVER ARRIVED does not go — even when it is due', () => {
    expect(decideStep(input({ previous: 'not_sent' }))).toEqual({ kind: 'stop', reason: 'previous_not_sent' });
  });

  it('a previous mail not yet known to have gone waits an hour — but only once the next is due', () => {
    expect(decideStep(input({ previous: 'pending' })))
      .toEqual({ kind: 'wait', until: new Date(NOW.getTime() + 3600_000), why: 'previous_pending' });
    // Not due yet: the answer is the due date, so the hour can never bring the
    // step forward when the scheduler writes it over `next_due_at`.
    const due = new Date(NOW.getTime() + 2 * DAY);
    expect(decideStep(input({ previous: 'pending', nextDueAt: due })))
      .toEqual({ kind: 'wait', until: due, why: 'not_due' });
  });

  it('it is FINISHED only once the last mail is known to have gone', () => {
    expect(decideStep(input({ nextPosition: 4, previous: 'pending' })).kind).toBe('wait');
    expect(decideStep(input({ nextPosition: 4, previous: 'sent' }))).toEqual({ kind: 'complete' });
    expect(decideStep(input({ nextPosition: 4, previous: 'not_sent' })))
      .toEqual({ kind: 'stop', reason: 'previous_not_sent' });
  });

  it('refusals that are true forever stop it: consent gone, writing first turned off', () => {
    expect(decideStep(input({ outreach: yes({ consent: null }) }))).toEqual({ kind: 'stop', reason: 'no_consent' });
    expect(decideStep(input({ outreach: yes({ enabled: false }) })))
      .toEqual({ kind: 'stop', reason: 'outreach_not_enabled' });
  });

  it('HER CAP HOLDS IT until tomorrow in Shanghai — and after a week, stops it', () => {
    const capped = yes({ ceilingReached: true });
    expect(decideStep(input({ outreach: capped })))
      .toEqual({ kind: 'wait', until: nextShanghaiDay(NOW), why: 'cap' });
    const weekLate = new Date(NOW.getTime() - MAX_HOLD_DAYS * DAY);
    expect(decideStep(input({ outreach: capped, stepDueSince: weekLate }))).toEqual({ kind: 'stop', reason: 'cap' });
  });

  it('a lapsed domain check holds it the same way, and stops it the same way', () => {
    const lapsed = yes({ satisfied: new Set() });
    expect(decideStep(input({ outreach: lapsed })).kind).toBe('wait');
    expect(decideStep(input({ outreach: lapsed, stepDueSince: new Date(NOW.getTime() - 8 * DAY) })))
      .toEqual({ kind: 'stop', reason: 'domain' });
  });

  it('every refusal the outreach gate can give is either a stop or a hold — none is ignored', () => {
    const refusing: Record<(typeof OUTREACH_REFUSALS)[number], OutreachInput> = {
      channel_cannot_initiate: yes({ satisfied: new Set() }),
      outreach_not_enabled: yes({ enabled: false }),
      suppressed: yes({ suppression: { reason: 'complained', at: NOW } }),
      no_consent: yes({ consent: null }),
      outreach_ceiling: yes({ ceilingReached: true }),
    };
    for (const r of OUTREACH_REFUSALS) {
      expect(['stop', 'wait'], r).toContain(decideStep(input({ outreach: refusing[r] })).kind);
    }
  });
});

describe('0051 · where his answer cannot be seen, a follow-up waits for a person', () => {
  const blind = (over: Partial<StepInput> = {}) => input({ repliesObservable: false, ...over });

  it('A FOLLOW-UP DOES NOT GO BLIND: it asks, and nothing is sent', () => {
    expect(decideStep(blind())).toEqual({ kind: 'confirm', position: 2 });
  });

  it('the first mail never asks — nobody can have answered a mail that has not gone', () => {
    expect(decideStep(blind({ nextPosition: 1, previous: 'none' }))).toEqual({ kind: 'send', position: 1 });
  });

  it('released for THIS step it goes; a release for another step releases nothing', () => {
    expect(decideStep(blind({ confirmedPosition: 2 }))).toEqual({ kind: 'send', position: 2 });
    expect(decideStep(blind({ nextPosition: 3, confirmedPosition: 2 }))).toEqual({ kind: 'confirm', position: 3 });
  });

  it('it asks only when the step is due, and never ahead of what already stopped it', () => {
    const due = new Date(NOW.getTime() + DAY);
    expect(decideStep(blind({ nextDueAt: due }))).toEqual({ kind: 'wait', until: due, why: 'not_due' });
    expect(decideStep(blind({ handedOff: true }))).toEqual({ kind: 'stop', reason: 'handed_off' });
    // Nobody is asked to release a mail that could never go.
    expect(decideStep(blind({ outreach: yes({ consent: null }) }))).toEqual({ kind: 'stop', reason: 'no_consent' });
    expect(decideStep(blind({ previous: 'pending' })).kind).toBe('wait');
  });

  it('her cap does not keep her from being asked — and once released, the cap holds it as usual', () => {
    const capped = yes({ ceilingReached: true });
    expect(decideStep(blind({ outreach: capped }))).toEqual({ kind: 'confirm', position: 2 });
    expect(decideStep(blind({ outreach: capped, confirmedPosition: 2 })))
      .toEqual({ kind: 'wait', until: nextShanghaiDay(NOW), why: 'cap' });
  });

  it('A WEEK WITH NOBODY SAYING SO STOPS IT, by its own reason', () => {
    const almost = new Date(NOW.getTime() - MAX_HOLD_DAYS * DAY + 60_000);
    expect(decideStep(blind({ awaitingConfirmationSince: almost })).kind).toBe('confirm');
    const week = new Date(NOW.getTime() - MAX_HOLD_DAYS * DAY);
    expect(decideStep(blind({ awaitingConfirmationSince: week }))).toEqual({ kind: 'stop', reason: 'unconfirmed' });
  });

  it('where replies ARE seen, nothing asks: the recorded reply is what stops it', () => {
    expect(decideStep(input({ repliesObservable: true })).kind).toBe('send');
  });

  it('THE COMPOSITION ROOT SAYS REPLIES ARE NOT SEEN — her mail goes through her own mailbox', () => {
    const main = readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)), 'utf8');
    expect(main).toMatch(/const sequenceDeps = \{[\s\S]*?repliesObservable: false,/);
    expect(main).not.toMatch(/repliesObservable: true/);
  });

  it('the same minute looks at her domain before the sweep, so a follow-up is not held for want of a button', () => {
    const main = readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)), 'utf8');
    const worker = /boss\.work<SequenceSweepJob>[\s\S]*?\n {2}\}\);/.exec(main)?.[0] ?? '';
    expect(worker.indexOf('refreshDomainCheckIfDue(')).toBeGreaterThan(-1);
    expect(worker.indexOf('refreshDomainCheckIfDue(')).toBeLessThan(worker.indexOf('runDueSteps('));
  });

  it('A MINUTE\'S WORK FITS IN A MINUTE — it leaves on shutdown, gives way to the next minute, and looks up few domains at a time', () => {
    const main = readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)), 'utf8');
    const worker = /boss\.work<SequenceSweepJob>[\s\S]*?\n {2}\}\);/.exec(main)?.[0] ?? '';
    expect(worker).toMatch(/const spent = \(\): boolean => closing \|\| Date\.now\(\) - started > SWEEP_BUDGET_MS/);
    expect(worker.match(/if \(spent\(\)\) return;/g)?.length, 'asked before each look-up AND before each send').toBe(2);
    // E1 — reading an inbox is network work in the same minute, so it happens
    // in its own pass AFTER every send, rationed like a domain check. A mailbox
    // that will not answer can then cost a read, never a send.
    expect(main).toMatch(/const INBOX_READS_PER_SWEEP = 3;/);
    expect(worker).toMatch(/if \(spent\(\) \|\| inboxesRead >= INBOX_READS_PER_SWEEP\) return;/);
    expect(worker.indexOf('runDueSteps('), 'sends go before any inbox is read')
      .toBeLessThan(worker.indexOf('readNewMail('));
    expect(worker).toMatch(/if \(lookedUp < DOMAIN_CHECKS_PER_SWEEP\)/);
    expect(main).toMatch(/const SWEEP_BUDGET_MS = 40_000;/);
    expect(main).toMatch(/const DOMAIN_CHECKS_PER_SWEEP = 3;/);
  });
});

describe('C4.b · the ops kill switch silences the machine, not her', () => {
  const g = {
    assignedTo: null, paused: false,
    windowPlan: { action: 'send_free', ownerNoteZh: '' } as const,
    activated: true, pilotMode: false, recipientAllowed: true, silenced: true,
    outreach: yes(),
  };

  it('A FOLLOW-UP THE SCHEDULE RELEASED is silenced — it is the machine sending', () => {
    expect(gateOutbound({ ...g, origin: 'outreach', automated: true })).toEqual({ allow: false, reason: 'silenced' });
  });

  it('a first mail she typed herself is not, for the reason her reply is not', () => {
    expect(gateOutbound({ ...g, origin: 'outreach' })).toEqual({ allow: true, viaTemplate: false });
    expect(gateOutbound({ ...g, origin: 'owner' })).toEqual({ allow: true, viaTemplate: false });
  });

  it('and with the switch off, a scheduled follow-up goes like any other first message', () => {
    expect(gateOutbound({ ...g, silenced: false, origin: 'outreach', automated: true }))
      .toEqual({ allow: true, viaTemplate: false });
  });
});

describe('C4.b · time', () => {
  it('tomorrow in Shanghai is the next 00:00 at UTC+8, whatever time of day it is now', () => {
    expect(nextShanghaiDay(new Date('2026-09-14T15:59:59Z')).toISOString()).toBe('2026-09-14T16:00:00.000Z');
    expect(nextShanghaiDay(new Date('2026-09-14T16:00:00Z')).toISOString()).toBe('2026-09-15T16:00:00.000Z');
    expect(nextShanghaiDay(new Date('2026-09-14T02:00:00Z')).toISOString()).toBe('2026-09-14T16:00:00.000Z');
  });
  it('a step is due its days after the one before was queued', () => {
    expect(dueAfter(NOW, 3).getTime() - NOW.getTime()).toBe(3 * DAY);
  });
});

describe('C4.b · the vocabulary is one list', () => {
  it('the stop reasons in code are exactly the ones the column accepts', () => {
    // The newest migration to redraw the CHECK is the one in force.
    const sql = readFileSync(fileURLToPath(new URL('../../migrations/0051_follow_up_confirmation.sql', import.meta.url)), 'utf8');
    const check = /check \(stop_reason in \(([\s\S]*?)\)\)/.exec(sql)?.[1] ?? '';
    const column = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(column).toEqual([...SEQUENCE_STOPS].sort());
  });

  it('every stop reason tells her what happened, in every locale', () => {
    for (const l of LOCALES) for (const r of SEQUENCE_STOPS) {
      expect(t(l, `seq.stop.${r}` as MessageKey), `${l}/${r}`).not.toBe(`seq.stop.${r}`);
    }
  });
});

describe('C4.b · she approves the words she read', () => {
  const steps = [
    { position: 1, delayDays: 0, subject: 'Canvas totes', body: 'We make them.' },
    { position: 2, delayDays: 2, subject: 'Following up', body: 'Any interest?' },
  ];

  it('any change to any word, delay or order changes the fingerprint', () => {
    const base = stepsFingerprint(steps);
    expect(stepsFingerprint([...steps].reverse()), 'input order must not matter').toBe(base);
    expect(stepsFingerprint([steps[0]!, { ...steps[1]!, body: 'Any interest? ' }])).not.toBe(base);
    expect(stepsFingerprint([steps[0]!, { ...steps[1]!, delayDays: 3 }])).not.toBe(base);
    expect(stepsFingerprint([{ ...steps[0]!, subject: 'Canvas totes!' }, steps[1]!])).not.toBe(base);
  });

  it('a step from the form is refused unless every part is there and in range', () => {
    expect(stepFromForm({ delayDays: '2', subject: 'Hi', body: 'There' })).toEqual({ delayDays: 2, subject: 'Hi', body: 'There' });
    for (const bad of [
      { delayDays: '', subject: 'Hi', body: 'x' }, { delayDays: '61', subject: 'Hi', body: 'x' },
      { delayDays: '-1', subject: 'Hi', body: 'x' }, { delayDays: '1', subject: '  ', body: 'x' },
      { delayDays: '1', subject: 'Hi', body: '' }, { delayDays: '1.5', subject: 'Hi', body: 'x' },
    ]) expect(stepFromForm(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe('C4.b · the pages', () => {
  const detail = (over: Partial<SequenceDetail> = {}): SequenceDetail => ({
    id: '11111111-1111-4111-8111-111111111111', name: 'Totes, autumn', state: 'draft', createdBy: 'Lily',
    approvedBy: null, approvedAt: null, archivedAt: null,
    steps: [{ position: 1, delayDays: 0, subject: 'Canvas totes', body: 'We make them.' }],
    enrollments: [], ...over,
  });
  const contact: ContactRow = {
    id: 'k1', channel: 'email', identity: 'ahmed@gulf.test', displayName: 'Ahmed', company: null,
    source: 'manual', firstSeen: NOW, archivedAt: null,
    consent: { evidence: 'owner_attestation', obtainedAt: NOW, recordedBy: 'Lily' }, suppression: null,
  };

  it('A DRAFT: editable, and only the owner is offered approval — with the fingerprint of what is on the page', () => {
    const d = detail();
    const owner = renderSequenceDetail(d, 'en', null);
    expect(owner).toContain(`action="/app/sequences/${d.id}/steps/1"`);
    expect(owner).toContain(`action="/app/sequences/${d.id}/approve"`);
    expect(owner).toContain(`value="${stepsFingerprint(d.steps)}"`);
    // Her words follow their own direction on every page, whatever the page's.
    expect(owner).toMatch(/<input name="subject" dir="auto"/);
    expect(owner).toMatch(/<textarea name="body" dir="auto"/);
    const staff = renderSequenceDetail(d, 'en', null, { viewer: { isOwner: false } });
    expect(staff).not.toContain('/approve"');
    expect(staff).not.toContain('/archive"');
    expect(staff).toContain(esc(t('en', 'staff.seq.approveWaiting')));
  });

  it('nothing to approve until there is an e-mail to read', () => {
    expect(renderSequenceDetail(detail({ steps: [] }), 'en', null)).not.toContain('/approve"');
  });

  it('APPROVED: the words are shown and nothing can edit them; people can be added', () => {
    const d = detail({ state: 'approved', approvedBy: 'Lily', approvedAt: NOW });
    const html = renderSequenceDetail(d, 'en', null, { eligible: [contact], messagingEnabled: true });
    expect(html).not.toContain('/steps');
    expect(html).not.toContain('/approve"');
    expect(html).toContain(`action="/app/sequences/${d.id}/enroll"`);
    expect(html).toContain('value="ahmed@gulf.test"');
  });

  it('someone already receiving it is not offered again, and nobody is offered where nothing can send', () => {
    const d = detail({
      state: 'approved', approvedBy: 'Lily', approvedAt: NOW,
      enrollments: [{
        id: 'e1', identity: contact.identity, displayName: 'Ahmed', conversationId: null, enrolledBy: 'Lily',
        enrolledAt: NOW, nextPosition: 1, nextDueAt: NOW, stepDueSince: NOW, stoppedAt: null, stopReason: null, completedAt: null,
        confirmedPosition: null, awaitingConfirmationSince: null,
      }],
    });
    expect(renderSequenceDetail(d, 'en', null, { eligible: [contact], messagingEnabled: true }))
      .not.toContain('<option value="ahmed@gulf.test"');
    expect(renderSequenceDetail(detail({ state: 'approved', approvedBy: 'Lily', approvedAt: NOW }), 'en', null,
      { eligible: [contact], messagingEnabled: false })).not.toContain('/enroll"');
  });

  it('a stopped enrolment says why, in every locale, and offers no stop button', () => {
    for (const locale of LOCALES) {
      const html = renderSequenceDetail(detail({
        state: 'approved', approvedBy: 'Lily', approvedAt: NOW,
        enrollments: [{
          id: 'e2', identity: contact.identity, displayName: null, conversationId: 'c1', enrolledBy: 'Lily',
          enrolledAt: NOW, nextPosition: 2, nextDueAt: NOW, stepDueSince: NOW,
          stoppedAt: NOW, stopReason: 'replied', completedAt: null,
          confirmedPosition: null, awaitingConfirmationSince: null,
        }],
      }), locale, null, { messagingEnabled: true });
      expect(html, locale).toContain(esc(t(locale, 'seq.stop.replied')));
      expect(html, locale).not.toContain('/enrollments/e2/stop');
      expect(html, locale).toContain('href="/app/inbox/c1"');
    }
  });

  it('A FOLLOW-UP WAITING FOR HER: it says to look in her own inbox first, when it stops, and offers the release', () => {
    const since = new Date(NOW.getTime() - DAY);
    for (const locale of LOCALES) {
      const html = renderSequenceDetail(detail({
        state: 'approved', approvedBy: 'Lily', approvedAt: NOW,
        enrollments: [{
          id: 'e4', identity: contact.identity, displayName: 'Ahmed', conversationId: 'c1', enrolledBy: 'Lily',
          enrolledAt: NOW, nextPosition: 2, nextDueAt: NOW, stepDueSince: NOW,
          stoppedAt: null, stopReason: null, completedAt: null,
          confirmedPosition: null, awaitingConfirmationSince: since,
        }],
      }), locale, null, { messagingEnabled: true });
      expect(html, locale).toContain('action="/app/sequences/11111111-1111-4111-8111-111111111111/enrollments/e4/confirm"');
      expect(html, locale).toContain('name="position" value="2"');
      expect(html, locale).toContain(esc(t(locale, 'seq.enrolment.confirm')));
      expect(html, locale).toContain(esc(t(locale, 'seq.enrolment.awaiting', {
        n: '2', date: formatDate(locale, new Date(since.getTime() + MAX_HOLD_DAYS * DAY)),
      })));
      // Stopping stays offered beside it: "he did answer" is the other outcome.
      expect(html, locale).toContain('/enrollments/e4/stop');
    }
    // Not waiting: no release to press.
    const plain = renderSequenceDetail(detail({
      state: 'approved', approvedBy: 'Lily', approvedAt: NOW,
      enrollments: [{
        id: 'e5', identity: contact.identity, displayName: null, conversationId: null, enrolledBy: 'Lily',
        enrolledAt: NOW, nextPosition: 2, nextDueAt: NOW, stepDueSince: NOW,
        stoppedAt: null, stopReason: null, completedAt: null,
        confirmedPosition: null, awaitingConfirmationSince: null,
      }],
    }), 'en', null, { messagingEnabled: true });
    expect(plain).not.toContain('/confirm"');
  });

  it('OUT OF USE: no archive button, and its history still reads', () => {
    const html = renderSequenceDetail(detail({
      state: 'archived', approvedBy: 'Lily', approvedAt: NOW, archivedAt: NOW,
      enrollments: [{
        id: 'e3', identity: contact.identity, displayName: null, conversationId: null, enrolledBy: 'Lily',
        enrolledAt: NOW, nextPosition: 1, nextDueAt: NOW, stepDueSince: NOW,
        stoppedAt: NOW, stopReason: 'sequence_archived', completedAt: null,
        confirmedPosition: null, awaitingConfirmationSince: null,
      }],
    }), 'en', null);
    expect(html).not.toContain('/archive"');
    expect(html).toContain(esc(t('en', 'seq.stop.sequence_archived')));
  });

  it('the list links each one, and says when there are none', () => {
    expect(renderSequenceList([], 'en', null)).toContain(esc(t('en', 'seq.empty')));
    const html = renderSequenceList([{
      id: '22222222-2222-4222-8222-222222222222', name: 'Totes', state: 'approved',
      steps: 3, live: 1, finished: 0, stopped: 2, awaiting: 0, createdAt: NOW,
    }], 'ar', null);
    expect(html).toContain('href="/app/sequences/22222222-2222-4222-8222-222222222222"');
    expect(html).not.toContain(esc(t('ar', 'seq.list.awaiting', { count: '0' })));
    const waiting = renderSequenceList([{
      id: '22222222-2222-4222-8222-222222222222', name: 'Totes', state: 'approved',
      steps: 3, live: 1, finished: 0, stopped: 0, awaiting: 1, createdAt: NOW,
    }], 'zh', null);
    expect(waiting).toContain(esc(t('zh', 'seq.list.awaiting', { count: '1' })));
  });
});
