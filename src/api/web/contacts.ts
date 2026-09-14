import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import {
  CONTACT_CHANNELS, SUPPRESSION_REASONS, mayContact, normalizeIdentity,
  type ContactChannel, type IdentityError, type SuppressionReason,
} from '../../core/outreach/consent.js';
import {
  addContact, archiveContact, contactability, listContacts, recordConsent, suppress,
  type ContactRow,
} from '../../db/contacts.js';
import { displayPhone } from '../../core/channel/phone.js';
import { gateOutreach } from '../../core/outreach/gate.js';
import { CHANNEL_REGISTRY, type OutreachChannel, type Requirement } from '../../core/channel/registry.js';
import { outreachEnabled } from '../../db/outreach.js';
import { sendingDomain } from '../../db/sendingDomain.js';
import { satisfiedRequirements } from './channels.js';
import type { TemplateState } from '../../core/channel/window.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../core/owner/i18n/messages.js';
import { formatDate } from '../../core/owner/i18n/format.js';
import { deeper, esc } from './layout.js';

/**
 * M38 — the page that answers "may I write to this person", for a human.
 *
 * ── WHY THE ACTIONS ARE KEYED ON THE ADDRESS, NOT ON A ROW ────────────────
 *
 * Half of this list has no row. A buyer who wrote to her lives in `clients`,
 * his consent is derived from his own message, and copying him into `contacts`
 * to give the page something to post to would create a second answer to "did he
 * write to us" that goes stale. So every form here carries `channel` and
 * `identity` — which is also exactly what a suppression is keyed on, so an
 * unsubscribe lands on the same key whether it arrives from this page, from a
 * bounce, or from a footer link a year from now.
 *
 * ── NOT OWNER-ONLY, AND THE REASON ────────────────────────────────────────
 *
 * Attesting is not on `OWNER_ONLY`. The value of an attestation is the NAME on
 * it, and the name is recorded whoever does it; the person who took the card at
 * the fair is the person who knows. Suppressing is not on it either, in the
 * safe direction: more hands able to stop a send is never the risk.
 */

export type ContactsView = {
  readonly contacts: readonly ContactRow[];
  /** M42 — her per-channel decision, so the list can say what would happen. */
  readonly outreach: ReadonlyMap<OutreachChannel, boolean>;
  readonly satisfied: ReadonlySet<Requirement>;
};

export type ContactsFlash =
  | 'added' | 'attested' | 'suppressed' | 'archived' | 'failed' | IdentityError;

const asChannel = (v: unknown): ContactChannel | null =>
  CONTACT_CHANNELS.find((c) => c === v) ?? null;
const asReason = (v: unknown): SuppressionReason | null =>
  SUPPRESSION_REASONS.find((r) => r === v) ?? null;

export async function loadContacts(
  db: Db, businessIdRaw: string, templateState: TemplateState = 'none',
): Promise<ContactsView> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { contacts: [], outreach: new Map(), satisfied: satisfiedRequirements(templateState, null, new Date()) };
  return withTenantTx(db, bid.value, async (tx) => ({
    contacts: await listContacts(tx, bid.value),
    outreach: await outreachEnabled(tx, bid.value),
    // G14 — with the DOMAIN, so this page and the connections page answer
    // "may she write to someone who never wrote first?" the same way. Without
    // it, a verified domain read as unverified here and the requirement she
    // had already met stayed on her list.
    satisfied: satisfiedRequirements(templateState, await sendingDomain(tx, bid.value), new Date()),
  }));
}

export async function addContactFrom(db: Db, businessIdRaw: string, form: {
  channel?: unknown; identity?: unknown; name?: unknown; company?: unknown; by: string;
}): Promise<ContactsFlash> {
  const bid = parseBusinessId(businessIdRaw);
  const channel = asChannel(form.channel);
  if (!bid.ok || !channel) return 'failed';

  const identity = normalizeIdentity(channel, typeof form.identity === 'string' ? form.identity : null);
  if (!identity.ok) return identity.error;

  const text = (v: unknown): string | null => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s === '' ? null : s.slice(0, 120);
  };
  await withTenantTx(db, bid.value, (tx) => addContact(tx, bid.value, {
    channel, identity: identity.value,
    displayName: text(form.name), company: text(form.company), createdBy: form.by,
  }));
  return 'added';
}

/**
 * SHE SAYS SO, AND HER NAME GOES ON IT.
 *
 * Refused outright when the identity is already suppressed. Not because the
 * gate would catch it later — it would — but because a page that accepts an
 * attestation it knows is void teaches her that the record means something it
 * does not.
 */
export async function attestConsent(db: Db, businessIdRaw: string, form: {
  channel?: unknown; identity?: unknown; note?: unknown; by: string;
}): Promise<ContactsFlash> {
  const bid = parseBusinessId(businessIdRaw);
  const channel = asChannel(form.channel);
  if (!bid.ok || !channel) return 'failed';
  const identity = normalizeIdentity(channel, typeof form.identity === 'string' ? form.identity : null);
  if (!identity.ok) return identity.error;

  return withTenantTx(db, bid.value, async (tx) => {
    const state = await contactability(tx, bid.value, channel, identity.value);
    if (state.suppression) return 'failed';
    await recordConsent(tx, bid.value, {
      channel, identity: identity.value, evidence: 'owner_attestation',
      note: typeof form.note === 'string' && form.note.trim() ? form.note.trim().slice(0, 200) : null,
      recordedBy: form.by,
    });
    return 'attested';
  });
}

/** NEVER AGAIN. There is no undo, and none is offered. */
export async function suppressIdentity(db: Db, businessIdRaw: string, form: {
  channel?: unknown; identity?: unknown; reason?: unknown; detail?: unknown;
}): Promise<ContactsFlash> {
  const bid = parseBusinessId(businessIdRaw);
  const channel = asChannel(form.channel);
  if (!bid.ok || !channel) return 'failed';
  const identity = normalizeIdentity(channel, typeof form.identity === 'string' ? form.identity : null);
  if (!identity.ok) return identity.error;
  // The page offers one reason, because the one a person can click is the one
  // where a person asked. Bounces and complaints arrive from the channel.
  const reason = asReason(form.reason) ?? 'unsubscribed';

  await withTenantTx(db, bid.value, (tx) => suppress(tx, bid.value, {
    channel, identity: identity.value, reason,
    detail: typeof form.detail === 'string' && form.detail.trim() ? form.detail.trim().slice(0, 200) : null,
  }));
  return 'suppressed';
}

export async function archiveContactById(
  db: Db, businessIdRaw: string, id: string,
): Promise<ContactsFlash> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return 'failed';
  await withTenantTx(db, bid.value, (tx) => archiveContact(tx, bid.value, id));
  return 'archived';
}

/**
 * M42 — would a first message to this person go, if she wrote one now?
 *
 * One call for the list row and for the page that composes the message, so the
 * button she pressed and the page it opened cannot disagree about him.
 *
 * `ceilingReached: false` is not a placeholder: this answers for a list she is
 * reading, and the day's count belongs to the moment a message is actually
 * queued — `writeFirst` asks `outreachFacts`, which counts, and the worker asks
 * again when it sends.
 */
export function reachOf(v: ContactsView, c: ContactRow): ReturnType<typeof gateOutreach> {
  return gateOutreach({
    channel: c.channel, availableHere: CHANNEL_REGISTRY[c.channel].availableHere,
    enabled: v.outreach.get(c.channel) === true,
    satisfied: v.satisfied, consent: c.consent, suppression: c.suppression,
    ceilingReached: false,
  });
}

/** Her own eyes on her own list: the phone in full, not masked. */
const shown = (c: ContactRow): string =>
  c.channel === 'whatsapp' ? displayPhone(c.identity) : c.identity;

export function renderContacts(v: ContactsView, locale: Locale, flash: string | null): string {
  const rows = v.contacts.map((c) => {
    const decision = mayContact({ consent: c.consent, suppression: c.suppression });
    const hidden = `<input type="hidden" name="channel" value="${esc(c.channel)}" />
      <input type="hidden" name="identity" value="${esc(c.identity)}" />`;

    // Suppressed: the state, its reason and its date. No action of any kind —
    // there is nothing here that can undo it, so nothing here offers to.
    const state = !decision.ok && decision.error.kind === 'suppressed'
      ? `<span class="st"><span class="pill stop">${esc(t(locale, `contacts.reason.${decision.error.reason}` as MessageKey))}</span>
         <span class="muted since">${esc(t(locale, 'contacts.suppressed.since',
           { date: formatDate(locale, decision.error.at) }))}</span></span>`
      : decision.ok
        ? `<span class="pill ok">${esc(t(locale, `contacts.evidence.${decision.value.evidence}` as MessageKey))}</span>`
        : `<span class="pill wait">${esc(t(locale, 'contacts.consent.none'))}</span>`;

    const stopped = !decision.ok && decision.error.kind === 'suppressed';

    /**
     * M42 — WOULD A MESSAGE GO, IF SHE ASKED FOR ONE RIGHT NOW?
     *
     * The same `gateOutreach` the send path calls, so what she reads here and
     * what happens there cannot disagree — the M38 pattern (`contactability`
     * feeds the page and the gate) applied one level up.
     *
     * The reason text is the REFUSAL copy, not a second set of sentences
     * written for a preview. `refused.why.*` already reads in the present
     * tense, and two vocabularies for one decision is how the page and the
     * product start saying different things about the same buyer.
     *
     * Nothing is being sent, so no quota is consumed: `ceilingReached` is
     * false because no attempt has been made, not as a placeholder.
     */
    const reach = reachOf(v, c);
    // Suppressed rows already carry it as a pill; saying it twice on one row is
    // noise, not emphasis.
    const outreachLine = stopped ? '' : `<div class="muted reach-line">${esc(reach.ok
      ? t(locale, 'contacts.canWrite')
      : t(locale, `refused.why.${reach.error}` as MessageKey))}</div>`;

    /**
     * C4.a — and the button that acts on the sentence above it.
     *
     * Offered only where the gate has just said yes, so it is never a button
     * that leads to a refusal she was already shown on the same line. It is a
     * LINK to a page rather than a box on this row: a first message to a
     * stranger is written, not dashed off between two other people's rows, and
     * the composer needs a subject as well as a body.
     */
    const writeLink = !reach.ok ? '' : `<a class="btn send"
      href="/app/contacts/write?channel=${encodeURIComponent(c.channel)}&amp;identity=${encodeURIComponent(c.identity)}"
      >${esc(t(locale, 'contacts.write.button'))}</a>`;

    const actions = stopped ? '' : `
      ${decision.ok ? '' : `<form method="post" action="/app/contacts/consent" class="inline">${hidden}
        <button class="btn" type="submit">${esc(t(locale, 'contacts.attest.button'))}</button></form>`}
      ${writeLink}
      <a class="btn stop" href="/app/contacts/suppress?channel=${encodeURIComponent(c.channel)}&amp;identity=${encodeURIComponent(c.identity)}"
        >${esc(t(locale, 'contacts.suppress.button'))}</a>
      ${c.id ? `<form method="post" action="/app/contacts/${esc(c.id)}/archive" class="inline">
        <button class="btn" type="submit">${esc(t(locale, 'contacts.archive'))}</button></form>` : ''}`;
    return `<li class="ct ${c.archivedAt ? 'gone' : ''} ${stopped ? 'stopped' : ''}">
      <div class="ct-h">
        <span class="who">${c.displayName ? `<bdi>${esc(c.displayName)}</bdi>` : ''}
          <span class="id"><bdi>${esc(shown(c))}</bdi></span></span>
        ${state}
      </div>
      <div class="ct-b muted">${esc(t(locale, `contacts.channel.${c.channel}` as MessageKey))}
        　·　${esc(t(locale, `contacts.source.${c.source}` as MessageKey))}
        ${c.company ? `　·　<bdi>${esc(c.company)}</bdi>` : ''}</div>
      ${outreachLine}
      ${actions.trim() ? `<div class="ct-a">${actions}</div>` : ''}
    </li>`;
  }).join('');

  // The hint explains a button. If no row offers that button, the hint is
  // explaining something she cannot see — which the first screenshot showed
  // reading as a stray sentence in the middle of the page.
  const canAttest = v.contacts.some((c) =>
    mayContact({ consent: c.consent, suppression: c.suppression }).ok === false
    && c.suppression === null);

  const list = v.contacts.length === 0
    ? `<div class="empty">${esc(t(locale, 'contacts.empty'))}</div>`
    : `<ul class="cts">${rows}</ul>`;

  return `<h1 class="page">${esc(t(locale, 'contacts.title'))}</h1>
    ${flash ? `<div class="flash" role="status">${esc(flash)}</div>` : ''}
    <section class="block">
      <p class="muted">${esc(t(locale, 'contacts.intro'))}</p>
      ${deeper('/app/sequences', t(locale, 'seq.title'))}
      ${canAttest ? `<p class="muted note">${esc(t(locale, 'contacts.attest.hint'))}</p>` : ''}
      ${list}
    </section>
    <section class="block">
      <h2>${esc(t(locale, 'contacts.add.title'))}</h2>
      <form method="post" action="/app/contacts" class="cform">
        <label class="fld"><span class="muted">${esc(t(locale, 'contacts.add.channel'))}</span>
          <select name="channel">${CONTACT_CHANNELS.map((ch) =>
            `<option value="${ch}">${esc(t(locale, `contacts.channel.${ch}` as MessageKey))}</option>`).join('')}</select></label>
        <label class="fld"><span class="muted">${esc(t(locale, 'contacts.add.identity'))}</span>
          <input name="identity" required maxlength="120" /></label>
        <label class="fld"><span class="muted">${esc(t(locale, 'contacts.add.name'))}</span>
          <input name="name" maxlength="120" /></label>
        <label class="fld"><span class="muted">${esc(t(locale, 'contacts.add.company'))}</span>
          <input name="company" maxlength="120" /></label>
        <button class="btn send" type="submit">${esc(t(locale, 'contacts.add.button'))}</button>
      </form>
    </section>
    <style>
      .cts { list-style:none; margin:var(--space-12) 0; padding:0; }
      .ct { padding:var(--space-12) 0; border-bottom:1px solid var(--color-border); }
      .ct:last-child { border-bottom:0; }
      .ct.gone { opacity:.55; }
      .ct-h { display:flex; align-items:center; justify-content:space-between; gap:var(--space-12);
              flex-wrap:wrap; }
      .ct .id { color:var(--color-ink-secondary); margin-inline-start:var(--space-8); }
      .ct-a { display:flex; gap:var(--space-8); flex-wrap:wrap; margin-top:var(--space-8); }
      .ct-b { font-size:var(--font-size-note); margin-top:var(--space-4); }
      .ct .reach-line { font-size:var(--font-size-note); margin-top:var(--space-8); }
      .ct .st { display:inline-flex; align-items:baseline; gap:var(--space-8); }
      .ct .since { font-size:var(--font-size-note); }
      /* Permanent, and it should read that way at a glance. */
      .ct.stopped .who { color:var(--color-ink-secondary); }
      .pill.stop { background:var(--color-paper-sunk); color:var(--color-ink-secondary); }
      .btn.stop { color:var(--color-ink-secondary); }
      .note { font-size:var(--font-size-note); margin-top:var(--space-8);
              margin-bottom:var(--space-12); }
      .cform { display:grid; gap:var(--space-12); margin-top:var(--space-12); }
    </style>`;
}

/**
 * THE SECOND STEP, and the only place in this product that has one.
 *
 * Everything else an owner can do here is reversible — a state she can set
 * again, a contact she can un-archive by adding it back. Suppression is not,
 * by design and on purpose, and the first screenshot of this page showed the
 * consequence: an irreversible action sitting one stray click away on every
 * row of a list of buyers she is actively talking to.
 *
 * So the row links here and this page does the POST. No dialog, no script —
 * the sentence and a second deliberate press, which is the same thing a
 * confirmation box is for and works with the page turned off.
 *
 * GOING BACK IS THE PRIMARY BUTTON, and that is not decoration. The first
 * version of this page made the permanent action the green one, in the same
 * style as "Add them" — so the reflex that gets a person through every other
 * page in this product would land on the one action it cannot take back.
 */
export function renderSuppressConfirm(
  who: { readonly channel: ContactChannel; readonly identity: string; readonly displayName: string | null },
  locale: Locale,
): string {
  const name = who.displayName ?? (who.channel === 'whatsapp' ? displayPhone(who.identity) : who.identity);
  return `<h1 class="page">${esc(t(locale, 'contacts.suppress.title', { who: name }))}</h1>
    <section class="block">
      <p class="muted">${esc(t(locale, 'contacts.suppress.hint'))}</p>
      <form method="post" action="/app/contacts/suppress" class="confirm">
        <input type="hidden" name="channel" value="${esc(who.channel)}" />
        <input type="hidden" name="identity" value="${esc(who.identity)}" />
        <a class="btn send" href="/app/contacts">${esc(t(locale, 'contacts.suppress.cancel'))}</a>
        <button class="btn stop" type="submit">${esc(t(locale, 'contacts.suppress.confirm'))}</button>
      </form>
    </section>
    <style>
      .confirm { display:flex; gap:var(--space-12); align-items:center;
                 flex-wrap:wrap; margin-top:var(--space-12); }
    </style>`;
}

/**
 * C4.a — THE FIRST MESSAGE, written on its own page.
 *
 * A subject and a body, because a mail is both and neither is invented for her
 * (`subject_missing` refuses a row without one). The hint above the form says
 * the three things that are true of every first message and that she should
 * know before pressing send, not after: it is in her name, it carries a way for
 * him to stop hearing from her, and it counts against her day.
 *
 * GOING BACK IS NOT THE PRIMARY BUTTON HERE, unlike the suppression page. That
 * page asks her to confirm something permanent; this one is the thing she came
 * to do, and the button that does it is the one her reflex should land on.
 *
 * The route renders this only after `gateOutreach` has said yes for this buyer,
 * so the page never offers a send it already knows will be refused.
 */
export function renderWriteFirst(
  who: { readonly channel: ContactChannel; readonly identity: string; readonly displayName: string | null },
  locale: Locale,
  opts: {
    /** What she had typed, kept when the page comes back to her. */
    readonly draft?: { readonly subject: string; readonly body: string };
    readonly flash?: string | null;
  } = {},
): string {
  const name = who.displayName ?? (who.channel === 'whatsapp' ? displayPhone(who.identity) : who.identity);
  const draft = opts.draft ?? { subject: '', body: '' };
  return `<h1 class="page">${esc(t(locale, 'contacts.write.title', { who: name }))}</h1>
    ${opts.flash ? `<div class="flash" role="status">${esc(opts.flash)}</div>` : ''}
    <section class="block">
      <p class="muted">${esc(t(locale, 'contacts.write.hint'))}</p>
      <form method="post" action="/app/contacts/write" class="wform">
        <input type="hidden" name="channel" value="${esc(who.channel)}" />
        <input type="hidden" name="identity" value="${esc(who.identity)}" />
        <label class="fld"><span class="muted">${esc(t(locale, 'contacts.write.subject'))}</span>
          <input name="subject" dir="auto" required maxlength="200" value="${esc(draft.subject)}" /></label>
        <label class="fld"><span class="muted">${esc(t(locale, 'contacts.write.body'))}</span>
          <textarea name="body" dir="auto" required maxlength="5000" rows="10">${esc(draft.body)}</textarea></label>
        <div class="wact">
          <button class="btn send" type="submit">${esc(t(locale, 'contacts.write.send'))}</button>
          <a class="btn" href="/app/contacts">${esc(t(locale, 'contacts.write.cancel'))}</a>
        </div>
      </form>
    </section>
    <style>
      .wform { display:grid; gap:var(--space-12); margin-top:var(--space-12); }
      .wform textarea { width:100%; font:inherit; }
      .wact { display:flex; gap:var(--space-12); align-items:center; flex-wrap:wrap; }
    </style>`;
}
