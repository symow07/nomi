import { readdirSync, readFileSync } from 'node:fs';
import { t } from './say.js';
import { esc, deeper } from './layout.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { SETUP_STEPS, type SetupStep } from '../../db/setup.js';
import { STEP_LINK } from './onboarding.js';

/**
 * THE GUIDED PATH — a stranger who signed up, from an empty workspace to a
 * first reply, without anyone's help. The five setup steps (`db/setup.ts`, the
 * one derivation of what is done), in order, each with where it stands, one
 * door to do it, and a short video of doing it — recorded from these very
 * pages (`tools/record-guide.mjs`), with captions in the owner's language. The
 * captions are also the page's own text ("Read instead"), so nothing is lost
 * without the video, a sound, or a fast connection.
 *
 * The videos are files in `assets/guide/`, named `<step>.<locale>.webm` with
 * their `.vtt` captions; a step whose video was not recorded in this language
 * shows its words only. Only a name the folder holds, of that exact shape, is
 * ever served — never a path built from the request.
 */
export const CAPTIONS_PER_STEP = 3;

const DIR = new URL('../../../assets/guide/', import.meta.url);
const NAME = /^(profile|products|name|channels|first_success)\.(en|zh|ar|es)\.(webm|vtt)$/;
const FILES: ReadonlySet<string> = (() => {
  try { return new Set(readdirSync(DIR).filter((f) => NAME.test(f))); } catch { return new Set(); }
})();
const read = new Map<string, Buffer>();

/** A guide file by its exact name, or null. */
export function guideFileAt(file: string): { readonly body: Buffer; readonly type: string } | null {
  if (!FILES.has(file)) return null;
  let body = read.get(file);
  if (!body) { body = readFileSync(new URL(file, DIR)); read.set(file, body); }
  return { body, type: file.endsWith('.vtt') ? 'text/vtt; charset=utf-8' : 'video/webm' };
}

/** Is this step's video (and its captions) here in this language? */
export const hasVideo = (step: SetupStep, locale: Locale): boolean =>
  FILES.has(`${step}.${locale}.webm`) && FILES.has(`${step}.${locale}.vtt`);

export const captionKeys = (step: SetupStep): MessageKey[] =>
  Array.from({ length: CAPTIONS_PER_STEP }, (_, i) => `guide.${step}.cap.${i + 1}` as MessageKey);

export type GuideView = {
  readonly steps: readonly { readonly step: SetupStep; readonly done: boolean }[];
  readonly next: SetupStep | null;
};

export function renderGuide(v: GuideView, locale: Locale, name: string, videos: (step: SetupStep, locale: Locale) => boolean = hasVideo): string {
  const items = SETUP_STEPS.map((step, i) => {
    const done = v.steps.find((s) => s.step === step)?.done ?? false;
    const words = captionKeys(step).map((k) => t(locale, k, { name }));
    const video = videos(step, locale)
      ? `<video class="guide-video" controls preload="none" playsinline>
          <source src="/assets/guide/${step}.${locale}.webm" type="video/webm">
          <track kind="captions" src="/assets/guide/${step}.${locale}.vtt" srclang="${locale}" label="${esc(t(locale, 'guide.captions'))}" default>
        </video>
        <details><summary>${esc(t(locale, 'guide.read'))}</summary><ol>${words.map((w) => `<li>${esc(w)}</li>`).join('')}</ol></details>`
      : `<ol>${words.map((w) => `<li>${esc(w)}</li>`).join('')}</ol>`;
    return `<li class="guide-step${done ? ' done' : ''}${v.next === step ? ' next' : ''}" id="${step}">
      <h2><span class="muted">${i + 1}.</span> ${esc(t(locale, `factory.next.${step}` as MessageKey, { name }))}
        <span class="pill ${done ? 'ok' : 'warn'}">${esc(t(locale, done ? 'guide.done' : 'guide.todo'))}</span></h2>
      ${video}
      ${done ? '' : deeper(STEP_LINK[step], t(locale, 'guide.do'), v.next === step ? 'next' : '')}
    </li>`;
  }).join('');
  return `<h1 class="page">${esc(t(locale, 'guide.title'))}</h1>
    <p class="muted">${esc(t(locale, 'guide.lede', { name }))}</p>
    <ol class="guide">${items}</ol>
    <div class="block"><h2>${esc(t(locale, 'guide.after.title'))}</h2><p>${esc(t(locale, 'guide.after.body', { name }))}</p></div>`;
}
