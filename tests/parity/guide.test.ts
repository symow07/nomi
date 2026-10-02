import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { renderGuide, guideFileAt, captionKeys, CAPTIONS_PER_STEP } from '../../src/api/web/guide.js';
import { SETUP_STEPS, type SetupStep } from '../../src/db/setup.js';
import { STEP_LINK } from '../../src/api/web/onboarding.js';
import { messages, t } from '../../src/core/owner/i18n/messages.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * THE GUIDED PATH — the five setup steps in order, each with where it stands,
 * its door while it is not done, and its video with captions in the owner's
 * language — and the same words as text, so nothing is lost without the video.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const half = { steps: SETUP_STEPS.map((step, i) => ({ step, done: i < 2 })), next: SETUP_STEPS[2]! };

describe('Guide · the page', () => {
  it('every step in order, with its state; a door only where it is not done; the next one marked', () => {
    const html = renderGuide(half, 'en', 'your assistant', () => false);
    let at = 0;
    for (const step of SETUP_STEPS) {
      const i = html.indexOf(`id="${step}"`, at);
      expect(i, step).toBeGreaterThan(at - 1);
      at = i;
    }
    expect(html.match(/class="pill ok"/g)).toHaveLength(2);
    expect(html).not.toContain(`href="${STEP_LINK.profile}"`);
    expect(html).toContain(`href="${STEP_LINK.name}"`);
    expect(html).toMatch(/class="guide-step next" id="name"/);
  });
  it('without a video, the words; with one, the video, its captions track, and the same words under it (phase 9: shown, not folded)', () => {
    const none = renderGuide(half, 'es', 'tu asistente', () => false);
    expect(none).not.toContain('<video');
    expect(none).toContain(esc(t('es', 'guide.products.cap.2')));
    const withVideo = renderGuide(half, 'es', 'tu asistente', (step) => step === 'products');
    expect(withVideo).toContain('src="/assets/guide/products.es.webm"');
    expect(withVideo).toContain('<track kind="captions" src="/assets/guide/products.es.vtt" srclang="es"');
    expect(withVideo).toContain(esc(t('es', 'guide.products.cap.2')));
    expect(withVideo).not.toContain('<summary>');
    expect(withVideo.match(/<video/g)).toHaveLength(1);
  });
  it('every step has its captions in every language', () => {
    for (const l of LOCALES) for (const step of SETUP_STEPS) {
      expect(captionKeys(step)).toHaveLength(CAPTIONS_PER_STEP);
      for (const k of captionKeys(step)) expect(messages[l][k], `${l} ${k}`).toBeTruthy();
    }
  });
});

describe('Guide · the files', () => {
  it('only a name of the one shape that the folder holds — never a path built from the request', () => {
    for (const bad of ['../package.json', 'profile.en.webm/../../x', 'profile.xx.webm', '.gitignore', 'profile.en.mp4', '']) {
      expect(guideFileAt(bad), bad).toBeNull();
    }
  });
  it('every recorded video has its captions beside it, in the same language', () => {
    let files: string[] = [];
    try { files = readdirSync(new URL('../../assets/guide/', import.meta.url)); } catch { /* no recordings yet */ }
    for (const f of files.filter((x) => x.endsWith('.webm'))) {
      expect(files, f).toContain(f.replace(/\.webm$/, '.vtt'));
      expect(guideFileAt(f)?.type).toBe('video/webm');
      const vtt = readFileSync(new URL(`../../assets/guide/${f.replace(/\.webm$/, '.vtt')}`, import.meta.url), 'utf8');
      expect(vtt.startsWith('WEBVTT'), f).toBe(true);
      // The captions say exactly what the catalogue says (the page prints the same words): a
      // changed line means a re-recording (tools/record-guide.mjs), never two versions.
      const [step, locale] = f.split('.') as [SetupStep, Locale];
      const cues = vtt.split('\n\n').slice(1).map((b) => b.trim().split('\n').slice(2).join('\n')).filter(Boolean);
      expect(cues, f).toEqual(captionKeys(step).map((k) => t(locale, k)));
    }
  });
});

describe('Guide · where it is reached', () => {
  it('Setup\'s first door, and Today\'s "finish setting up" line', () => {
    expect(src('src/api/web/settings.ts')).toContain("{ href: '/app/guide', label: t(locale, 'guide.title'), desc: t(locale, 'setup.desc.guide'), value: ready,");
    expect(src('src/api/web/operations.ts')).toContain("deeper(`/app/guide#${setup.next}`, t(locale, 'guide.watch'))");
  });
});
