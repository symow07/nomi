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
import { withCallingCode } from '../../core/channel/callingCodes.js';
import { gateOutreach } from '../../core/outreach/gate.js';
import { CHANNEL_REGISTRY, type OutreachChannel, type Requirement } from '../../core/channel/registry.js';
import { outreachEnabled } from '../../db/outreach.js';
import { sendingDomain } from '../../db/sendingDomain.js';
import { satisfiedRequirements } from './channels.js';
import type { TemplateState } from '../../core/channel/window.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t } from './say.js';

import { back, deeper, esc } from './layout.js';
import { face, faceLink } from './faces.js';
import { faceVersions } from '../../db/faces.js';
import { flashBanner, type Flash } from './flash.js';
import { fieldRow, rowsCard, cardActs } from './rows.js';
import { companyLineHtml } from './prospects.js';
import { companyDomainOf } from '../../core/outreach/companyDomain.js';
import type { Enrichment } from '../../db/prospects.js';
import * as show from './values.js';
import { BACK } from './icons.js';

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
  /**
   * C5 — what a company lookup said, by company domain. For the PEOPLE reading
   * this page; nothing on the conversation path can reach it.
   */
  readonly companies?: ReadonlyMap<string, Enrichment>;
  /** C5 — a readable key is on file, so a lookup can be offered. */
  readonly canLookUp?: boolean;
  /** Phase 9 (V1-544) — the search, as typed, and the page of the list. */
  readonly query?: string;
  readonly page?: number;
  /** The warmth run (-14) — the photo's version of each customer who has one kept (`faceVersions`). */
  readonly photos?: ReadonlyMap<string, string>;
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
  return withTenantTx(db, bid.value, async (tx) => {
    const contacts = await listContacts(tx, bid.value);
    return {
      contacts,
      photos: await faceVersions(tx, contacts.flatMap((c) => (c.clientId ? [c.clientId] : []))),
      outreach: await outreachEnabled(tx, bid.value),
      // G14 — with the DOMAIN, so this page and the connections page answer
      // "may she write to someone who never wrote first?" the same way. Without
      // it, a verified domain read as unverified here and the requirement she
      // had already met stayed on her list.
      satisfied: satisfiedRequirements(templateState, await sendingDomain(tx, bid.value), new Date()),
    };
  });
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

/** Her own eyes on her own list: the phone in full, not masked — its country code set apart (phase 9, V1-551). */
const shown = (c: { readonly channel: ContactChannel; readonly identity: string }): string =>
  c.channel === 'whatsapp' ? withCallingCode(c.identity) : c.identity;

/** Phase 9 (V1-544) — one page of the list. */
export const CONTACTS_PAGE = 25;

/**
 * PHASE 9 (V1-543, V1-545, V1-555) — EACH PERSON IS FILED UNDER THE ANSWER.
 *
 * The page asks "may a first message go to this person?". Every row used to
 * answer it three times — a green pill for how they came to be here, the
 * channel and the source, and the gate's refusal — and the answer was the
 * refusal, under a heading that promised the opposite. Now the list is grouped
 * by the gate's own answer (`reachOf`), and the reason is said ONCE, at the
 * head of its group; a row says only who someone is and how they came.
 *
 * Writing first from here is by e-mail only (`writeFirst` takes no other
 * channel), so anyone reached on another channel is filed as such, whatever
 * the gate says about the channel.
 */
type Group = 'can' | 'no_consent' | 'outreach_not_enabled' | 'channel_cannot_initiate' | 'outreach_ceiling' | 'reply_only' | 'stopped';
const GROUP_ORDER: readonly Group[] = ['can', 'no_consent', 'outreach_not_enabled', 'channel_cannot_initiate', 'outreach_ceiling', 'reply_only', 'stopped'];

function groupOf(v: ContactsView, c: ContactRow): Group {
  if (c.suppression) return 'stopped';
  if (c.channel !== 'email') return 'reply_only';
  const reach = reachOf(v, c);
  if (reach.ok) return 'can';
  return reach.error === 'suppressed' ? 'stopped' : reach.error;
}

/** The search: a name, a company or a job title as written, a number by its digits, an address as typed. */
function matches(c: ContactRow, q: string): boolean {
  const fold = (x: string | null | undefined) => (x ?? '').normalize('NFKC').toLocaleLowerCase();
  const want = fold(q.trim());
  if (!want) return true;
  const digits = want.replace(/\D/g, '');
  return [c.displayName, c.company, c.title, c.identity].some((x) => fold(x).includes(want))
    || (digits.length >= 3 && c.identity.replace(/\D/g, '').includes(digits));
}

export function renderContacts(v: ContactsView, locale: Locale, flash: Flash | null): string {
  const q = (v.query ?? '').trim().slice(0, 80);
  const all = v.contacts.map((c) => ({ c, g: groupOf(v, c) }));
  const found = all.filter((x) => matches(x.c, q))
    .sort((a, b) => GROUP_ORDER.indexOf(a.g) - GROUP_ORDER.indexOf(b.g));
  const pages = Math.max(1, Math.ceil(found.length / CONTACTS_PAGE));
  const page = Math.min(Math.max(1, Math.floor(v.page ?? 1)), pages);
  const shownNow = found.slice((page - 1) * CONTACTS_PAGE, page * CONTACTS_PAGE);
  const count = (g: Group) => found.filter((x) => x.g === g).length;

  const row = (c: ContactRow, g: Group): string => {
    const decision = mayContact({ consent: c.consent, suppression: c.suppression });
    const hidden = `<input type="hidden" name="channel" value="${esc(c.channel)}" />
      <input type="hidden" name="identity" value="${esc(c.identity)}" />`;
    const stopped = g === 'stopped';
    // Suppressed: the reason and its date. No action of any kind — there is
    // nothing here that can undo it, so nothing here offers to.
    const state = !decision.ok && decision.error.kind === 'suppressed'
      ? `<span class="st"><span class="pill stop">${esc(t(locale, `contacts.reason.${decision.error.reason}` as MessageKey))}</span>
         <span class="muted since">${esc(t(locale, 'contacts.suppressed.since', { date: show.date(locale, decision.error.at) }))}</span></span>`
      : '';
    /**
     * C5 — what a lookup said about his company, for the person reading. A
     * button to look it up only where there is a company to look up (not a
     * personal mailbox), nothing is known yet, and a key is on file — each click
     * spends one of her credits, so the sentence on it says so.
     */
    const domain = c.channel === 'email' ? companyDomainOf(c.identity) : null;
    const known = domain ? v.companies?.get(domain) : undefined;
    const line = companyLineHtml(locale, known);
    const company = line ? `<div class="muted ct-co">${line}</div>`
      : domain && v.canLookUp && !stopped
        ? `<form method="post" action="/app/contacts/lookup" class="inline ct-co">
            <input type="hidden" name="identity" value="${esc(c.identity)}" />
            <button class="btn" type="submit">${esc(t(locale, 'contacts.lookup.button'))}</button></form>`
        : '';
    // How they came to be here, said once: the evidence when there is some, else the source.
    const how = decision.ok
      ? t(locale, `contacts.evidence.${decision.value.evidence}` as MessageKey)
      : t(locale, `contacts.source.${c.source}` as MessageKey);
    // Nothing on file is a fact of its own, and the attest button beside it acts on it.
    const unsaid = !decision.ok && !stopped ? t(locale, 'contacts.consent.none') : '';
    // The page's own words as they are; what the business typed (a title, a company) isolated.
    const facts = [...[t(locale, `contacts.channel.${c.channel}` as MessageKey), how, unsaid].filter(Boolean).map(esc),
      ...[c.title, c.company].filter((x): x is string => !!x).map((x) => `<bdi>${esc(x)}</bdi>`)].join(' · ');
    /**
     * C4.a — the one act the group's answer allows: write, where the gate has
     * just said yes (a LINK to a page: a first message is written, not dashed
     * off between two other people's rows); say you may, where nothing is on
     * file. Phase 9 (V1-546) — never writing to someone again is a button that
     * opens its own question, not a door drawn like "Find customers ›".
     */
    const actions = stopped ? '' : `
      ${!decision.ok ? `<form method="post" action="/app/contacts/consent" class="inline">${hidden}
        <button class="btn" type="submit">${esc(t(locale, 'contacts.attest.button'))}</button></form>` : ''}
      ${g === 'can' ? deeper(`/app/contacts/write?channel=${encodeURIComponent(c.channel)}&amp;identity=${encodeURIComponent(c.identity)}`,
        t(locale, 'contacts.write.button')) : ''}
      ${/* The warmth run (-16) — the row's act drawn as a button, outlined like its neighbours; ghost words read as a caption. */ ''}<form method="get" action="/app/contacts/suppress" class="inline">${hidden}
        <button class="btn" type="submit">${esc(t(locale, 'contacts.suppress.button'))}</button></form>
      ${c.id ? `<form method="post" action="/app/contacts/${esc(c.id)}/archive" class="inline">
        <button class="btn" type="submit" onclick="return confirm(this.dataset.confirm)"
          data-confirm="${esc(t(locale, 'contacts.archive.confirm', { who: c.displayName ?? shown(c) }))}">${esc(t(locale, 'contacts.archive'))}</button></form>` : ''}`;
    /**
     * The warmth run (w4-settings-b-outreach-14) — a face on every row, the
     * customers' own colour, as on the Inbox and Today. Someone who has
     * written is a customer with a card, and the face opens it; someone added
     * by hand who never wrote has no card, and the face is only their initial.
     */
    const who = c.displayName ?? shown(c);
    const faceHtml = c.clientId
      ? faceLink({ clientId: c.clientId, name: who, photo: v.photos?.get(c.clientId) ?? null }, { size: 'm', label: t(locale, 'buyers.row.card', { who }), className: 'ct-face' })
      : face({ clientId: `${c.channel}:${c.identity}`, name: who }, 'm', 'ct-face');
    return `<li class="ct ${c.archivedAt ? 'gone' : ''} ${stopped ? 'stopped' : ''}">
      ${faceHtml}
      <div class="ct-main">
      <div class="ct-h">
        <span class="who">${c.displayName ? `<bdi>${esc(c.displayName)}</bdi>` : ''}
          <span class="id"><bdi>${esc(shown(c))}</bdi></span></span>
        ${state}
      </div>
      <div class="ct-b muted">${facts}</div>
      ${company}
      ${actions.trim() ? `<div class="ct-a">${actions}</div>` : ''}
      </div>
    </li>`;
  };

  // The head of a group: what it is, how many, and — once — why.
  const why = (g: Group): string => {
    switch (g) {
      case 'outreach_not_enabled': case 'channel_cannot_initiate':
        return `<p class="muted">${esc(t(locale, `contacts.why.${g}` as MessageKey))}</p>${deeper('/app/channels', t(locale, 'nav.channels'))}`;
      case 'outreach_ceiling': case 'reply_only': return `<p class="muted">${esc(t(locale, `contacts.why.${g}` as MessageKey))}</p>`;
      default: return '';
    }
  };
  const groups = GROUP_ORDER.map((g) => {
    const here = shownNow.filter((x) => x.g === g);
    return here.length === 0 ? '' : `<section class="ctgroup">
      <h2 class="ctgroup-h">${esc(t(locale, `contacts.group.${g}` as MessageKey))} <span class="muted">· ${esc(show.count(locale, count(g)))}</span></h2>
      ${why(g)}
      <ul class="cts">${here.map((x) => row(x.c, x.g)).join('')}</ul></section>`;
  }).join('');

  const href = (p: number) => `/app/contacts?${q ? `q=${encodeURIComponent(q)}&amp;` : ''}page=${p}`;
  const position = t(locale, 'buyers.page.position', {
    from: show.count(locale, (page - 1) * CONTACTS_PAGE + 1),
    to: show.count(locale, (page - 1) * CONTACTS_PAGE + shownNow.length),
    total: show.count(locale, found.length),
  });
  const pager = pages > 1 ? `<nav class="pager" aria-label="${esc(t(locale, 'buyers.page.nav'))}">
      ${page > 1 ? back(href(page - 1), t(locale, 'buyers.page.prev')) : ''}
      <span class="caption muted">${esc(position)}</span>
      ${page < pages ? deeper(href(page + 1), t(locale, 'buyers.page.next')) : ''}
    </nav>` : '';

  const search = v.contacts.length === 0 ? '' : `<form class="search" method="get" action="/app/contacts" role="search">
      <input type="search" name="q" value="${esc(q)}" placeholder="${esc(t(locale, 'contacts.search.placeholder'))}" aria-label="${esc(t(locale, 'contacts.search.label'))}" />
      <button class="btn" type="submit">${esc(t(locale, 'buyers.search.go'))}</button>
      ${q ? `<a class="clear" href="/app/contacts">${esc(t(locale, 'buyers.search.clear'))}</a>` : ''}
    </form>`;

  const list = v.contacts.length === 0
    ? `<div class="empty">${esc(t(locale, 'contacts.empty'))}</div>`
    : found.length === 0
      ? `<div class="empty" role="status">${esc(t(locale, 'buyers.search.none', { q }))}</div>`
      : `${groups}${pager}`;

  const canFirst = all.filter((x) => x.g === 'can').length;
  // The hint explains a button. If no row offers that button, the hint is
  // explaining something she cannot see.
  const canAttest = all.some((x) => x.g !== 'stopped' && !mayContact({ consent: x.c.consent, suppression: x.c.suppression }).ok);

  // Phase 9 (V1-544) — adding someone opens above the list, not 71 rows down.
  const add = `<details class="act-fold" id="add"><summary class="btn">${esc(t(locale, 'contacts.add.title'))}</summary>
      <form method="post" action="/app/contacts" class="sform">
        ${rowsCard(null, [
          fieldRow({ label: t(locale, 'contacts.add.channel'), forId: 'ct-channel',
            control: `<select id="ct-channel" name="channel">${CONTACT_CHANNELS.map((ch) =>
              `<option value="${ch}">${esc(t(locale, `contacts.channel.${ch}` as MessageKey))}</option>`).join('')}</select>` }),
          fieldRow({ label: t(locale, 'contacts.add.identity'), forId: 'ct-identity',
            control: `<input id="ct-identity" name="identity" required maxlength="120" />` }),
          fieldRow({ label: t(locale, 'contacts.add.name'), forId: 'ct-name', control: `<input id="ct-name" name="name" maxlength="120" />` }),
          fieldRow({ label: t(locale, 'contacts.add.company'), forId: 'ct-company', control: `<input id="ct-company" name="company" maxlength="120" />` }),
          cardActs(`<button class="btn send" type="submit">${esc(t(locale, 'contacts.add.button'))}</button>`),
        ])}
      </form>
    </details>`;

  // The warmth run (w4-settings-b-outreach-13) — reached from the Inbox, and back there, as every other page here leads back.
  return `${back('/app/inbox', t(locale, 'nav.inbox'))}
    <h1 class="page">${esc(t(locale, 'contacts.title'))}</h1>
    ${flashBanner(flash)}
    <section class="block">
      <p class="muted">${esc(t(locale, 'contacts.intro'))}</p>
      ${v.contacts.length ? `<p class="note">${esc(t(locale, 'contacts.summary', { can: show.count(locale, canFirst), total: show.count(locale, all.length) }))}</p>` : ''}
      ${deeper('/app/sequences', t(locale, 'seq.title'))}
      ${deeper('/app/prospects', t(locale, 'prospects.title'))}
      ${add}
      ${search}
      ${canAttest ? `<p class="muted note">${esc(t(locale, 'contacts.attest.hint'))}</p>` : ''}
      ${list}
    </section>`;
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
 * So the row's button opens this page and this page does the POST. No script —
 * the sentence and a second deliberate press, which is the same thing a
 * confirmation box is for and works with the page turned off.
 *
 * PHASE 9 (V1-557, V1-558, new-12) — it asks the way the product's own dialog
 * asks: the question, what it changes and what it does not (they are still
 * answered when they write — suppression binds only a first message and a
 * follow-up, `gateOutreach`), the act's own words in red, and the way back
 * beside it with the focus, so the reflex lands on going back. Going back is a
 * door, not a button: it changes nothing.
 */
export function renderSuppressConfirm(
  who: { readonly channel: ContactChannel; readonly identity: string; readonly displayName: string | null },
  locale: Locale,
): string {
  const name = who.displayName ?? shown(who);
  return `<h1 class="page">${esc(t(locale, 'contacts.suppress.title', { who: name }))}</h1>
    <section class="block">
      <p>${esc(t(locale, 'contacts.suppress.hint'))}</p>
      <form method="post" action="/app/contacts/suppress" class="confirm">
        <input type="hidden" name="channel" value="${esc(who.channel)}" />
        <input type="hidden" name="identity" value="${esc(who.identity)}" />
        <button class="btn danger" type="submit">${esc(t(locale, 'contacts.suppress.confirm'))}</button>
        <a class="back" href="/app/contacts" autofocus>${BACK}${esc(t(locale, 'contacts.suppress.cancel'))}</a>
      </form>
    </section>`;
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
    readonly flash?: Flash | null;
  } = {},
): string {
  const name = who.displayName ?? shown(who);
  const draft = opts.draft ?? { subject: '', body: '' };
  return `<h1 class="page">${esc(t(locale, 'contacts.write.title', { who: name }))}</h1>
    ${flashBanner(opts.flash ?? null)}
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
          ${back('/app/contacts', t(locale, 'contacts.write.cancel'))}
        </div>
      </form>
    </section>`;
}
