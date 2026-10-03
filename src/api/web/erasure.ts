import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import { t } from './say.js';
import { back, esc, publicDocument, publicTop, PUBLIC_TOP_CSS } from './layout.js';
import { recordBuyerRequest, BUYER_NOTE_MAX } from './dataRights.js';
import * as show from './values.js';

/**
 * 0126 — THE OWNER DELETES; IT IS GONE (the owner's direction, 2026-10-04).
 *
 * "Keep a customer's conversations while the workspace is active, and delete
 * them when the customer asks, or when the workspace closes." Until now the
 * owner recorded a request and Nomi's operator erased it by hand within 30
 * days. Now the owner's one act IS the erasure: `eraseCustomerNow` records the
 * request (or takes the one already open, or the one noted from their
 * message) and calls `erase_customer`, the database's own erasure, in ONE
 * transaction; `closeWorkspace` calls `close_workspace`. The app role still
 * holds no DELETE on any table (G20): both are definer functions that take the
 * workspace from the transaction, check that the person is its owner, and
 * carry out exactly the contract tools/erase-buyer.mjs and
 * tools/erase-workspace.mjs carry out — they call the same functions.
 *
 * Every refusal leaves nothing changed, the request included: the transaction
 * is one. Nothing is sent to the customer, here or anywhere (rule 18).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The erasure's own count of what stayed, for the owner's notice. */
export type ErasedSummary = {
  readonly requestId: string;
  /** Orders kept, without contact details. */
  readonly ordersKept: number;
  /** Do-not-contact notes kept for their addresses. */
  readonly doNotContactKept: number;
  /** Rows erased, in all. */
  readonly erased: number;
  /** The ledger's line (ids, who, when, counts) — what the operator is sent. */
  readonly line: Record<string, unknown> | null;
};

export type EraseOutcome =
  | ({ readonly outcome: 'erased' } & ErasedSummary)
  /** No such customer here (a gone conversation, an address that is not one). */
  | { readonly outcome: 'not_found' }
  /** Nothing was noted from their message, and the owner gave no note of how they asked. */
  | { readonly outcome: 'note_missing' }
  | { readonly outcome: 'note_long' }
  /** Only the owner deletes (the database said so too). */
  | { readonly outcome: 'not_owner' }
  /** A reply to them is being worked on right now: try again in a minute. */
  | { readonly outcome: 'busy' }
  /** The erasure would not run safely (a table nobody classified, inconsistent rows): the operator is told. */
  | { readonly outcome: 'refused'; readonly error: unknown };

const BUSY = new Set(['NE002', '55P03', '40P01', '40001']);
const codeOf = (e: unknown): string | null => (e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : null);
const sum = (m: unknown): number => Object.values((m ?? {}) as Record<string, unknown>).reduce<number>((a, n) => a + Number(n), 0);

/**
 * The customer of this conversation, deleted now. `note` says how and when
 * they asked, and is needed only when nothing was noted from their message and
 * no request is open.
 */
export async function eraseCustomerNow(
  db: Db, businessIdRaw: string, conversationId: string, note: string | null, actor: string,
): Promise<EraseOutcome> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok || !UUID.test(conversationId)) return { outcome: 'not_found' };
  const clean = note === null ? null : note.replace(/\s+/g, ' ').trim();
  if (clean !== null && clean.length > BUYER_NOTE_MAX) return { outcome: 'note_long' };
  try {
    return await withTenantTx(db, bid.value, async (tx): Promise<EraseOutcome> => {
      const asked = await recordBuyerRequest(tx, bid.value, conversationId, clean === '' ? null : clean, actor, { reuseOpen: true });
      if (asked.outcome === 'not_found' || asked.outcome === 'note_missing') return { outcome: asked.outcome };
      if (asked.outcome !== 'asked') return { outcome: 'refused', error: new Error(`request: ${asked.outcome}`) };
      const r = (await sql<{ r: Record<string, unknown> }>`
        select erase_customer(${asked.requestId}::uuid, ${actor}) as r`.execute(tx)).rows[0]?.r ?? {};
      const kept = (r['kept'] ?? {}) as Record<string, number>;
      return {
        outcome: 'erased', requestId: asked.requestId,
        ordersKept: Number(kept['orders'] ?? 0), doNotContactKept: Number(kept['suppressions'] ?? 0),
        erased: sum(r['erased']), line: (r['line'] ?? null) as Record<string, unknown> | null,
      };
    });
  } catch (e) {
    const code = codeOf(e);
    if (code !== null && BUSY.has(code)) return { outcome: 'busy' };
    if (code === 'NE003') return { outcome: 'not_owner' };
    if (code === '23505') return { outcome: 'busy' };
    return { outcome: 'refused', error: e };
  }
}

export type CloseOutcome =
  | { readonly outcome: 'closed'; readonly rows: number; readonly line: Record<string, unknown> | null }
  | { readonly outcome: 'name_wrong' | 'protected' | 'paid' | 'not_owner' | 'busy' }
  | { readonly outcome: 'refused'; readonly error: unknown };

/**
 * The whole workspace, erased now: its customers and their conversations,
 * products, orders, what it was taught, every login. `typedName` is the
 * workspace's own name, typed: the database compares it, as it compares who
 * is asking. The caller refuses the installation's own workspace first.
 */
export async function closeWorkspace(db: Db, businessIdRaw: string, typedName: string, actor: string): Promise<CloseOutcome> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { outcome: 'protected' };
  try {
    return await withTenantTx(db, bid.value, async (tx): Promise<CloseOutcome> => {
      const r = (await sql<{ r: Record<string, unknown> }>`
        select close_workspace(${typedName}, ${actor}) as r`.execute(tx)).rows[0]?.r ?? {};
      return { outcome: 'closed', rows: Number(r['rows'] ?? 0), line: (r['line'] ?? null) as Record<string, unknown> | null };
    });
  } catch (e) {
    const code = codeOf(e);
    if (code === 'NE007') return { outcome: 'name_wrong' };
    if (code === 'NE006') return { outcome: 'protected' };
    if (code === 'NE008') return { outcome: 'paid' };
    if (code === 'NE003') return { outcome: 'not_owner' };
    if (code !== null && BUSY.has(code)) return { outcome: 'busy' };
    return { outcome: 'refused', error: e };
  }
}

/** The operator's mail after an erasure: the ledger's line, ids only — what tools/replay-erasures.mjs --ledger reads. */
export function erasureNotice(kind: 'customer' | 'workspace', line: Record<string, unknown> | null): { subject: string; text: string } {
  const json = JSON.stringify(line ?? {});
  return {
    subject: kind === 'customer' ? `Customer data erased · ${String(line?.['business_id'] ?? '')}` : `Workspace closed and erased · ${String(line?.['business_id'] ?? '')}`,
    text: `${kind === 'customer'
      ? 'An owner deleted a customer\'s data in Nomi. It is gone from the database now.'
      : 'An owner closed a workspace. Everything in it is gone from the database now.'}\n\n`
      + 'The erasure ledger\'s line, ids only. Keep this mail: if a backup is ever restored, '
      + 'save this line to a file and give it to tools/replay-erasures.mjs --ledger (docs/BACKUP-RESTORE.md, "Restore").\n\n'
      + `${json}\n`,
  };
}

/**
 * NO SCRIPT, STILL ASKED. With the page's script, "Delete this customer's
 * data now" asks in the product's dialog (`data-confirm`), and the form goes
 * with `asked=1`; with the browser's own script only, it asks with the
 * browser's box. With no script at all it arrives with `asked=0`, and this
 * page is the asking: what goes, what stays, and the one button that does it.
 */
export function renderEraseAsk(
  locale: Locale, o: {
    readonly conversationId: string; readonly buyer: string | null; readonly note: string | null;
    readonly from: 'data' | 'conversation';
  },
): string {
  const here = `/app/conversations/${encodeURIComponent(o.conversationId)}`;
  const backTo = o.from === 'data' ? '/app/settings/data#buyers' : `${here}#deletion`;
  return `${back(backTo, t(locale, o.from === 'data' ? 'data.title' : 'conv.deletion.title'))}
    <h1 class="page">${esc(t(locale, 'erase.ask.title'))}</h1>
    ${o.buyer ? `<p><b><bdi>${esc(o.buyer)}</bdi></b></p>` : ''}
    <p>${esc(t(locale, 'conv.deletion.erased'))}</p>
    <p>${esc(t(locale, 'conv.deletion.kept'))}</p>
    <p class="muted">${esc(t(locale, 'conv.deletion.tell'))}</p>
    <form method="post" action="${here}/deletion/erase" class="pform">
      <input type="hidden" name="asked" value="1" />
      <input type="hidden" name="from" value="${o.from}" />
      ${o.note ? `<input type="hidden" name="note" value="${esc(o.note)}" />` : ''}
      <button class="btn danger" type="submit" onclick="return confirm(this.dataset.confirm)"
        data-confirm="${esc(t(locale, 'conv.deletion.eraseConfirm'))}">${esc(t(locale, 'conv.deletion.erase'))}</button>
    </form>`;
}

/** The same for closing the workspace: the name already typed, and the one button. */
export function renderCloseAsk(locale: Locale, typedName: string, businessName: string): string {
  return `${back('/app/settings/data#close', t(locale, 'data.title'))}
    <h1 class="page">${esc(t(locale, 'close.ask.title', { name: show.isolate(locale, businessName) }))}</h1>
    <p>${esc(t(locale, 'data.deletion.lead'))}</p>
    <p>${esc(t(locale, 'data.deletion.now'))}</p>
    <form method="post" action="/app/settings/data/close" class="pform">
      <input type="hidden" name="asked" value="1" />
      <input type="hidden" name="name" value="${esc(typedName)}" />
      <button class="btn danger" type="submit" onclick="return confirm(this.dataset.confirm)"
        data-confirm="${esc(t(locale, 'data.deletion.confirm'))}">${esc(t(locale, 'data.deletion.close'))}</button>
    </form>`;
}

/**
 * Where an owner lands after closing: signed out, on a public page with
 * nothing to fetch (the legal pages' shell), saying what happened. It names
 * no workspace — the session that knew it is gone.
 */
export function renderClosed(locale: Locale, home = '/site'): string {
  return publicDocument({
    locale, title: `${t(locale, 'closed.title')} · Nomi`, extraCss: PUBLIC_TOP_CSS,
    body: `${publicTop(locale, home, '/closed')}
    <h1>${esc(t(locale, 'closed.title'))}</h1>
    <p>${esc(t(locale, 'closed.body'))}</p>
    <p>${esc(t(locale, 'closed.backups'))}</p>
    <p><a href="/data-deletion">${esc(t(locale, 'legal.deletion.title'))}</a> · <a href="/privacy">${esc(t(locale, 'legal.privacyLink'))}</a></p>`,
  });
}
