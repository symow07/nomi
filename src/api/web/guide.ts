import { readdirSync, readFileSync } from 'node:fs';
import { t } from './say.js';
import { esc, deeper, todoMark } from './layout.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { SETUP_STEPS, type NamesWanted, type SetupStep } from '../../db/setup.js';
import { namesWantedLines } from './namesWanted.js';
import { STEP_LINK } from './onboarding.js';

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
  options: { readonly embedded?: boolean } = {},
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
    ${v.next === null ? `<p class="fok setup-complete">${esc(t(locale, 'area1.setup.complete'))}</p>` : ''}
    <ol class="guide setup-steps">${items}</ol>
    <div class="block"><h2>${esc(t(locale, 'guide.after.title'))}</h2><p>${esc(t(locale, 'guide.after.body', { name }))}</p></div>`;
}
