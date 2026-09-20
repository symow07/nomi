import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import {
  MAX_STEPS, addStep, approveSequence, archiveSequence, confirmFollowUp, createSequence, listSequences, loadSequence,
  stepsFingerprint, stopEnrollment, updateStep,
  type Enrollment, type SequenceDetail, type SequenceSummary,
} from '../../db/sequences.js';
import type { ContactRow } from '../../db/contacts.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t } from './say.js';
import { formatDate } from '../../core/owner/i18n/format.js';
import { MAX_HOLD_DAYS } from '../../core/outreach/sequence.js';
import { OWNER_VIEW, type Viewer } from '../../core/conversation/people.js';
import { back, esc } from './layout.js';
import { flashBanner, type Flash } from './flash.js';

/**
 * C4.b — a first e-mail and the follow-ups after it, as she reads and writes them.
 *
 * The page speaks of "e-mails" and "follow-ups", never "sequence" or "steps":
 * those are the product's words for the rows, and she is writing letters.
 *
 * ── WHO MAY DO WHAT ───────────────────────────────────────────────────────
 *
 * Anyone signed in may write a draft, add someone to an approved one, or stop
 * one that is running — the name goes on each, and stopping is the safe
 * direction. APPROVING and TAKING OUT OF USE are the owner's: approval is the
 * decision that words go out in her name to people who never wrote to her, and
 * the database makes it permanent (0047). A staff member sees the state and a
 * sentence saying it waits for her, never the button.
 */

export type SequenceFlash =
  | 'created' | 'saved' | 'added' | 'full' | 'notDraft' | 'invalid'
  | 'approved' | 'changed' | 'empty' | 'archived'
  | 'enrolled' | 'already' | 'notApproved' | 'stopped' | 'failed' | 'notLive'
  | 'confirmed' | 'notWaiting';

/** A step as the form sent it, or null when any part of it is not a step. */
export function stepFromForm(b: Record<string, unknown>): { delayDays: number; subject: string; body: string } | null {
  const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string).trim() : '');
  const days = str('delayDays');
  if (!/^\d{1,2}$/.test(days) || Number(days) > 60) return null;
  const subject = str('subject'); const body = str('body');
  if (!subject || !body || subject.length > 200 || body.length > 5000) return null;
  return { delayDays: Number(days), subject, body };
}

const tenant = (raw: string) => {
  const bid = parseBusinessId(raw);
  return bid.ok ? bid.value : null;
};

export async function loadSequenceList(db: Db, businessIdRaw: string): Promise<readonly SequenceSummary[]> {
  const bid = tenant(businessIdRaw);
  return bid ? withTenantTx(db, bid, (tx) => listSequences(tx, bid)) : [];
}

export async function loadSequenceDetail(db: Db, businessIdRaw: string, id: string): Promise<SequenceDetail | null> {
  const bid = tenant(businessIdRaw);
  return bid ? withTenantTx(db, bid, (tx) => loadSequence(tx, bid, id)) : null;
}

export async function createSequenceFrom(
  db: Db, businessIdRaw: string, form: { name?: unknown; by: string },
): Promise<{ readonly flash: SequenceFlash; readonly id: string | null }> {
  const bid = tenant(businessIdRaw);
  const name = typeof form.name === 'string' ? form.name.trim().slice(0, 120) : '';
  if (!bid || !name) return { flash: 'invalid', id: null };
  const id = await withTenantTx(db, bid, (tx) => createSequence(tx, bid, { name, by: form.by }));
  return { flash: 'created', id };
}

export async function addStepFrom(db: Db, businessIdRaw: string, id: string, b: Record<string, unknown>): Promise<SequenceFlash> {
  const bid = tenant(businessIdRaw); const step = stepFromForm(b);
  if (!bid || !step) return 'invalid';
  const r = await withTenantTx(db, bid, (tx) => addStep(tx, bid, id, step));
  return r === 'added' ? 'added' : r === 'full' ? 'full' : 'notDraft';
}

export async function updateStepFrom(
  db: Db, businessIdRaw: string, id: string, position: number, b: Record<string, unknown>,
): Promise<SequenceFlash> {
  const bid = tenant(businessIdRaw); const step = stepFromForm(b);
  if (!bid || !step || !Number.isInteger(position)) return 'invalid';
  const r = await withTenantTx(db, bid, (tx) => updateStep(tx, bid, id, position, step));
  return r === 'saved' ? 'saved' : 'notDraft';
}

export async function approveSequenceFrom(
  db: Db, businessIdRaw: string, id: string, form: { fingerprint?: unknown; by: string },
): Promise<SequenceFlash> {
  const bid = tenant(businessIdRaw);
  if (!bid || typeof form.fingerprint !== 'string') return 'failed';
  const r = await withTenantTx(db, bid, (tx) =>
    approveSequence(tx, bid, id, { by: form.by, fingerprint: form.fingerprint as string }));
  return r === 'approved' ? 'approved' : r === 'changed' ? 'changed' : r === 'empty' ? 'empty' : 'notDraft';
}

export async function archiveSequenceById(db: Db, businessIdRaw: string, id: string): Promise<SequenceFlash> {
  const bid = tenant(businessIdRaw);
  if (!bid) return 'failed';
  return (await withTenantTx(db, bid, (tx) => archiveSequence(tx, bid, id))) ? 'archived' : 'failed';
}

/**
 * "He has not answered — send it." Anyone signed in may say so, as anyone may
 * stop it: the words were already approved by her, and this releases one of
 * them to a man who has not written back, with the person's name on it.
 */
export async function confirmFollowUpById(
  db: Db, businessIdRaw: string, enrollmentId: string, positionRaw: unknown, by: string,
): Promise<SequenceFlash> {
  const bid = tenant(businessIdRaw);
  if (!bid) return 'failed';
  const position = typeof positionRaw === 'string' && /^\d{1,2}$/.test(positionRaw) ? Number(positionRaw) : NaN;
  if (!Number.isInteger(position)) return 'notWaiting';
  return (await withTenantTx(db, bid, (tx) => confirmFollowUp(tx, bid, enrollmentId, position, by)))
    ? 'confirmed' : 'notWaiting';
}

export async function stopEnrollmentById(db: Db, businessIdRaw: string, enrollmentId: string): Promise<SequenceFlash> {
  const bid = tenant(businessIdRaw);
  if (!bid) return 'failed';
  return (await withTenantTx(db, bid, (tx) => stopEnrollment(tx, bid, enrollmentId, 'stopped_by_owner')))
    ? 'stopped' : 'failed';
}

const STATE_TONE = { draft: 'wait', approved: 'ok', archived: 'stop' } as const;

const statePill = (locale: Locale, state: SequenceSummary['state']): string =>
  `<span class="pill ${STATE_TONE[state]}">${esc(t(locale, `seq.state.${state}` as MessageKey))}</span>`;

export function renderSequenceList(
  list: readonly SequenceSummary[], locale: Locale, flash: Flash | null,
): string {
  const rows = list.map((s) => `<li class="sq ${s.state === 'archived' ? 'gone' : ''}">
      <div class="sq-h"><a class="sq-name" href="/app/sequences/${esc(s.id)}"><bdi>${esc(s.name)}</bdi></a>
        ${statePill(locale, s.state)}${s.awaiting > 0
          ? ` <span class="pill wait">${esc(t(locale, 'seq.list.awaiting', { count: String(s.awaiting) }))}</span>` : ''}</div>
      <div class="muted sq-b">${esc(t(locale, 'seq.list.counts', {
        steps: String(s.steps), live: String(s.live), finished: String(s.finished), stopped: String(s.stopped),
      }))}</div>
    </li>`).join('');

  return `${back('/app/contacts', t(locale, 'contacts.title'))}
    <h1 class="page">${esc(t(locale, 'seq.title'))}</h1>
    ${flashBanner(flash)}
    <section class="block">
      <p class="muted">${esc(t(locale, 'seq.intro'))}</p>
      ${list.length === 0 ? `<div class="empty">${esc(t(locale, 'seq.empty'))}</div>` : `<ul class="sqs">${rows}</ul>`}
    </section>
    <section class="block">
      <h2>${esc(t(locale, 'seq.new.title'))}</h2>
      <form method="post" action="/app/sequences" class="sqform">
        <label class="fld"><span class="muted">${esc(t(locale, 'seq.new.name'))}</span>
          <input name="name" required maxlength="120" /></label>
        <button class="btn send" type="submit">${esc(t(locale, 'seq.new.button'))}</button>
      </form>
    </section>
    <style>
      .sqs { list-style:none; margin:var(--space-12) 0; padding:0; }
      .sq { padding:var(--space-12) 0; border-bottom:1px solid var(--color-border); }
      .sq:last-child { border-bottom:0; }
      .sq.gone { opacity:.55; }
      .sq-h { display:flex; align-items:center; justify-content:space-between; gap:var(--space-12); flex-wrap:wrap; }
      .sq-name { font-weight:600; }
      .sq-b { font-size:var(--font-size-note); margin-top:var(--space-4); }
      .sqform { display:grid; gap:var(--space-12); margin-top:var(--space-12); }
    </style>`;
}

/**
 * Every field and block holding HER words takes `dir="auto"`: an owner using
 * the Arabic page often writes to a buyer in English, and a field that inherits
 * the page's direction lays her sentence out right-to-left — the first
 * screenshot put the comma of "Hello Ahmed," at the front of the line.
 */

/** When a step goes, in her terms. */
function whenLine(locale: Locale, position: number, delayDays: number): string {
  const key = position === 1
    ? (delayDays === 0 ? 'seq.step.when.firstNow' : 'seq.step.when.first')
    : 'seq.step.when.next';
  return t(locale, key as MessageKey, { days: String(delayDays) });
}

function stepFields(locale: Locale, s: { delayDays: number; subject: string; body: string } | null): string {
  return `<label class="fld"><span class="muted">${esc(t(locale, 'seq.step.delayDays'))}</span>
      <input name="delayDays" type="number" inputmode="numeric" min="0" max="60" step="1" required
        value="${s ? String(s.delayDays) : ''}" /></label>
    <label class="fld"><span class="muted">${esc(t(locale, 'contacts.write.subject'))}</span>
      <input name="subject" dir="auto" required maxlength="200" value="${esc(s?.subject ?? '')}" /></label>
    <label class="fld"><span class="muted">${esc(t(locale, 'contacts.write.body'))}</span>
      <textarea name="body" dir="auto" required maxlength="5000" rows="6">${esc(s?.body ?? '')}</textarea></label>`;
}

function enrollmentLine(locale: Locale, e: Enrollment, seqId: string): string {
  const who = e.displayName ? `<bdi>${esc(e.displayName)}</bdi> <span class="id"><bdi>${esc(e.identity)}</bdi></span>`
    : `<bdi>${esc(e.identity)}</bdi>`;
  const live = e.stoppedAt === null && e.completedAt === null;
  const awaiting = live && e.awaitingConfirmationSince !== null;
  const state = e.stopReason
    ? `<span class="pill stop">${esc(t(locale, `seq.stop.${e.stopReason}` as MessageKey))}</span>`
    : e.completedAt
      ? `<span class="pill ok">${esc(t(locale, 'seq.enrolment.done'))}</span>`
      : awaiting
        ? `<span class="pill wait">${esc(t(locale, 'seq.enrolment.waitingPill'))}</span>`
        : `<span class="muted">${esc(t(locale, 'seq.enrolment.next', {
            n: String(e.nextPosition), date: formatDate(locale, e.nextDueAt),
          }))}</span>`;
  // Replies reach her own mailbox, not this page: say so where the button is,
  // so nobody presses it without having looked there.
  const ask = awaiting
    ? `<p class="muted">${esc(t(locale, 'seq.enrolment.awaiting', {
        n: String(e.nextPosition),
        date: formatDate(locale, new Date(e.awaitingConfirmationSince!.getTime() + MAX_HOLD_DAYS * 24 * 3600_000)),
      }))}</p>` : '';
  const confirm = awaiting ? `<form method="post" action="/app/sequences/${esc(seqId)}/enrollments/${esc(e.id)}/confirm" class="inline">
      <input type="hidden" name="position" value="${esc(String(e.nextPosition))}" />
      <button class="btn send" type="submit">${esc(t(locale, 'seq.enrolment.confirm'))}</button></form>` : '';
  const thread = e.conversationId
    ? `<a href="/app/inbox/${esc(e.conversationId)}">${esc(t(locale, 'seq.enrolment.thread'))}</a>` : '';
  const stop = live ? `<form method="post" action="/app/sequences/${esc(seqId)}/enrollments/${esc(e.id)}/stop" class="inline">
      <button class="btn stop" type="submit">${esc(t(locale, 'seq.enrolment.stop'))}</button></form>` : '';
  return `<li class="en ${live ? '' : 'gone'}"><div class="en-h"><span class="who">${who}</span>${state}</div>
    ${ask}${thread || stop || confirm ? `<div class="en-a">${confirm}${thread}${stop}</div>` : ''}</li>`;
}

export function renderSequenceDetail(
  d: SequenceDetail, locale: Locale, flash: Flash | null,
  opts: {
    readonly viewer?: Viewer;
    /** E-mail contacts the outreach gate says may be written to now. */
    readonly eligible?: readonly ContactRow[];
    /** Deployment mode: nothing can be sent, so nobody can be added. */
    readonly messagingEnabled?: boolean;
  } = {},
): string {
  const viewer = opts.viewer ?? OWNER_VIEW;
  const id = esc(d.id);
  const draft = d.state === 'draft';

  const steps = d.steps.map((s) => `<li class="st">
      <div class="st-h"><span class="st-n">${esc(t(locale, 'seq.step.label', { n: String(s.position) }))}</span>
        <span class="muted st-w">${esc(whenLine(locale, s.position, s.delayDays))}</span></div>
      ${draft
        ? `<form method="post" action="/app/sequences/${id}/steps/${s.position}" class="sqform">
            ${stepFields(locale, s)}
            <button class="btn" type="submit">${esc(t(locale, 'seq.step.save'))}</button></form>`
        : `<div class="st-s" dir="auto">${esc(s.subject)}</div><div class="st-b" dir="auto">${esc(s.body)}</div>`}
    </li>`).join('');

  const addForm = draft && d.steps.length < MAX_STEPS ? `
    <section class="block">
      <h2>${esc(t(locale, d.steps.length === 0 ? 'seq.step.addFirst' : 'seq.step.add'))}</h2>
      <form method="post" action="/app/sequences/${id}/steps" class="sqform">
        ${stepFields(locale, null)}
        <button class="btn send" type="submit">${esc(t(locale, 'seq.step.addButton'))}</button>
      </form>
    </section>` : '';

  const approval = !draft || d.steps.length === 0 ? '' : viewer.isOwner ? `
    <section class="block">
      <p class="muted">${esc(t(locale, 'seq.approve.hint'))}</p>
      <form method="post" action="/app/sequences/${id}/approve" class="inline">
        <input type="hidden" name="fingerprint" value="${esc(stepsFingerprint(d.steps))}" />
        <button class="btn send" type="submit">${esc(t(locale, 'seq.approve.button'))}</button>
      </form>
    </section>` : `<section class="block"><p class="muted">${esc(t(locale, 'staff.seq.approveWaiting'))}</p></section>`;

  const approvedLine = d.approvedAt && d.approvedBy
    ? `<p class="muted">${esc(t(locale, 'seq.approved.by', { who: d.approvedBy, date: formatDate(locale, d.approvedAt) }))}</p>` : '';

  const eligible = (opts.eligible ?? []).filter((c) =>
    !d.enrollments.some((e) => e.identity === c.identity && e.stoppedAt === null && e.completedAt === null));
  const enrol = d.state !== 'approved' ? '' : `
    <section class="block">
      <h2>${esc(t(locale, 'seq.enroll.title'))}</h2>
      ${opts.messagingEnabled === false
        ? `<p class="muted">${esc(t(locale, 'contacts.flash.notLive'))}</p>`
        : eligible.length === 0
          ? `<p class="muted">${esc(t(locale, 'seq.enroll.none'))}</p>`
          : `<form method="post" action="/app/sequences/${id}/enroll" class="sqform">
              <label class="fld"><span class="muted">${esc(t(locale, 'seq.enroll.choose'))}</span>
                <select name="identity">${eligible.map((c) =>
                  `<option value="${esc(c.identity)}">${esc(c.displayName ? `${c.displayName} · ${c.identity}` : c.identity)}</option>`).join('')}</select></label>
              <button class="btn send" type="submit">${esc(t(locale, 'seq.enroll.button'))}</button>
            </form>`}
      ${d.enrollments.length === 0 ? '' : `<ul class="ens">${d.enrollments.map((e) => enrollmentLine(locale, e, d.id)).join('')}</ul>`}
    </section>`;

  const history = d.state === 'archived' && d.enrollments.length > 0
    ? `<section class="block"><ul class="ens">${d.enrollments.map((e) => enrollmentLine(locale, e, d.id)).join('')}</ul></section>` : '';

  const archive = d.state === 'archived' || !viewer.isOwner ? '' : `
    <section class="block">
      <p class="muted">${esc(t(locale, 'seq.archive.hint'))}</p>
      <form method="post" action="/app/sequences/${id}/archive" class="inline">
        <button class="btn stop" type="submit">${esc(t(locale, 'seq.archive.button'))}</button>
      </form>
    </section>`;

  return `${back('/app/sequences', t(locale, 'seq.title'))}
    <h1 class="page"><bdi>${esc(d.name)}</bdi> ${statePill(locale, d.state)}</h1>
    ${flashBanner(flash)}
    <section class="block">
      <p class="muted">${esc(t(locale, draft ? 'seq.draft.hint' : 'seq.frozen.hint'))}</p>
      ${approvedLine}
      ${d.steps.length === 0 ? `<div class="empty">${esc(t(locale, 'seq.steps.empty'))}</div>` : `<ol class="sts">${steps}</ol>`}
    </section>
    ${addForm}${approval}${enrol}${history}${archive}
    <style>
      .sts, .ens { list-style:none; margin:var(--space-12) 0 0; padding:0; }
      .st, .en { padding:var(--space-12) 0; border-bottom:1px solid var(--color-border); }
      .st:last-child, .en:last-child { border-bottom:0; }
      .st-h, .en-h { display:flex; align-items:baseline; justify-content:space-between; gap:var(--space-12); flex-wrap:wrap; }
      .st-n { font-weight:600; }
      .st-w { font-size:var(--font-size-note); }
      .st-s { font-weight:600; margin-top:var(--space-8); }
      .st-b { white-space:pre-wrap; margin-top:var(--space-4); }
      .en.gone { opacity:.7; }
      .en .id { color:var(--color-ink-secondary); margin-inline-start:var(--space-8); }
      .en-a { display:flex; gap:var(--space-12); align-items:center; flex-wrap:wrap; margin-top:var(--space-8); }
      .sqform { display:grid; gap:var(--space-12); margin-top:var(--space-12); }
      .sqform textarea { width:100%; font:inherit; }
      .pill.stop { background:var(--color-paper-sunk); color:var(--color-ink-secondary); }
      .pill.wait { background:var(--color-paper-sunk); color:var(--color-ink-secondary); }
    </style>`;
}
