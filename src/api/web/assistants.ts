import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, assistantName } from './say.js';
import {
  ASSISTANT_CHANNELS, ASSISTANT_ROLES, NAME_MAX, NOTE_MAX, validateAssistant,
  type Assistant, type AssistantProblem,
} from '../../core/owner/assistants.js';
import {
  addAssistant, archiveAssistant, ensureDefaultAssistant, listAssistants, updateAssistant,
  type AssistantWrite,
} from '../../db/assistants.js';
import { deeper, esc } from './layout.js';
import { fieldRow, rowsCard, cardActs } from './rows.js';

/**
 * A5 — the assistants section of the team page, and the three things the owner
 * can do there. Owner-only, by the same rule as adding a person: who answers a
 * buyer is who is on the team.
 */

/**
 * Everyone who answers, the main one first — made the first time the page is
 * opened.
 *
 * NO NAME IS PASSED, on purpose. It used to hand over the catalogue's name
 * constant for the READER's current page language, so which name a business's
 * first assistant was given depended on who happened to open the team page
 * first and what language their browser was in. A name is written once and
 * then shown to everybody; it belongs to the business, not to a visitor.
 * `ensureDefaultAssistant` takes it from the business's own signup locale
 * instead.
 */
export async function loadAssistants(db: Db, businessIdRaw: string): Promise<readonly Assistant[]> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return [];
  return withTenantTx(db, bid.value, async (tx) => {
    await ensureDefaultAssistant(tx, bid.value);
    return listAssistants(tx, bid.value);
  });
}

/** One name per box: this app's form parser keeps only the LAST of a repeated name. */
export const channelsFromForm = (body: Record<string, unknown>): string[] =>
  ASSISTANT_CHANNELS.filter((c) => body[`channel_${c}`] !== undefined);

export type AssistantOutcome = AssistantWrite | AssistantProblem;

const inputFrom = (body: Record<string, unknown>) => ({
  name: String(body['name'] ?? ''), role: String(body['role'] ?? ''),
  note: String(body['note'] ?? ''), channels: channelsFromForm(body),
});

export async function addAssistantFromForm(
  db: Db, businessIdRaw: string, body: Record<string, unknown>, actor: string,
): Promise<{ outcome: AssistantOutcome; name: string }> {
  const v = validateAssistant(inputFrom(body));
  if (!v.ok) return { outcome: v.problem, name: '' };
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { outcome: 'not_found', name: '' };
  // Same reason as above: the MAIN assistant this may have to create first is
  // named from the business's signup locale, never from the adder's page.
  const outcome = await withTenantTx(db, bid.value, (tx) => addAssistant(tx, bid.value, v.value, actor));
  return { outcome, name: v.value.name };
}

export async function updateAssistantFromForm(
  db: Db, businessIdRaw: string, id: string, body: Record<string, unknown>, actor: string,
): Promise<AssistantOutcome> {
  const v = validateAssistant(inputFrom(body));
  if (!v.ok) return v.problem;
  if (!UUID.test(id)) return 'not_found';
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return 'not_found';
  return withTenantTx(db, bid.value, (tx) => updateAssistant(tx, bid.value, id, v.value, actor));
}

export async function archiveAssistantById(db: Db, businessIdRaw: string, id: string, actor: string): Promise<AssistantWrite> {
  if (!UUID.test(id)) return 'not_found';
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return 'not_found';
  return withTenantTx(db, bid.value, (tx) => archiveAssistant(tx, bid.value, id, actor));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What to tell her afterwards. Anything she cannot act on reads as "that did not save". */
/** A1 — the KEY the notice says, for the page that will write it out. */
export function assistantFlash(outcome: AssistantOutcome, verb: 'added' | 'saved' | 'archived'): MessageKey {
  if (outcome === 'saved') return `assistants.flash.${verb}` as MessageKey;
  if (outcome === 'channel_taken' || outcome === 'name_missing' || outcome === 'name_long' || outcome === 'is_default' || outcome === 'assistant_limit') {
    return `assistants.flash.${outcome}` as MessageKey;
  }
  return 'people.flash.failed';
}

const channelName = (locale: Locale, c: string): string => t(locale, `business.channel.${c}` as MessageKey);

/**
 * Phase 9 (V1-514) — an assistant's form is a card of rows, like every other
 * form on the page: one label style (the row's name), the control at the end
 * side, the act at the card's end. The channels are a grid of two, so no
 * channel is left alone on a line of its own.
 */
function fields(locale: Locale, a: Assistant | null, idPrefix: string): string[] {
  const roleOptions = ASSISTANT_ROLES.map((r) =>
    `<option value="${r}"${(a?.role ?? 'sales') === r ? ' selected' : ''}>${esc(t(locale, `assistants.role.${r}` as MessageKey))}</option>`).join('');
  // The main one is given no channels: it answers whatever nobody else was given.
  const boxes = a?.isDefault ? [] : [fieldRow({ label: t(locale, 'assistants.channels.label'),
    control: `<fieldset class="choices as-chans" aria-label="${esc(t(locale, 'assistants.channels.label'))}">
      ${ASSISTANT_CHANNELS.map((c) => `<label class="as-box"><input type="checkbox" name="channel_${c}"${
        a?.channels.includes(c) ? ' checked' : ''} /> <span>${esc(channelName(locale, c))}</span></label>`).join('')}</fieldset>` })];
  return [
    fieldRow({ label: t(locale, 'assistants.field.name'), forId: `${idPrefix}-name`,
      control: `<input id="${idPrefix}-name" name="name" required maxlength="${NAME_MAX}" value="${esc(a?.name ?? '')}" />` }),
    fieldRow({ label: t(locale, 'assistants.field.role'), forId: `${idPrefix}-role`,
      control: `<select id="${idPrefix}-role" name="role">${roleOptions}</select>` }),
    ...boxes,
    fieldRow({ label: t(locale, 'assistants.field.note'), forId: `${idPrefix}-note`, desc: t(locale, 'assistants.field.note.hint'),
      control: `<textarea id="${idPrefix}-note" name="note" rows="2" maxlength="${NOTE_MAX}">${esc(a?.note ?? '')}</textarea>` }),
  ];
}

export function renderAssistantsSection(assistants: readonly Assistant[], locale: Locale): string {
  // Phase 9 (V1-511) — one name on the page. The main assistant's row name
  // counts only once it is confirmed (rule 7): until then the page says
  // "your assistant", as the rest of the product does, and the row says the
  // name is not confirmed yet and where to confirm it.
  const confirmed = (a: Assistant): boolean => !a.isDefault || assistantName(locale) === a.name;
  const answers = (a: Assistant): string => a.isDefault
    ? t(locale, 'assistants.default')
    : a.channels.length === 0
      ? t(locale, 'assistants.noChannels')
      : t(locale, 'assistants.answersOn', { channels: a.channels.map((c) => channelName(locale, c)).join(' · ') });
  // Phase 9 (V1-517) — the job and "Main" are labels, said in words on the caption line; a pill is for a state.
  const about = (a: Assistant): string => [t(locale, `assistants.role.${a.role}` as MessageKey),
    ...(a.isDefault ? [t(locale, 'assistants.default.pill')] : []), answers(a)].map(esc).join(' · ');

  return `<section class="block" id="assistants">
      <h2>${esc(t(locale, 'assistants.title'))}</h2>
      <p class="muted">${esc(t(locale, 'assistants.intro'))}</p>
      <ul class="rows">${assistants.map((a) => `<li class="row top">
        <span class="person"><span><bdi>${esc(a.name)}</bdi></span>
          <span class="caption muted">${about(a)}</span>
          ${confirmed(a) ? '' : `<span class="caption muted">${esc(t(locale, 'assistants.unconfirmed'))}</span>
          ${deeper('/app/onboarding', t(locale, 'nav.onboarding'))}`}
          ${/* Phase 9 (V1-510) — the fold is a control and says what it changes. */ ''}<details class="act-fold"><summary class="btn">${esc(t(locale, a.isDefault ? 'assistants.change' : 'assistants.change.channels'))}</summary>
            <form method="post" action="/app/settings/people/assistants/${esc(a.id)}" class="sform">
              ${rowsCard(null, [...fields(locale, a, `as-${a.id.slice(0, 8)}`),
                cardActs(`<button class="btn send" type="submit">${esc(t(locale, 'assistants.save'))}</button>`)])}
            </form>
          </details></span>
        ${a.isDefault ? '' : `<form method="post" action="/app/settings/people/assistants/${esc(a.id)}/archive" class="inline">
          <button class="btn" type="submit" onclick="return confirm(this.dataset.confirm)"
            data-confirm="${esc(t(locale, 'assistants.archive.confirm', { who: a.name }))}">${esc(t(locale, 'assistants.archive'))}</button></form>`}
      </li>`).join('')}</ul>
      <details class="act-fold"><summary class="btn">${esc(t(locale, 'assistants.add.summary'))}</summary>
        <form method="post" action="/app/settings/people/assistants" class="sform">
          ${rowsCard(null, [...fields(locale, null, 'as-new'),
            cardActs(`<button class="btn send" type="submit">${esc(t(locale, 'assistants.add.button'))}</button>`)])}
        </form>
      </details>
    </section>`;
}
