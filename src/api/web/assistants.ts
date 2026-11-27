import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, assistantName } from './say.js';
import {
  ASSISTANT_CHANNELS, ASSISTANT_ROLES, NAME_MAX, NOTE_MAX, validateAssistant,
  VOICE_TONES, VOICE_LENGTHS, VOICE_EMOJI, DEFAULT_VOICE,
  type Assistant, type AssistantProblem,
} from '../../core/owner/assistants.js';
import {
  addAssistant, archiveAssistant, ensureDefaultAssistant, listAssistants, updateAssistant,
  type AssistantWrite,
} from '../../db/assistants.js';
import { deeper, esc } from './layout.js';
import { fieldRow, cardActs } from './rows.js';
import { flashBanner, type Flash } from './flash.js';
import type { Viewer } from '../../core/conversation/people.js';
import { pageHead, setSection, setNotice, saveForm, saveActs, rowAction } from './settingsPage.js';

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
  tone: String(body['tone'] ?? ''), length: String(body['length'] ?? ''), emoji: String(body['emoji'] ?? ''),
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
  if (outcome === 'channel_taken' || outcome === 'name_missing' || outcome === 'name_long' || outcome === 'is_default' || outcome === 'assistant_limit'
    || outcome === 'note_long' || outcome === 'note_injection' || outcome === 'voice_invalid') {
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
    // Block 3 PR 1 — the voice: three choices and the owner's one line, fixed for every reply this one writes.
    fieldRow({ label: t(locale, 'assistants.field.tone'), forId: `${idPrefix}-tone`,
      control: `<select id="${idPrefix}-tone" name="tone">${voiceOptions(locale, 'tone', VOICE_TONES, (a?.voice ?? DEFAULT_VOICE).tone)}</select>` }),
    fieldRow({ label: t(locale, 'assistants.field.length'), forId: `${idPrefix}-length`,
      control: `<select id="${idPrefix}-length" name="length">${voiceOptions(locale, 'length', VOICE_LENGTHS, (a?.voice ?? DEFAULT_VOICE).length)}</select>` }),
    fieldRow({ label: t(locale, 'assistants.field.emoji'), forId: `${idPrefix}-emoji`,
      control: `<select id="${idPrefix}-emoji" name="emoji">${voiceOptions(locale, 'emoji', VOICE_EMOJI, (a?.voice ?? DEFAULT_VOICE).emoji)}</select>` }),
    fieldRow({ label: t(locale, 'assistants.field.voiceLine'), forId: `${idPrefix}-note`, desc: t(locale, 'assistants.field.voiceLine.hint'),
      control: `<textarea id="${idPrefix}-note" name="note" rows="2" maxlength="${NOTE_MAX}">${esc(a?.note ?? '')}</textarea>` }),
  ];
}
const voiceOptions = (locale: Locale, kind: 'tone' | 'length' | 'emoji', list: readonly string[], current: string): string =>
  list.map((v) => `<option value="${v}"${v === current ? ' selected' : ''}>${esc(t(locale, `assistants.${kind}.${v}` as MessageKey))}</option>`).join('');

/**
 * SETTINGS › ASSISTANT › NAME AND IDENTITY (the settings overhaul, rule 104) — the name customers read, and how the
 * assistant talks:
 *
 *   · "Confirm the name" is its own act, never a field: it is the owner's DECISION that customers may be told this
 *     name (rule 2), so it has its own button, with the line that says no name is given until it is pressed;
 *   · the name, job and voice of ONE assistant are fields, always in view, with the page's ONE Save. The main
 *     assistant by default; "Edit" on another's row puts that one's fields in the same form (`?edit=<id>`);
 *   · who answers: a table, each row's acts beside it (Edit a door, Remove at once, asking first);
 *   · "Add another assistant" is the list's own Add form.
 *
 * Every form posts where it always did (`/app/onboarding/assistant-name`, `/app/settings/people/assistants…`).
 * A member of staff reads the name and is given no form (who is on the team is the owner's).
 */
export type NameView = {
  /** The owner confirmed what customers will call the assistant. */
  readonly named: boolean;
  /** The main assistant's row name as it stands: what awaits confirmation until it is confirmed. */
  readonly pending: string;
};
export const NAME_PAGE = '/app/settings/assistant/name';

export function renderNameIdentity(
  v: NameView, assistants: readonly Assistant[], locale: Locale, flash: Flash | null, viewer: Viewer, editId: string | null = null,
): string {
  const name = assistantName(locale);
  const head = `${pageHead(t(locale, 'settingsArea.identity'), t(locale, 'as.name.lede', { name }))}${flashBanner(flash)}`;
  // Rule 2, rule 7 — until it is confirmed the name is shown HERE as the one awaiting confirmation, and nowhere as the name.
  const confirm = v.named ? '' : setNotice({ id: 'name',
    html: `<b class="as-said"><bdi>${esc(v.pending)}</bdi></b>${esc(t(locale, 'assistants.unconfirmed'))}`,
    act: viewer.isOwner ? rowAction({ action: '/app/onboarding/assistant-name', label: t(locale, 'autonomy.confirmName'),
      hidden: { from: 'employee', name: v.pending } }) : undefined });
  if (!viewer.isOwner) return `${head}${confirm}
    <p class="emp-called"><bdi>${esc(v.named ? name : v.pending)}</bdi></p>
    <p class="set-help">${esc(t(locale, 'employee.role.reception'))}</p>
    <p class="set-help">${esc(t(locale, 'staff.ownerDecides'))}</p>`;

  const main = assistants.find((a) => a.isDefault) ?? assistants[0] ?? null;
  const editing = assistants.find((a) => a.id === editId) ?? main;
  const other = editing !== null && editing !== main;
  // The job and "Main" are labels, said in words on the row; a pill is for a state (V1-517).
  const answers = (a: Assistant): string => a.isDefault
    ? t(locale, 'assistants.default')
    : a.channels.length === 0
      ? t(locale, 'assistants.noChannels')
      : t(locale, 'assistants.answersOn', { channels: a.channels.map((c) => channelName(locale, c)).join(' · ') });
  const about = (a: Assistant): string => [t(locale, `assistants.role.${a.role}` as MessageKey),
    ...(a.isDefault ? [t(locale, 'assistants.default.pill')] : []), answers(a)].map(esc).join(' · ');
  const form = editing === null ? '' : saveForm(`/app/settings/people/assistants/${editing.id}`,
    `${setSection({ id: 'identity', title: t(locale, 'as.name.section'), rows: fields(locale, editing, 'as') })}${saveActs(locale)}`);
  const list = `<table class="team-table as-team"><tbody>${assistants.map((a) => `<tr class="tm"><th scope="row"><bdi>${esc(a.name)}</bdi></th>
      <td>${about(a)}${a.isDefault && !v.named ? ` ${deeper('/app/onboarding', t(locale, 'nav.onboarding'))}` : ''}</td>
      <td class="as-act">${a === editing ? '' : deeper(`${NAME_PAGE}${a.isDefault ? '' : `?edit=${a.id}`}#identity`, t(locale, 'as.name.edit'), '', `aria-label="${esc(`${t(locale, 'as.name.edit')}: ${a.name}`)}"`)}${a.isDefault ? '' : rowAction({
        action: `/app/settings/people/assistants/${a.id}/archive`, label: t(locale, 'assistants.archive'),
        confirm: t(locale, 'assistants.archive.confirm', { who: a.name }), ariaLabel: `${t(locale, 'assistants.archive')}: ${a.name}` })}</td></tr>`).join('')}</tbody></table>`;
  const add = `<form method="post" action="/app/settings/people/assistants" class="set-add">${fields(locale, null, 'as-new').join('')}${
    cardActs(`<button class="btn" type="submit">${esc(t(locale, 'assistants.add.button'))}</button>`)}</form>`;
  const editingNote = !other || editing === null ? '' : setNotice({
    html: esc(t(locale, 'as.name.editing', { who: '\u0001' })).replace('\u0001', `<bdi>${esc(editing.name)}</bdi>`),
    door: { href: `${NAME_PAGE}#identity`, label: t(locale, 'as.name.toMain') } });
  return `${head}${confirm}
    ${editingNote}
    ${form}
    ${setSection({ id: 'assistants', title: t(locale, 'assistants.title'), help: t(locale, 'assistants.intro', { name }), rows: list })}
    ${setSection({ id: 'add-assistant', title: t(locale, 'assistants.add.summary'), rows: add })}`;
}
