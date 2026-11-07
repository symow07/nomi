import { readdirSync, readFileSync } from 'node:fs';
import { t } from './say.js';
import { esc, deeper, todoMark } from './layout.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { SETUP_STEPS, type NamesWanted, type SetupStep } from '../../db/setup.js';
import { namesWantedLines } from './namesWanted.js';
import { STEP_LINK } from './onboarding.js';
import { SETUP_MILESTONE_KEYS, type SetupMilestones, type SetupMilestoneKey } from '../../core/onboard/setupMinutes.js';
import * as show from './values.js';
import { shape } from './marks.js';

/**
 * The shared setup facts in `db/setup.ts` determine every row's state and next
 * action. Instructions stay available as text; archived recordings retain their
 * stable, allowlisted asset addresses without promotion on setup surfaces.
 */
export const CAPTIONS_PER_STEP = 3;

const DIR = new URL('../../../assets/guide/', import.meta.url);
// Phase 9 (today-onboarding-new-09) — `.phone` files are the same step recorded at a phone's width.
const NAME = /^(profile|products|name|channels|first_success)\.(en|zh|ar|es|fr)(\.phone)?\.(webm|vtt|jpg)$/;
const FILES: ReadonlySet<string> = (() => {
  try { return new Set(readdirSync(DIR).filter((f) => NAME.test(f))); } catch { return new Set(); }
})();
const read = new Map<string, Buffer>();

/** A guide file by its exact name, or null. */
export function guideFileAt(file: string): { readonly body: Buffer; readonly type: string } | null {
  if (!FILES.has(file)) return null;
  let body = read.get(file);
  if (!body) { body = readFileSync(new URL(file, DIR)); read.set(file, body); }
  return { body, type: file.endsWith('.vtt') ? 'text/vtt; charset=utf-8' : file.endsWith('.jpg') ? 'image/jpeg' : 'video/webm' };
}

/** Is this step's video (and its captions) here in this language? */
export const hasVideo = (step: SetupStep, locale: Locale): boolean =>
  FILES.has(`${step}.${locale}.webm`) && FILES.has(`${step}.${locale}.vtt`);

export const captionKeys = (step: SetupStep): MessageKey[] =>
  Array.from({ length: CAPTIONS_PER_STEP }, (_, i) => `guide.${step}.cap.${i + 1}` as MessageKey);

export type GuideView = {
  readonly steps: readonly { readonly step: SetupStep; readonly done: boolean }[];
  readonly next: SetupStep | null;
  /** 2026-10-14 — what the products step still waits for: a name in each served language with its own script. */
  readonly names?: readonly NamesWanted[];
};

export type SetupMilestonesOptions = { readonly now: Date; readonly canManage: boolean };
/** Existing callers remain valid; the timed view requires both its facts and an injected clock. */
export type GuideOptions = { readonly embedded?: boolean } & (
  | { readonly milestones: SetupMilestones; readonly now: Date; readonly canManage: boolean }
  | { readonly milestones?: undefined; readonly now?: undefined; readonly canManage?: undefined }
);

/** Node 22 has no DurationFormat. These are static elapsed units, never a running timer. */
function setupElapsed(locale: Locale, milliseconds: number): string {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  const hours = Math.floor(minutes / 60);
  const unit = (n: number, kind: 'minute' | 'hour' | 'day') => new Intl.NumberFormat('en', {
    style: 'unit', unit: kind, unitDisplay: kind === 'day' ? 'long' : 'short',
  }).formatToParts(n).map(part => part.type === 'unit' && kind === 'hour' ? 'h' : part.value).join('');
  const parts = hours < 1 ? [unit(minutes, 'minute')] : hours < 48
    ? [unit(hours, 'hour'), unit(minutes % 60, 'minute')]
    : [unit(Math.floor(hours / 24), 'day'), unit(hours % 24, 'hour')];
  return show.isolate(locale, new Intl.ListFormat('en', { type: 'unit', style: 'narrow' }).format(parts));
}

export function renderSetupMilestones(milestones: SetupMilestones, locale: Locale, options: SetupMilestonesOptions): string {
  const words = (key: MessageKey, params?: Record<string, string | number>) =>
    `<bdi lang="en" dir="ltr">${esc(show.isolateFigures(locale, t('en', key, params)))}</bdi>`;
  const labels: Record<SetupMilestoneKey, 'products' | 'contacts' | 'channel' | 'reply'> = {
    productsIn: 'products', contactsIn: 'contacts', channelConnected: 'channel', firstReply: 'reply',
  };
  const doors = { productsIn: '/app/products/add', contactsIn: '/app/customers/import', channelConnected: '/app/settings/channels' } as const;
  const allDone = SETUP_MILESTONE_KEYS.every(key => milestones[key] !== null);
  const last = allDone ? Math.max(...SETUP_MILESTONE_KEYS.map(key => milestones[key]!.getTime())) : options.now.getTime();
  const clock = milestones.signedUpAt ? `<p class="sc-clock">${words(allDone ? 'setupClock.done' : 'setupClock.running', {
    elapsed: setupElapsed(locale, last - milestones.signedUpAt.getTime()),
  })}</p>` : '';
  const rows = SETUP_MILESTONE_KEYS.map(key => {
    const when = milestones[key];
    const state = when ? `${shape('ok')} ${milestones.signedUpAt
      ? words('setupClock.doneAt', { elapsed: setupElapsed(locale, when.getTime() - milestones.signedUpAt.getTime()) })
      : words('setupClock.doneOn', { date: show.dateYear(locale, when) })}` : words('setupClock.notYet');
    const next = when ? '' : key === 'firstReply' ? words('setupClock.reply.how') : !options.canManage ? words('setupClock.ownerDoes')
      : deeper(doors[key], t('en', `setupClock.${labels[key]}.go` as MessageKey));
    return `<li data-milestone="${key}"><h3>${words(`setupClock.${labels[key]}` as MessageKey)}</h3><p class="sc-state">${state}</p>${next ? `<p>${next}</p>` : ''}</li>`;
  }).join('');
  return `<section class="setup-clock" aria-labelledby="setup-clock-title"><h2 id="setup-clock-title">${words('setupClock.title')}</h2>${clock}<ol>${rows}</ol></section>`;
}

/**
 * THE ONE LINK DRAWN AS A FILLED BUTTON (the owner's decision at the Phase 3 stop-gate, 2026-10-13) — the only
 * exception to "buttons do things; doors go places" (tests/parity/buttons-and-doors.ts), and a HARD CAP:
 *   · at most ONE filled button on a page that carries it — this one, and no other filled button beside it;
 *   · only on the FIRST INCOMPLETE STEP of setting up ("Do it now", to that step's own page) — never a later step,
 *     never once the five are done, never anywhere else.
 * It takes the step, not an address, so it can only ever open a setup step; and this is the one place in the
 * source that writes `<a class="btn`. Every other link is a door.
 */
export const firstStepButton = (locale: Locale, next: SetupStep): string =>
  `<a class="btn send" data-first-step href="${esc(STEP_LINK[next])}">${esc(t(locale, 'guide.do'))}</a>`;

/** Textual setup instructions; recordings remain available at their stable asset addresses. */
export function renderGuide(
  v: GuideView, locale: Locale, name: string,
  _videos: (step: SetupStep, locale: Locale) => boolean = hasVideo,
  options: GuideOptions = {},
): string {
  const items = SETUP_STEPS.map((step) => {
    const done = v.steps.find((s) => s.step === step)?.done ?? false;
    const words = captionKeys(step).map((k, i) => step === 'name' && i === 0
      ? t(locale, 'area1.setup.name.location') : t(locale, k, { name }));
    // The canonical setup page keeps #name for the existing name confirmation control.
    const id = options.embedded && step === 'name' ? 'step-name' : step;
    return `<li class="guide-step${done ? ' done' : ''}${v.next === step ? ' next' : ''}" id="${id}">
      <div class="gs-heading">
        <h2 class="gs-h">${esc(t(locale, `factory.next.${step}` as MessageKey, { name }))}</h2>
        <span class="pill${done ? ' ok' : ''}">${done ? '' : `${todoMark()} `}${esc(t(locale, done ? 'guide.done' : 'guide.todo'))}</span>
        ${done ? '' : v.next === step ? firstStepButton(locale, step) : deeper(STEP_LINK[step], t(locale, 'guide.do'))}
      </div>
      <details class="gs-help"${v.next === step ? ' open' : ''}>
        <summary>${esc(t(locale, 'area1.setup.help'))}</summary>
        <ol class="gs-words">${words.map((w) => `<li>${esc(w)}</li>`).join('')}</ol>
      </details>
      ${step === 'products' && !done ? namesWantedLines(locale, v.names ?? []) : ''}
    </li>`;
  }).join('');
  return `${options.embedded ? '' : `<header class="setup-intro"><h1 class="page">${esc(t(locale, 'area1.setup.title'))}</h1>
    <p class="muted">${esc(t(locale, 'area1.setup.intro'))}</p></header>`}
    ${options.milestones ? renderSetupMilestones(options.milestones, locale, { now: options.now, canManage: options.canManage }) : ''}
    ${v.next === null ? `<p class="fok setup-complete">${esc(t(locale, 'area1.setup.complete'))}</p>` : ''}
    <ol class="guide setup-steps">${items}</ol>
    <div class="block"><h2>${esc(t(locale, 'guide.after.title'))}</h2><p>${esc(t(locale, 'guide.after.body', { name }))}</p></div>`;
}
