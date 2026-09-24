import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t } from './say.js';
import { formatDate } from '../../core/owner/i18n/format.js';
import { EXPORT_SUBJECTS, EXPORT_MAX_ROWS, type ExportSubject } from './dataExport.js';
import { back, deeper, esc } from './layout.js';
import { flashBanner, type Flash } from './flash.js';
import type { Viewer } from '../../core/conversation/people.js';

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

export type DataRightsView = {
  /** Every request this workspace has made, newest first. */
  readonly requests: readonly DeletionRequest[];
  /** The name she must type to confirm — her own business's. */
  readonly businessName: string;
};

export async function loadDataRights(db: Db, businessIdRaw: string): Promise<DataRightsView> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { requests: [], businessName: '' };
  return withTenantTx(db, bid.value, async (tx) => {
    const name = (await sql<{ name: string }>`
      select name from businesses where id = ${bid.value}`.execute(tx)).rows[0]?.name ?? '';
    const r = await sql<{
      id: string; scope: 'workspace' | 'buyer'; subject_note: string | null; asked_by: string;
      asked_at: Date; state: DeletionRequest['state']; closed_at: Date | null; closed_note: string | null;
    }>`
      select id::text as id, scope, subject_note, asked_by, asked_at, state, closed_at, closed_note
        from deletion_requests where business_id = ${bid.value}
       order by asked_at desc limit 20`.execute(tx);
    return {
      businessName: name,
      requests: r.rows.map((x) => ({
        id: x.id, scope: x.scope, subjectNote: x.subject_note, askedBy: x.asked_by,
        askedAt: x.asked_at, state: x.state, closedAt: x.closed_at, closedNote: x.closed_note,
      })),
    };
  });
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
    `<ul class="dl">${subjects.map((s) => `<li>
      <a class="btn" href="/app/settings/data/${s}.csv" download>${esc(t(locale, `data.export.subject.${s}` as MessageKey))}</a>
    </li>`).join('')}</ul>`;
  const CONFIG: readonly ExportSubject[] = ['price-rules', 'selling-terms', 'teaching'];
  const record = EXPORT_SUBJECTS.filter((s) => !CONFIG.includes(s));

  const files = `<section class="block">
    <h2>${esc(t(locale, 'data.export.title'))}</h2>
    <p class="muted">${esc(t(locale, 'data.export.lead'))}</p>
    ${links(record)}
    <h2 class="second">${esc(t(locale, 'data.export.configTitle'))}</h2>
    <p class="muted">${esc(t(locale, 'data.export.configLead'))}</p>
    ${links(CONFIG)}
    <p class="muted micro">${esc(t(locale, 'data.export.limit', { n: EXPORT_MAX_ROWS }))}</p>
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

  const history = v.requests.length === 0 ? '' : `<section class="block">
    <h2>${esc(t(locale, 'data.deletion.history'))}</h2>
    <ul class="list">${v.requests.map((r) => `<li class="drq">
      <span class="who">${esc(t(locale, r.scope === 'workspace'
        ? 'data.deletion.scope.workspace' : 'data.deletion.scope.buyer'))}</span>
      <span class="muted">${esc(formatDate(locale, r.askedAt))}</span>
      <span class="pill ${r.state === 'open' ? 'warn' : 'ok'}">${esc(t(locale, STATE_KEY[r.state]))}</span>
      ${r.closedNote ? `<div class="muted micro"><bdi>${esc(r.closedNote)}</bdi></div>` : ''}
    </li>`).join('')}</ul>
  </section>`;

  return `${back('/app/settings', backLabel)}
    <h1 class="page">${esc(t(locale, 'data.title'))}</h1>
    ${flashBanner(flash)}
    ${files}
    <section class="block">
      <h2>${esc(t(locale, 'data.deletion.title'))}</h2>
      <p class="muted">${esc(t(locale, 'data.deletion.lead'))}</p>
      <p class="muted">${esc(t(locale, 'data.deletion.byHand'))}</p>
      ${ask}
    </section>
    ${history}
    ${deeper('/privacy', t(locale, 'legal.privacyLink'))}
    ${DATA_STYLE}`;
}

const DATA_STYLE = `<style>
  .dl { list-style:none; padding:0; margin:var(--space-12) 0 0;
    display:flex; flex-wrap:wrap; gap:var(--space-8); }
  .micro { font-size:var(--font-size-caption); }
  .second { margin-top:var(--space-24); }
  .drq { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-8); }
  .pform input { background:var(--color-paper-sunk); border:1px solid var(--color-border);
    border-radius:10px; color:var(--color-ink); padding:10px 14px; font:inherit; }
</style>`;
