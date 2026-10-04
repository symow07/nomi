import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import type { BusinessId } from '../../core/types/ids.js';
import { checklistFor, checklistKind, NOT_YET, type ChecklistItem } from '../../db/practiceChecklist.js';
import { anyConnected, connectedChannels } from '../../db/connectedChannels.js';
import { sendingAloneEarned } from '../../db/earned.js';
import { assistantStopped } from '../../db/assistantStop.js';
import { loadKillSwitches } from '../../db/opsFlags.js';
import { aloneNow } from '../../core/conversation/aloneNow.js';
import { autonomyReleased } from '../../core/conversation/disclosure.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, assistantName } from './say.js';
import { esc, deeper } from './layout.js';
import { shape } from './marks.js';
import { STEP_LINK } from './onboarding.js';
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
  /** The fix wave (V1-417) — the owner's Stop and the operator's pause: nothing goes out alone while either holds. Absent reads as neither. */
  readonly stopped?: boolean;
  readonly silenced?: boolean;
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
    return { items, seen, named, connected: anyConnected(await connectedChannels(tx, live)), earned: await sendingAloneEarned(tx),
      stopped: await assistantStopped(tx, live), silenced: (await loadKillSwitches(tx, live)).globalSilence };
  });
}

export function renderReady(v: ReadyView, locale: Locale): string {
  const name = assistantName(locale);
  // Phase 9 (today-onboarding-new-11, missed-15) — an open item is the to-do ○
  // (the warmth run's re-audit, w4-today-setup-06: a chore, never the waiting
  // signal's magenta), as on the checklist and Today; the marks share one
  // column, so a ✓ and a ○ start their words at the same edge.
  const mark = (ok: boolean, gap = false) => `<span class="mk${ok || gap ? '' : ' dot todo'}" aria-hidden="true">${ok ? shape('ok') : gap ? '—' : shape('waiting')}</span>`;
  const row = (ok: boolean, label: string, gap = false) => `<li class="chk ${ok ? 'ok' : gap ? 'gap' : ''}">${mark(ok, gap)}<span class="lbl">${esc(label)}</span></li>`;
  const checks = v.items.map((i) => row(v.seen.has(i) && !NOT_YET.has(i), t(locale, `practice.check.${i}` as MessageKey, { name }), NOT_YET.has(i))).join('');
  const done = readyComplete(v);
  // Phase 9 (V1-147, V1-150, V1-108) — each thing that must be in place is
  // named as the checklists name it, with its state in words beside the mark
  // (never a negative sentence beside an empty circle), and, while it is not
  // in place, its own door — the step's own words.
  const fact = (ok: boolean, label: string, state: string, door: string) => `<li class="chk ${ok ? 'ok' : ''}">${mark(ok)}<span class="lbl">${esc(label)}</span>
      <span class="rd-state">${esc(state)}</span>${ok ? '' : door}</li>`;
  // The fix wave (V1-417) — "may send alone" only when nothing holds every
  // reply: the one answer the assistant's page reads (`aloneNow`).
  const hold = aloneNow({ capabilities: [], released: autonomyReleased(), named: v.named, earned: v.earned,
    ...(v.stopped ? { stopped: true } : {}), ...(v.silenced ? { silenced: true } : {}) }).hold;
  const alone = hold === null;
  const aloneSaid: MessageKey = hold === 'silenced' ? 'today.silenced.title' : hold === 'stopped' ? 'today.stopped.title'
    : hold === 'release' ? 'her.handles.held.why.release'
    : !v.earned ? 'ready.alone.not' : v.named ? 'ready.alone.earned' : 'ready.alone.needsName';
  return `<h1 class="page">${esc(t(locale, 'ready.title'))}</h1>
  <p class="muted">${esc(t(locale, 'ready.intro', { name }))}</p>
  <section class="block" aria-labelledby="ready-checks">
    <h2 id="ready-checks">${esc(t(locale, 'ready.checks'))} · <span class="count">${esc(show.isolate(locale, `${readyDone(v)}/${readyTotal(v)}`))}</span></h2>
    <ul class="checks rd">${checks}</ul>
    ${done ? `<p class="fok">${esc(t(locale, 'ready.done'))}</p>` : ''}
    ${deeper('/app/sandbox', t(locale, 'ready.practise'))}
  </section>
  <section class="block" aria-labelledby="ready-facts">
    <h2 id="ready-facts">${esc(t(locale, 'ready.facts'))}</h2>
    <ul class="checks rd facts">
      ${fact(v.named, t(locale, 'pilot.attest.assistant_named'), t(locale, v.named ? 'ready.name.done' : 'ready.name.todo', { name }),
        deeper(STEP_LINK.name, t(locale, 'factory.next.name', { name })))}
      ${fact(v.connected, t(locale, 'nav.channels'), t(locale, v.connected ? 'ready.channel.done' : 'ready.channel.todo'),
        deeper(STEP_LINK.channels, t(locale, 'factory.next.channels', { name })))}
      ${/* Phase 9 (V1-145) — sending alone needs both: earned AND the name confirmed (commitTurn's gates). */ ''}${fact(alone, t(locale, 'ready.alone.label', { name }),
        t(locale, aloneSaid, { name }),
        v.earned ? '' : deeper('/app/employee', t(locale, 'ready.alone.go', { name })))}
    </ul>
  </section>`;
}
