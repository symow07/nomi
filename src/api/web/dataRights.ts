import { sql } from 'kysely';
import { withTenantTx, type Db, type Tx } from '../../db/client.js';
import { parseBusinessId, type BusinessId } from '../../core/types/ids.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t } from './say.js';

import { EXPORT_SUBJECTS, EXPORT_MAX_ROWS, exportFileName, type ExportSubject } from './dataExport.js';
import { back, deeper, esc } from './layout.js';
import { icon } from './icons.js';
import { flashBanner, type Flash } from './flash.js';
import { fieldRow, rowsCard, cardActs } from './rows.js';
import type { Viewer } from '../../core/conversation/people.js';
import { waitingAsks, type WaitingAsk } from '../../db/deletionAsks.js';
import * as show from './values.js';

/**
 * CC-12 + CC-02 — one page for the two things a business may ask of a product
 * that holds its data: give it back, and get rid of it.
 *
 * THEY BELONG TOGETHER. Every data-protection regime that grants the second
 * grants the first, and an owner reaching for deletion almost always wants a
 * copy first. Splitting them across two pages would put the irreversible one
 * somewhere the reversible one is not.
 *
 * WHAT DELETION IS HERE (0126, the owner's direction of 2026-10-04): the
 * owner's act, at once and for good. A customer's data goes when they ask —
 * the owner deletes it here or on the customer's page — and the whole
 * workspace goes when the owner closes it here, by typing its name. Both are
 * the database's own erasure (`erase_customer`, `close_workspace`): the app
 * role still holds no DELETE on any product table (G20), and the functions
 * carry out exactly the contract the operator's tools carry out. What stays,
 * and why, is said before anything is pressed and again after.
 *
 * Before 0126 both were requests a person carried out by hand within 30 days;
 * a request still open from then can be deleted now, or taken back.
 */

export type DeletionRequest = {
  readonly id: string;
  readonly scope: 'workspace' | 'buyer';
  readonly subjectNote: string | null;
  readonly askedBy: string;
  readonly askedAt: Date;
  readonly state: 'open' | 'withdrawn' | 'done' | 'refused';
  readonly closedAt: Date | null;
  readonly closedNote: string | null;
};

/**
 * CC-02a — a buyer's request, as the owner's pages show it: whom it is about
 * (their name while the business still has one for them) and where their file
 * is, if it is still there.
 */
export type BuyerDeletionRequest = DeletionRequest & {
  readonly buyer: string | null;
  readonly conversationId: string | null;
};

export type DataRightsView = {
  /** Every request for the WHOLE workspace this business has made, newest first. */
  readonly requests: readonly DeletionRequest[];
  /** CC-02a — buyers' requests: every open one first, then the recent rest. */
  readonly buyers?: readonly BuyerDeletionRequest[];
  /** 0076 — requests noted from a buyer's message, waiting for the owner to decide. */
  readonly asks?: readonly WaitingAsk[];
  /** The name she must type to confirm — her own business's. */
  readonly businessName: string;
  /** Phase 9 (V1-496) — the address the legal pages name (`LEGAL_CONTACT_EMAIL`), for "write to us". Absent: no such sentence. */
  readonly contact?: string | null;
  /**
   * 0126 — whether this workspace can be closed here. Not the installation's
   * own workspace (the one the access code opens), never a practice copy.
   * Absent: closable.
   */
  readonly closable?: boolean;
};

type RequestRow = {
  id: string; scope: 'workspace' | 'buyer'; subject_note: string | null; asked_by: string;
  asked_at: Date; state: DeletionRequest['state']; closed_at: Date | null; closed_note: string | null;
};
const requestOf = (x: RequestRow): DeletionRequest => ({
  id: x.id, scope: x.scope, subjectNote: x.subject_note, askedBy: x.asked_by,
  askedAt: x.asked_at, state: x.state, closedAt: x.closed_at, closedNote: x.closed_note,
});

export async function loadDataRights(db: Db, businessIdRaw: string): Promise<DataRightsView> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { requests: [], buyers: [], asks: [], businessName: '' };
  return withTenantTx(db, bid.value, async (tx) => {
    const name = (await sql<{ name: string }>`
      select name from businesses where id = ${bid.value}`.execute(tx)).rows[0]?.name ?? '';
    const r = await sql<RequestRow>`
      select id::text as id, scope, subject_note, asked_by, asked_at, state, closed_at, closed_note
        from deletion_requests where business_id = ${bid.value} and scope = 'workspace'
       order by asked_at desc limit 20`.execute(tx);
    // An open request is never pushed off the list by closed ones: those are
    // the ones with a date still to keep.
    const b = await sql<RequestRow & { buyer: string | null; conversation_id: string | null }>`
      select r.id::text as id, r.scope, r.subject_note, r.asked_by, r.asked_at, r.state,
             r.closed_at, r.closed_note, c.display_name as buyer,
             (select v.id::text from conversations v where v.client_id = r.client_id
               order by v.updated_at desc limit 1) as conversation_id
        from deletion_requests r
        left join clients c on c.id = r.client_id
       where r.business_id = ${bid.value} and r.scope = 'buyer'
       order by (r.state = 'open') desc, r.asked_at desc
       limit 100`.execute(tx);
    return {
      businessName: name,
      requests: r.rows.map(requestOf),
      buyers: b.rows.map((x) => ({ ...requestOf(x), buyer: x.buyer, conversationId: x.conversation_id })),
      asks: await waitingAsks(tx, bid.value),
    };
  });
}

/** CC-02a — the request this buyer's page shows: their latest, in any state. */
export type BuyerDeletionState = {
  readonly state: DeletionRequest['state'];
  readonly askedAt: Date;
  readonly closedAt: Date | null;
  readonly closedNote: string | null;
};

/** Inside the caller's tenant transaction, so the policy scopes it as it scopes the page. */
export async function buyerDeletionOf(tx: Tx, conversationId: string): Promise<BuyerDeletionState | null> {
  const r = (await sql<{ state: DeletionRequest['state']; asked_at: Date; closed_at: Date | null; closed_note: string | null }>`
    select r.state, r.asked_at, r.closed_at, r.closed_note
      from deletion_requests r
     where r.scope = 'buyer'
       and r.client_id = (select client_id from conversations where id = ${conversationId}::uuid)
     order by (r.state = 'open') desc, r.asked_at desc
     limit 1`.execute(tx)).rows[0];
  return r ? { state: r.state, askedAt: r.asked_at, closedAt: r.closed_at, closedNote: r.closed_note } : null;
}

export type AskOutcome = 'asked' | 'already_open' | 'name_wrong' | 'failed';

/**
 * She asks for the whole workspace to go.
 *
 * THE NAME IS TYPED, not a checkbox. This is the one action in the product
 * that a person cannot undo for her, and a confirmation she can give by
 * reflex is not a confirmation. Compared case-insensitively and with the edges
 * trimmed: the test is whether she knows which workspace she is in, not
 * whether she can match whitespace.
 *
 * Pressing it twice is ONE request — a partial unique index in 0064 says so,
 * and the second press is told, not silently duplicated for an operator to
 * reconcile.
 */
export async function askWorkspaceDeletion(
  db: Db, businessIdRaw: string, typedName: string, actor: string, note: string | null = null,
): Promise<AskOutcome> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return 'failed';
  return withTenantTx(db, bid.value, async (tx) => {
    const name = (await sql<{ name: string }>`
      select name from businesses where id = ${bid.value}`.execute(tx)).rows[0]?.name ?? null;
    if (name === null) return 'failed';
    if (typedName.trim().toLocaleLowerCase() !== name.trim().toLocaleLowerCase()) return 'name_wrong';
    const open = (await sql<{ n: number }>`
      select count(*)::int as n from deletion_requests
       where business_id = ${bid.value} and scope = 'workspace' and state = 'open'`.execute(tx)).rows[0]?.n ?? 0;
    if (open > 0) return 'already_open';
    await sql`
      insert into deletion_requests (business_id, scope, asked_by, subject_note)
      values (${bid.value}, 'workspace', ${actor}, ${note})`.execute(tx);
    await sql`insert into channel_audit (business_id, channel_id, action, actor, detail)
              values (${bid.value}, null, 'deletion_requested', ${actor},
                      ${JSON.stringify({ scope: 'workspace' })}::jsonb)`.execute(tx);
    return 'asked';
  });
}

/**
 * …and takes it back, while it is still hers to take back. A request an
 * operator has already carried out cannot be withdrawn, and the update says so
 * by matching on `state = 'open'` rather than by reading and then writing.
 */
export async function withdrawDeletion(
  db: Db, businessIdRaw: string, requestId: string, actor: string,
): Promise<'withdrawn' | 'not_open' | 'failed'> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return 'failed';
  return withTenantTx(db, bid.value, async (tx) => {
    const r = await sql<{ id: string }>`
      update deletion_requests
         set state = 'withdrawn', closed_at = now(), closed_by = ${actor}
       where id = ${requestId}::uuid and business_id = ${bid.value} and state = 'open'
      returning id::text as id`.execute(tx);
    if (r.rows.length === 0) return 'not_open';
    await sql`insert into channel_audit (business_id, channel_id, action, actor, detail)
              values (${bid.value}, null, 'deletion_withdrawn', ${actor},
                      ${JSON.stringify({ request: requestId })}::jsonb)`.execute(tx);
    return 'withdrawn';
  });
}

/**
 * CC-02a — the owner's note on a buyer's request: how and when the buyer
 * asked ("on WhatsApp, 27 September"). REQUIRED, because it is the only record
 * of the asking itself — the buyer's message may be the very thing that is
 * deleted — and BOUNDED, because it is a note, not a transcript. Runs of space
 * collapse to one; nothing is cut silently: too long is refused and said.
 */
export const BUYER_NOTE_MAX = 300;
export function buyerDeletionNote(raw: string):
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reason: 'missing' | 'long' } {
  const value = raw.replace(/\s+/g, ' ').trim();
  if (value === '') return { ok: false, reason: 'missing' };
  if (value.length > BUYER_NOTE_MAX) return { ok: false, reason: 'long' };
  return { ok: true, value };
}

export type BuyerAskOutcome =
  | {
      readonly outcome: 'asked'; readonly requestId: string; readonly askedAt: Date;
      /** 0076 — it was the request noted from their message, now recorded. */
      readonly fromChat: boolean;
    }
  /** Nothing was noted from chat, and the owner gave no note of how they asked. */
  | { readonly outcome: 'already_open' | 'not_found' | 'failed' | 'note_missing' };

/**
 * The request behind a customer's deletion, inside the caller's tenant
 * transaction: their open one if there is one; else the one noted from their
 * message, recorded now and dated from when they asked; else a new one with
 * the owner's note of how and when they asked. 0126 — the owner's "Delete
 * this customer's data now" (`eraseCustomerNow`) calls this and then the
 * erasure, in ONE transaction: a refused erasure leaves nothing recorded.
 */
export async function recordBuyerRequest(
  tx: Tx, businessId: BusinessId, conversationId: string, note: string | null, actor: string,
  options: { readonly reuseOpen?: boolean } = {},
): Promise<BuyerAskOutcome> {
  const client = (await sql<{ client_id: string }>`
    select client_id::text as client_id from conversations
     where id = ${conversationId}::uuid and client_id is not null limit 1`.execute(tx)).rows[0]?.client_id ?? null;
  if (client === null) return { outcome: 'not_found' };
  const open = (await sql<{ id: string; asked_at: Date }>`
    select id::text as id, asked_at from deletion_requests
     where client_id = ${client}::uuid and scope = 'buyer' and state = 'open'
     limit 1`.execute(tx)).rows[0] ?? null;
  if (open !== null) {
    return options.reuseOpen
      ? { outcome: 'asked', requestId: open.id, askedAt: open.asked_at, fromChat: false }
      : { outcome: 'already_open' };
  }
  const noted = (await sql<{ id: string; asked_at: Date }>`
    select id::text as id, asked_at from deletion_asks
     where client_id = ${client}::uuid and state = 'waiting'
     for update`.execute(tx)).rows[0] ?? null;
  if (noted === null && note === null) return { outcome: 'note_missing' };
  const row = (await sql<{ id: string; asked_at: Date }>`
    insert into deletion_requests (business_id, scope, client_id, asked_by, subject_note, asked_at)
    values (${businessId}, 'buyer', ${client}::uuid, ${actor}, ${note},
            coalesce(${noted?.asked_at ?? null}::timestamptz, now()))
    returning id::text as id, asked_at`.execute(tx)).rows[0]!;
  if (noted !== null) {
    await sql`update deletion_asks
                 set state = 'recorded', request_id = ${row.id}::uuid, decided_at = now(), decided_by = ${actor}
               where id = ${noted.id}::uuid and state = 'waiting'`.execute(tx);
  }
  // The trail says a request was made and which one — never the note, and
  // never whom it is about: both are the buyer's, and the row holds them.
  await sql`insert into channel_audit (business_id, channel_id, action, actor, detail)
            values (${businessId}, null, 'deletion_requested', ${actor},
                    ${JSON.stringify({ scope: 'buyer', request: row.id, ...(noted ? { noted: noted.id } : {}) })}::jsonb)`.execute(tx);
  return { outcome: 'asked', requestId: row.id, askedAt: row.asked_at, fromChat: noted !== null };
}

/** ── The page ─────────────────────────────────────────────────────────────── */

const STATE_KEY: Readonly<Record<DeletionRequest['state'], MessageKey>> = {
  open: 'data.deletion.state.open',
  withdrawn: 'data.deletion.state.withdrawn',
  done: 'data.deletion.state.done',
  refused: 'data.deletion.state.refused',
};

export function renderDataRights(
  v: DataRightsView, locale: Locale, flash: Flash | null, viewer: Viewer, backLabel: string,
): string {
  const open = v.requests.find((r) => r.scope === 'workspace' && r.state === 'open') ?? null;

  // Nine links in one run is a wall on a phone. Two headings, because the two
  // halves answer different questions — what happened, and what you set up —
  // and the second half is the one an owner leaving would not think to ask for.
  // Phase 9 (V1-492, V1-497) — each file a row of a card with its own
  // "Download", the settings pages' pattern: a run of chevrons read as a
  // breadcrumb trail. Each half its own section, with the space sections have.
  // The warmth run, phase 9 (w4-settings-a-18) — Download saves a file: its own mark, not a door's chevron;
  // the cards span the column like every other card on the page.
  const links = (subjects: readonly ExportSubject[]) => `<ul class="scard dl-files">${subjects.map((s) => `<li class="row">
      <span>${esc(t(locale, `data.export.subject.${s}` as MessageKey))}</span>
      <a class="dl-get" href="/app/settings/data/${exportFileName(s)}.csv" download>${icon('download')}<span>${esc(t(locale, 'data.export.download'))}</span></a>
    </li>`).join('')}</ul>`;
  // Two sentences side by side: Chinese runs them on after 。, the others leave a space (w4-settings-a-17).
  const both = (a: string, b: string): string => (locale === 'zh' ? `${a}${b}` : `${a} ${b}`);
  const CONFIG: readonly ExportSubject[] = ['price-rules', 'selling-terms', 'teaching'];
  const record = EXPORT_SUBJECTS.filter((s) => !CONFIG.includes(s));

  const files = `<section class="block">
    <h2>${esc(t(locale, 'data.export.title'))}</h2>
    <p class="lede">${esc(t(locale, 'data.export.lead'))}</p>
    ${links(record)}
  </section>
  <section class="block">
    <h2>${esc(t(locale, 'data.export.configTitle'))}</h2>
    <p class="lede">${esc(t(locale, 'data.export.configLead'))}</p>
    ${links(CONFIG)}
    ${/* Phase 9 (V1-500, V1-496) — the limit as a figure is written, and who "us" is, where an address is known. */ ''}<p class="muted">${esc(v.contact
      ? both(t(locale, 'data.export.limit', { n: show.count(locale, EXPORT_MAX_ROWS) }), t(locale, 'data.export.limitWrite', { email: v.contact }))
      : t(locale, 'data.export.limit', { n: show.count(locale, EXPORT_MAX_ROWS) }))}</p>
  </section>`;

  // G9a's rule, applied here: a page that refuses on submit is worse than a
  // page that says whose decision it is. Staff see the history; they are not
  // shown a form that will turn them away.
  //
  // 0126 — CLOSING ERASES, AT ONCE. The owner types the workspace's name and
  // the database erases everything in it (`close_workspace`), signs everyone
  // out and keeps an ids-only line that it happened. An older open request
  // (the operator's to carry out, before closing was a button) can still be
  // taken back.
  const pending = open && viewer.isOwner
    // CC-20 — a standing state, said the way the buyer's page says one (a pill
    // and a sentence): it was drawn as a refusal notice, announced as a passing status.
    ? `<p><span class="pill warn">${esc(t(locale, 'data.deletion.state.open'))}</span>${esc(t(locale, 'data.deletion.pending', {
        date: show.date(locale, open.askedAt),
      }))}</p>
      <form method="post" action="/app/settings/data/withdraw" class="pform">
        <input type="hidden" name="id" value="${esc(open.id)}" />
        <button class="btn" type="submit" onclick="return confirm(this.dataset.confirm)"
          data-confirm="${esc(t(locale, 'data.deletion.withdrawConfirm'))}">${esc(t(locale, 'data.deletion.withdraw'))}</button>
      </form>`
    : '';
  // The installation's own workspace is never erased from inside it: its owner
  // asks the Nomi team, who carry it out with the same steps (erase-workspace).
  const request = open ? '' : `<form method="post" action="/app/settings/data/delete">
          ${rowsCard(null, [
            fieldRow({ label: t(locale, 'data.deletion.typeName', { name: v.businessName }), forId: 'dr-name',
              control: '<input id="dr-name" name="name" required autocomplete="off" spellcheck="false" maxlength="200" />' }),
            fieldRow({ label: t(locale, 'data.deletion.why'), forId: 'dr-note',
              control: '<input id="dr-note" name="note" maxlength="500" autocomplete="off" />' }),
            cardActs(`<button class="btn danger" type="submit" onclick="return confirm(this.dataset.confirm)"
            data-confirm="${esc(t(locale, 'data.deletion.askConfirm'))}">${esc(t(locale, 'data.deletion.ask'))}</button>`),
          ])}
        </form>`;
  const ask = !viewer.isOwner
    ? `<p class="muted">${esc(t(locale, 'data.deletion.ownerOnly'))}</p>`
    : v.closable === false
      ? `<p class="muted">${esc(t(locale, 'data.deletion.protected'))}</p>${pending}${request}`
      // Phase 9 (settings-a-new-13, V1-493) — the request as the settings pages'
      // card of rows; its button red, for what it takes away.
      : `${pending}<form method="post" action="/app/settings/data/close">
          <input type="hidden" name="asked" value="0" />
          ${rowsCard(null, [
            fieldRow({ label: t(locale, 'data.deletion.typeName', { name: v.businessName }), forId: 'dr-name',
              control: '<input id="dr-name" name="name" required autocomplete="off" spellcheck="false" maxlength="200" />' }),
            cardActs(`${/* CC-29 — the product's one way of asking first: on the button, the words in data-confirm. */ ''}<button class="btn danger" type="submit" onclick="return confirm(this.dataset.confirm)"
            data-confirm="${esc(t(locale, 'data.deletion.confirm'))}">${esc(t(locale, 'data.deletion.close'))}</button>`),
          ])}
        </form>`;

  const workspace = v.requests.filter((r) => r.scope === 'workspace');
  const history = workspace.length === 0 ? '' : `<section class="block">
    <h2>${esc(t(locale, 'data.deletion.history'))}</h2>
    <ul class="list">${workspace.map((r) => `<li class="row">
      <span class="person">${esc(t(locale, 'data.deletion.scope.workspace'))}</span>
      <span class="muted">${esc(show.date(locale, r.askedAt))}</span>
      <span class="pill ${r.state === 'open' ? 'warn' : 'ok'}">${esc(t(locale, STATE_KEY[r.state]))}</span>
      ${r.closedNote ? `<div class="muted"><bdi>${esc(r.closedNote)}</bdi></div>` : ''}
    </li>`).join('')}</ul>
  </section>`;

  return `${back('/app/settings/setup', backLabel)}
    <h1 class="page">${esc(t(locale, 'data.title'))}</h1>
    ${flashBanner(flash)}
    ${files}
    ${buyerRequests(v.buyers ?? [], locale, viewer, v.asks ?? [], both)}
    <section class="block" id="close">
      <h2>${esc(t(locale, 'data.deletion.title'))}</h2>
      <p class="lede">${esc(both(t(locale, 'data.deletion.lead'), t(locale, 'data.deletion.now')))}</p>
      ${ask}
    </section>
    ${history}
    ${deeper('/privacy', t(locale, 'legal.privacyLink'))}
    `;
}

/** A state is a state colour: waiting, done, not done; taken back is neutral. */
const STATE_TONE: Readonly<Record<DeletionRequest['state'], string>> = {
  open: 'warn', done: 'ok', refused: 'bad', withdrawn: 'stop',
};

/**
 * CC-02a, 0126 — the customers who asked to be deleted, in one place. The
 * owner deletes from here or from the customer's own page — the same act,
 * the same route (`/app/conversations/:id/deletion/erase`), at once and for
 * good. A request noted from a customer's message leads the list until the
 * owner decides; one still open from before deleting was a button can be
 * deleted or taken back. Done, it says when, and what stayed. Nomi does not
 * write to the customer about it.
 */
function buyerRequests(
  buyers: readonly BuyerDeletionRequest[], locale: Locale, viewer: Viewer, asks: readonly WaitingAsk[] = [],
  _both: (a: string, b: string) => string = (a, b) => `${a} ${b}`,
): string {
  const erase = (conversationId: string) => viewer.isOwner
    ? `<form method="post" action="/app/conversations/${encodeURIComponent(conversationId)}/deletion/erase" class="inline">
          <input type="hidden" name="asked" value="0" />
          <input type="hidden" name="from" value="data" />
          <button class="btn danger" type="submit" onclick="return confirm(this.dataset.confirm)"
            data-confirm="${esc(t(locale, 'conv.deletion.eraseConfirm'))}">${esc(t(locale, 'conv.deletion.erase'))}</button>
        </form>`
    : '';
  const noted = asks.map((a) => `<li class="row">
      <div class="person"><a href="/app/conversations/${encodeURIComponent(a.conversationId)}#deletion"><b><bdi>${esc(a.buyer ?? t(locale, 'common.buyer'))}</bdi></b></a>
        <span class="muted">${esc(t(locale, 'data.buyers.waiting', { asked: show.date(locale, a.askedAt) }))}</span>
      </div>
      <span class="pill warn">${esc(t(locale, 'data.ask.state.waiting'))}</span>
      ${erase(a.conversationId)}
    </li>`).join('');
  const rows = buyers.map((r) => {
    const who = esc(r.buyer ?? t(locale, 'common.buyer'));
    const name = r.conversationId && r.state !== 'done'
      ? `<a href="/app/conversations/${encodeURIComponent(r.conversationId)}#deletion"><b><bdi>${who}</bdi></b></a>`
      : `<b><bdi>${who}</bdi></b>`;
    const asked = show.date(locale, r.askedAt);
    const when = r.state === 'open'
      ? t(locale, 'data.buyers.open', { asked })
      : r.state === 'done' && r.closedAt
        ? t(locale, 'data.buyers.done', { asked, done: show.date(locale, r.closedAt) })
        : t(locale, 'data.buyers.asked', { asked });
    const acts = r.state === 'open' && viewer.isOwner
      ? `${r.conversationId ? erase(r.conversationId) : ''}
        <form method="post" action="/app/settings/data/withdraw" class="inline">
          <input type="hidden" name="id" value="${esc(r.id)}" />
          <button class="btn" type="submit" onclick="return confirm(this.dataset.confirm)"
            data-confirm="${esc(t(locale, 'data.buyers.withdrawConfirm'))}">${esc(t(locale, 'data.deletion.withdraw'))}</button>
        </form>`
      : '';
    return `<li class="row">
      <div class="person">${name}
        <span class="muted">${esc(when)}</span>
        ${r.subjectNote ? `<span class="muted"><bdi>${esc(r.subjectNote)}</bdi></span>` : ''}
        ${r.state === 'done' ? `<span class="muted">${esc(t(locale, 'data.buyers.kept'))}</span>` : ''}
        ${r.state === 'refused' && r.closedNote ? `<span class="muted"><bdi>${esc(r.closedNote)}</bdi></span>` : ''}
      </div>
      <span class="pill ${STATE_TONE[r.state]}">${esc(t(locale, STATE_KEY[r.state]))}</span>
      ${acts}
    </li>`;
  }).join('');
  return `<section class="block" id="buyers">
    <h2>${esc(t(locale, 'data.buyers.title'))}</h2>
    <p class="lede">${esc(t(locale, 'data.buyers.lead'))}</p>
    ${/* The warmth run, phase 9 (w4-settings-a-16) — how a request in a message is listed is a detail for whoever asks:
        folded, so the section opens with one short paragraph, not ninety words. */ ''}<details class="data-more"><summary>${esc(t(locale, 'data.buyers.fromChatTitle'))}</summary>
      <p class="muted small measure-prose">${esc(t(locale, 'data.buyers.fromChat'))}</p></details>
    ${/* Phase 9 (settings-a-new-14) — nobody yet is a state: the empty panel, not one more grey line. */ ''}${noted || rows ? `<ul class="rows">${noted}${rows}</ul>` : `<div class="empty whole">${esc(t(locale, 'data.buyers.none'))}</div>`}
  </section>`;
}
