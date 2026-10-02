import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import type { BusinessId } from '../../core/types/ids.js';
import { checklistFor, checklistKind, NOT_YET, type ChecklistItem } from '../../db/practiceChecklist.js';
import { anyConnected, connectedChannels } from '../../db/connectedChannels.js';
import { sendingAloneEarned } from '../../db/earned.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, assistantName } from './say.js';
import { esc, deeper } from './layout.js';
import * as show from './values.js';

/**
 * G6 — "READY FOR CUSTOMERS": the owner's own evidence, on one page, before
 * customers write. What they have seen in Practice (the checklist for their
 * kind of business, P4: a catalogue, a shop's, or none — seen once is seen,
 * written on the workspace), and the three facts beside it: the name
 * customers read is confirmed, a channel is connected, and whether sending
 * alone is open yet (G4). It replaces, for a workspace that signed itself up,
 * the three rows of Getting ready a stranger cannot answer: "Backup tested"
 * and "Secrets rotated" (the installation's facts) and the old practice check
 * (fixed scenarios that never read the owner's data).
 */
export type ReadyView = {
  readonly items: readonly ChecklistItem[];
  readonly seen: ReadonlySet<ChecklistItem>;
  readonly named: boolean;
  readonly connected: boolean;
  readonly earned: boolean;
};

/** Items still to see: an item that cannot pass yet (`NOT_YET`) is not counted against the owner. */
export const readyDone = (v: Pick<ReadyView, 'items' | 'seen'>): number => v.items.filter((i) => v.seen.has(i)).length;
export const readyTotal = (v: Pick<ReadyView, 'items'>): number => v.items.filter((i) => !NOT_YET.has(i)).length;
export const readyComplete = (v: Pick<ReadyView, 'items' | 'seen'>): boolean => readyDone(v) >= readyTotal(v);

export async function loadReady(db: Db, live: BusinessId): Promise<ReadyView> {
  const items = checklistFor(await checklistKind(db, live));
  return withTenantTx(db, live, async (tx) => {
    const seen = new Set((await sql<{ item: string }>`select item from practice_checks where business_id = ${live}::uuid`
      .execute(tx)).rows.map((r) => r.item as ChecklistItem));
    const named = (await sql<{ n: boolean }>`select assistant_named_at is not null as n from onboarding_state where business_id = ${live}::uuid`
      .execute(tx)).rows[0]?.n ?? false;
    return { items, seen, named, connected: anyConnected(await connectedChannels(tx, live)), earned: await sendingAloneEarned(tx) };
  });
}

export function renderReady(v: ReadyView, locale: Locale): string {
  const name = assistantName(locale);
  const row = (ok: boolean, label: string, gap = false) => `<li class="chk ${ok ? 'ok' : gap ? 'gap' : ''}"><span class="mk" aria-hidden="true">${
    ok ? '✓' : gap ? '—' : '○'}</span><span class="lbl">${esc(label)}</span></li>`;
  const checks = v.items.map((i) => row(v.seen.has(i) && !NOT_YET.has(i), t(locale, `practice.check.${i}` as MessageKey, { name }), NOT_YET.has(i))).join('');
  const done = readyComplete(v);
  return `<h1 class="page">${esc(t(locale, 'ready.title'))}</h1>
  <p class="muted">${esc(t(locale, 'ready.intro', { name }))}</p>
  <section class="block" aria-labelledby="ready-checks">
    <h2 id="ready-checks">${esc(t(locale, 'ready.checks'))} · <span class="count">${esc(show.isolate(locale, `${readyDone(v)}/${readyTotal(v)}`))}</span></h2>
    <ul class="checks">${checks}</ul>
    ${done ? `<p class="fok">${esc(t(locale, 'ready.done'))}</p>` : ''}
    ${deeper('/app/sandbox', t(locale, 'ready.practise'))}
  </section>
  <section class="block" aria-labelledby="ready-facts">
    <h2 id="ready-facts">${esc(t(locale, 'ready.facts'))}</h2>
    <ul class="checks">
      ${row(v.named, t(locale, v.named ? 'ready.name.done' : 'ready.name.todo', { name }))}
      ${row(v.connected, t(locale, v.connected ? 'ready.channel.done' : 'ready.channel.todo'))}
      ${/* Phase 9 (V1-145) — sending alone needs both: earned AND the name confirmed (commitTurn's gates). */ ''}${row(v.earned && v.named, t(locale,
        !v.earned ? 'ready.alone.not' : v.named ? 'ready.alone.earned' : 'ready.alone.needsName', { name }))}
    </ul>
    <div class="doors">${v.named ? '' : deeper('/app/onboarding', t(locale, 'pilot.title'))}${v.connected ? '' : deeper('/app/channels', t(locale, 'nav.channels'))}</div>
  </section>`;
}
