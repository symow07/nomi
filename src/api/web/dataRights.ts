import { sql } from 'kysely';
import { withTenantTx, type Db, type Tx } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t } from './say.js';
import { formatDate } from '../../core/owner/i18n/format.js';
import { deletionDueBy } from '../../core/ops/deletions.js';
import { EXPORT_SUBJECTS, EXPORT_MAX_ROWS, type ExportSubject } from './dataExport.js';
import { back, deeper, esc } from './layout.js';
import { flashBanner, type Flash } from './flash.js';
import type { Viewer } from '../../core/conversation/people.js';
import { waitingAsks, type WaitingAsk } from '../../db/deletionAsks.js';

/**
 * CC-12 + CC-02 — one page for the two things a business may ask of a product
 * that holds its data: give it back, and get rid of it.
 *
 * THEY BELONG TOGETHER. Every data-protection regime that grants the second
 * grants the first, and an owner reaching for deletion almost always wants a
 * copy first. Splitting them across two pages would put the irreversible one
 * somewhere the reversible one is not.
 *
 * WHAT DELETION IS HERE, SAID PLAINLY ON THE PAGE. It is a REQUEST, not a
 * button that erases. The app role holds no DELETE grant on any product table
 * — by design, and `tests/integration/grants.test.ts` holds it — so nothing
 * this route can reach could erase a row even if it tried. A person does the
 * work against the database, following `docs/DATA-DELETION-RUNBOOK.md`.
 *
 * That is slower than a button, and it is what the public pages promise. The
 * row is what makes the promise checkable: before it, a request lived in
 * somebody's inbox and nobody could say how many were open or how old the
 * oldest was.
 *
 * CC-02a — A BUYER'S REQUEST, TOO. A buyer asks the business; the owner
 * records it on that buyer's page (`askBuyerDeletion`), and this page lists
 * every one with the date it must be carried out by — 30 days from being
 * recorded, the number /data-deletion states — and, once the operator has
 * carried it out, the date it was done, which is when the owner tells the
 * buyer. The operator hears of it the day it is recorded, and again every day
 * from a week before the date (`deletionDueAlert`).
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * CC-02a — a buyer asked to be deleted, and the owner writes it down here, on
 * that buyer's page: which buyer (the conversation's client), who recorded it,
 * the note. The deadline starts now — /data-deletion promises the buyer 30
 * days from this moment, and the operator is told as it nears.
 *
 * NOTHING IS ERASED BY THIS. As with the workspace request, the app role holds
 * no DELETE grant; Nomi's operator carries it out by hand, following
 * docs/DATA-DELETION-RUNBOOK.md.
 *
 * ONE OPEN REQUEST PER BUYER. Asked twice, the second is told, not written:
 * the count below answers the ordinary case, and the partial unique index in
 * 0073 answers the race — two presses in the same instant — which surfaces as
 * a unique violation and is read as the same answer.
 *
 * 0076 — AND WHAT WAS ALREADY NOTED IS NOT ASKED FOR AGAIN. A request the
 * buyer made in a message was written down when it arrived (`deletion_asks`),
 * with the conversation, the message and the time. Recording it needs no note
 * — those say how and when they asked — and the request is dated from when
 * they asked, because that is when it was received. The noted row points at
 * the request from then on. The note is required only when nothing was noted.
 */
export async function askBuyerDeletion(
  db: Db, businessIdRaw: string, conversationId: string, note: string | null, actor: string,
): Promise<BuyerAskOutcome> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { outcome: 'failed' };
  if (!UUID.test(conversationId)) return { outcome: 'not_found' };
  try {
    return await withTenantTx(db, bid.value, async (tx): Promise<BuyerAskOutcome> => {
      const client = (await sql<{ client_id: string }>`
        select client_id::text as client_id from conversations
         where id = ${conversationId}::uuid and client_id is not null limit 1`.execute(tx)).rows[0]?.client_id ?? null;
      if (client === null) return { outcome: 'not_found' };
      const open = (await sql<{ n: number }>`
        select count(*)::int as n from deletion_requests
         where client_id = ${client}::uuid and scope = 'buyer' and state = 'open'`.execute(tx)).rows[0]?.n ?? 0;
      if (open > 0) return { outcome: 'already_open' };
      const noted = (await sql<{ id: string; asked_at: Date }>`
        select id::text as id, asked_at from deletion_asks
         where client_id = ${client}::uuid and state = 'waiting'
         for update`.execute(tx)).rows[0] ?? null;
      if (noted === null && note === null) return { outcome: 'note_missing' };
      const row = (await sql<{ id: string; asked_at: Date }>`
        insert into deletion_requests (business_id, scope, client_id, asked_by, subject_note, asked_at)
        values (${bid.value}, 'buyer', ${client}::uuid, ${actor}, ${note},
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
                values (${bid.value}, null, 'deletion_requested', ${actor},
                        ${JSON.stringify({ scope: 'buyer', request: row.id, ...(noted ? { noted: noted.id } : {}) })}::jsonb)`.execute(tx);
      return { outcome: 'asked', requestId: row.id, askedAt: row.asked_at, fromChat: noted !== null };
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return { outcome: 'already_open' };
    throw e;
  }
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
  const links = (subjects: readonly ExportSubject[]) =>
    `<ul class="chips">${subjects.map((s) => `<li>
      <a class="btn" href="/app/settings/data/${s}.csv" download>${esc(t(locale, `data.export.subject.${s}` as MessageKey))}</a>
    </li>`).join('')}</ul>`;
  const CONFIG: readonly ExportSubject[] = ['price-rules', 'selling-terms', 'teaching'];
  const record = EXPORT_SUBJECTS.filter((s) => !CONFIG.includes(s));

  const files = `<section class="block">
    <h2>${esc(t(locale, 'data.export.title'))}</h2>
    <p class="muted">${esc(t(locale, 'data.export.lead'))}</p>
    ${links(record)}
    <h2>${esc(t(locale, 'data.export.configTitle'))}</h2>
    <p class="muted">${esc(t(locale, 'data.export.configLead'))}</p>
    ${links(CONFIG)}
    <p class="muted">${esc(t(locale, 'data.export.limit', { n: EXPORT_MAX_ROWS }))}</p>
  </section>`;

  // G9a's rule, applied here: a page that refuses on submit is worse than a
  // page that says whose decision it is. Staff see the history; they are not
  // shown a form that will turn them away.
  const ask = !viewer.isOwner
    ? `<p class="muted">${esc(t(locale, 'data.deletion.ownerOnly'))}</p>`
    : open
      ? `<div class="flash bad" role="status">${esc(t(locale, 'data.deletion.pending', {
          date: formatDate(locale, open.askedAt),
        }))}</div>
        <form method="post" action="/app/settings/data/withdraw" class="pform">
          <input type="hidden" name="id" value="${esc(open.id)}" />
          <button class="btn" type="submit">${esc(t(locale, 'data.deletion.withdraw'))}</button>
        </form>`
      : `<form method="post" action="/app/settings/data/delete" class="pform"
               onsubmit="return confirm(${esc(JSON.stringify(t(locale, 'data.deletion.confirm')))})">
          <div class="fld"><label for="dr-name">${esc(t(locale, 'data.deletion.typeName', { name: v.businessName }))}</label>
            <input id="dr-name" name="name" required autocomplete="off" spellcheck="false" maxlength="200" /></div>
          <div class="fld"><label for="dr-note">${esc(t(locale, 'data.deletion.why'))}</label>
            <input id="dr-note" name="note" maxlength="500" autocomplete="off" /></div>
          <button class="btn stop" type="submit">${esc(t(locale, 'data.deletion.ask'))}</button>
        </form>`;

  const workspace = v.requests.filter((r) => r.scope === 'workspace');
  const history = workspace.length === 0 ? '' : `<section class="block">
    <h2>${esc(t(locale, 'data.deletion.history'))}</h2>
    <ul class="list">${workspace.map((r) => `<li class="row">
      <span class="person">${esc(t(locale, 'data.deletion.scope.workspace'))}</span>
      <span class="muted">${esc(formatDate(locale, r.askedAt))}</span>
      <span class="pill ${r.state === 'open' ? 'warn' : 'ok'}">${esc(t(locale, STATE_KEY[r.state]))}</span>
      ${r.closedNote ? `<div class="muted"><bdi>${esc(r.closedNote)}</bdi></div>` : ''}
    </li>`).join('')}</ul>
  </section>`;

  return `${back('/app/settings', backLabel)}
    <h1 class="page">${esc(t(locale, 'data.title'))}</h1>
    ${flashBanner(flash)}
    ${files}
    ${buyerRequests(v.buyers ?? [], locale, viewer, v.asks ?? [])}
    <section class="block">
      <h2>${esc(t(locale, 'data.deletion.title'))}</h2>
      <p class="muted">${esc(t(locale, 'data.deletion.lead'))}</p>
      <p class="muted">${esc(t(locale, 'data.deletion.byHand'))}</p>
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
 * CC-02a — the buyers who asked to be deleted. Each is recorded on that
 * buyer's own page; here the owner sees every one in one place — when it was
 * asked, the date it must be carried out by, and when it was done, which is
 * the moment to tell the buyer (Nomi does not write to them about it). While a
 * request is still waiting it can be taken back, with the workspace request's
 * own route: one way back, not two.
 *
 * 0076 — a request noted from a buyer's message leads the list until the owner
 * decides, on the buyer's page, where the door goes.
 */
function buyerRequests(
  buyers: readonly BuyerDeletionRequest[], locale: Locale, viewer: Viewer, asks: readonly WaitingAsk[] = [],
): string {
  const noted = asks.map((a) => `<li class="row">
      <div class="person"><a href="/app/conversations/${encodeURIComponent(a.conversationId)}#deletion"><b><bdi>${esc(a.buyer ?? t(locale, 'common.buyer'))}</bdi></b></a>
        <span class="muted">${esc(t(locale, 'data.buyers.waiting', { asked: formatDate(locale, a.askedAt) }))}</span>
      </div>
      <span class="pill warn">${esc(t(locale, 'data.ask.state.waiting'))}</span>
    </li>`).join('');
  const rows = buyers.map((r) => {
    const who = esc(r.buyer ?? t(locale, 'common.buyer'));
    const name = r.conversationId && r.state !== 'done'
      ? `<a href="/app/conversations/${encodeURIComponent(r.conversationId)}"><b><bdi>${who}</bdi></b></a>`
      : `<b><bdi>${who}</bdi></b>`;
    const asked = formatDate(locale, r.askedAt);
    const when = r.state === 'open'
      ? t(locale, 'data.buyers.due', { asked, due: formatDate(locale, deletionDueBy(r.askedAt)) })
      : r.state === 'done' && r.closedAt
        ? t(locale, 'data.buyers.done', { asked, done: formatDate(locale, r.closedAt) })
        : t(locale, 'data.buyers.asked', { asked });
    const withdraw = r.state === 'open' && viewer.isOwner
      ? `<form method="post" action="/app/settings/data/withdraw" class="inline">
          <input type="hidden" name="id" value="${esc(r.id)}" />
          <button class="btn" type="submit">${esc(t(locale, 'data.deletion.withdraw'))}</button>
        </form>`
      : '';
    return `<li class="row">
      <div class="person">${name}
        <span class="muted">${esc(when)}</span>
        ${r.subjectNote ? `<span class="muted"><bdi>${esc(r.subjectNote)}</bdi></span>` : ''}
        ${r.state === 'refused' && r.closedNote ? `<span class="muted"><bdi>${esc(r.closedNote)}</bdi></span>` : ''}
      </div>
      <span class="pill ${STATE_TONE[r.state]}">${esc(t(locale, STATE_KEY[r.state]))}</span>
      ${withdraw}
    </li>`;
  }).join('');
  return `<section class="block" id="buyers">
    <h2>${esc(t(locale, 'data.buyers.title'))}</h2>
    <p class="muted">${esc(t(locale, 'data.buyers.lead'))}</p>
    <p class="muted">${esc(t(locale, 'data.buyers.fromChat'))}</p>
    ${noted || rows ? `<ul class="rows">${noted}${rows}</ul>` : `<p class="muted">${esc(t(locale, 'data.buyers.none'))}</p>`}
  </section>`;
}

