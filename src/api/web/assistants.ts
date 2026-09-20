import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
import { t } from './say.js';
import {
  ASSISTANT_CHANNELS, ASSISTANT_ROLES, NAME_MAX, NOTE_MAX, validateAssistant,
  type Assistant, type AssistantProblem,
} from '../../core/owner/assistants.js';
import {
  addAssistant, archiveAssistant, ensureDefaultAssistant, listAssistants, updateAssistant,
  type AssistantWrite,
} from '../../db/assistants.js';
import { esc } from './layout.js';

/**
 * A5 — the assistants section of the team page, and the three things the owner
 * can do there. Owner-only, by the same rule as adding a person: who answers a
 * buyer is who is on the team.
 */

/** Everyone who answers, the main one first — made the first time the page is opened. */
export async function loadAssistants(db: Db, businessIdRaw: string, locale: Locale): Promise<readonly Assistant[]> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return [];
  return withTenantTx(db, bid.value, async (tx) => {
    await ensureDefaultAssistant(tx, bid.value, EMPLOYEE_NAME[locale]);
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
  db: Db, businessIdRaw: string, body: Record<string, unknown>, actor: string, locale: Locale,
): Promise<{ outcome: AssistantOutcome; name: string }> {
  const v = validateAssistant(inputFrom(body));
  if (!v.ok) return { outcome: v.problem, name: '' };
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { outcome: 'not_found', name: '' };
  const outcome = await withTenantTx(db, bid.value, (tx) => addAssistant(tx, bid.value, v.value, actor, EMPLOYEE_NAME[locale]));
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
  if (outcome === 'channel_taken' || outcome === 'name_missing' || outcome === 'name_long' || outcome === 'is_default') {
    return `assistants.flash.${outcome}` as MessageKey;
  }
  return 'people.flash.failed';
}

const channelName = (locale: Locale, c: string): string => t(locale, `business.channel.${c}` as MessageKey);

function fields(locale: Locale, a: Assistant | null, idPrefix: string): string {
  const roleOptions = ASSISTANT_ROLES.map((r) =>
    `<option value="${r}"${(a?.role ?? 'sales') === r ? ' selected' : ''}>${esc(t(locale, `assistants.role.${r}` as MessageKey))}</option>`).join('');
  // The main one is given no channels: it answers whatever nobody else was given.
  const boxes = a?.isDefault ? '' : `<fieldset class="as-ch"><legend class="muted">${esc(t(locale, 'assistants.channels.label'))}</legend>
      ${ASSISTANT_CHANNELS.map((c) => `<label class="as-box"><input type="checkbox" name="channel_${c}"${
        a?.channels.includes(c) ? ' checked' : ''} /> <span>${esc(channelName(locale, c))}</span></label>`).join('')}</fieldset>`;
  return `<div class="fld"><label for="${idPrefix}-name">${esc(t(locale, 'assistants.field.name'))}</label>
      <input id="${idPrefix}-name" name="name" required maxlength="${NAME_MAX}" value="${esc(a?.name ?? '')}" /></div>
    <div class="fld"><label for="${idPrefix}-role">${esc(t(locale, 'assistants.field.role'))}</label>
      <select id="${idPrefix}-role" name="role">${roleOptions}</select></div>
    ${boxes}
    <div class="fld"><label for="${idPrefix}-note">${esc(t(locale, 'assistants.field.note'))}</label>
      <textarea id="${idPrefix}-note" name="note" rows="2" maxlength="${NOTE_MAX}">${esc(a?.note ?? '')}</textarea>
      <span class="muted as-hint">${esc(t(locale, 'assistants.field.note.hint'))}</span></div>`;
}

export function renderAssistantsSection(assistants: readonly Assistant[], locale: Locale): string {
  const main = assistants.find((a) => a.isDefault);
  const answers = (a: Assistant): string => a.isDefault
    ? t(locale, 'assistants.default')
    : a.channels.length === 0
      ? t(locale, 'assistants.noChannels')
      : t(locale, 'assistants.answersOn', { channels: a.channels.map((c) => channelName(locale, c)).join(' · ') });

  return `<section class="block" id="assistants">
      <h2>${esc(t(locale, 'assistants.title'))}</h2>
      <p class="muted">${esc(t(locale, 'assistants.intro', { who: main?.name ?? '' }))}</p>
      <ul class="people">${assistants.map((a) => `<li class="as-row">
        <span class="who"><span><bdi>${esc(a.name)}</bdi>
          <span class="pill">${esc(t(locale, `assistants.role.${a.role}` as MessageKey))}</span>${
          a.isDefault ? ` <span class="pill ok">${esc(t(locale, 'assistants.default.pill'))}</span>` : ''}</span>
          <span class="how muted">${esc(answers(a))}</span>
          <details class="as-edit"><summary>${esc(t(locale, 'assistants.change'))}</summary>
            <form method="post" action="/app/settings/people/assistants/${esc(a.id)}" class="pform">
              ${fields(locale, a, `as-${a.id.slice(0, 8)}`)}
              <button class="btn send" type="submit">${esc(t(locale, 'assistants.save'))}</button>
            </form>
          </details></span>
        ${a.isDefault ? '' : `<form method="post" action="/app/settings/people/assistants/${esc(a.id)}/archive" class="inline">
          <button class="btn" type="submit" onclick="return confirm(this.dataset.confirm)"
            data-confirm="${esc(t(locale, 'assistants.archive.confirm', { who: a.name }))}">${esc(t(locale, 'assistants.archive'))}</button></form>`}
      </li>`).join('')}</ul>
      <details class="as-add"><summary>${esc(t(locale, 'assistants.add.summary'))}</summary>
        <form method="post" action="/app/settings/people/assistants" class="pform">
          ${fields(locale, null, 'as-new')}
          <button class="btn send" type="submit">${esc(t(locale, 'assistants.add.button'))}</button>
        </form>
      </details>
    </section>
    <style>
      .as-row { align-items:flex-start !important; }
      .as-edit, .as-add { margin-top:var(--space-8); }
      .as-edit summary, .as-add summary { cursor:pointer; color:var(--color-ink-secondary);
                                          font-size:var(--font-size-note); }
      .as-edit .pform, .as-add .pform { margin-top:var(--space-12); }
      .as-ch { border:0; margin:0; padding:0; display:flex; flex-wrap:wrap; gap:var(--space-8) var(--space-16); }
      .as-ch legend { padding:0; margin-bottom:var(--space-4); font-size:var(--font-size-caption); }
      .as-hint { font-size:var(--font-size-caption); }
      .as-box { display:inline-flex; align-items:center; gap:var(--space-4); font-size:var(--font-size-note); }
    </style>`;
}
