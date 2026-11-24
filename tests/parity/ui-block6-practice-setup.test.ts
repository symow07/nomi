// UI Block 6 · F38 — Practice and Getting started. Practice: the customer's box goes on with the conversation; the
// situation choice sits in it, under the message, not folded away; the trust evidence (the newest turn's checks and
// the safety checks that ran) is ONE short disclosure beside the box; Start over stays where it was, the same form and
// the same confirmation, drawn as a quiet secondary button. Getting started: progress is said once (how many of the
// five are done, the set-up times one press away), the next step is the one framed card with its instructions open,
// and the other steps are compact rows. Nothing a button does, and no confirmation, moved.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { renderSandbox, type SandboxView } from '../../src/api/web/sandbox.js';
import { renderGuide, type GuideView } from '../../src/api/web/guide.js';
import { withAssistantName } from '../../src/api/web/say.js';
import { esc } from '../../src/api/web/layout.js';
import { buttonsAndDoors } from './buttons-and-doors.js';
import { withoutIsolates } from './isolates.js';

const area = readFileSync(new URL('../../src/api/web/assistantAreaStyle.ts', import.meta.url), 'utf8');
const split = readFileSync(new URL('../../src/api/web/splitStyle.ts', import.meta.url), 'utf8');
const view = (over: Partial<SandboxView> = {}): SandboxView => ({
  hasConversation: true, conversationId: 'pc-1',
  messages: [{ direction: 'inbound', text: 'Do you have the rose lip oil?', isImage: false }],
  transcript: { earlier: null, older: false }, lastTurn: null, ownership: 'AI', ...over,
});
const report = { cases: [{ id: 'x', title: 'x', category: 'x', passed: true, checks: [] }], passed: 41, total: 41 };
const at = (h: string, s: string) => h.indexOf(s);
const GUIDE: GuideView = { steps: [{ step: 'profile', done: true }, { step: 'products', done: false }], next: 'products' };

describe('UI Block 6 · F38 — Practice', () => {
  it('the box goes on with the conversation; the situation choice is in it, under the message, not folded', () => {
    for (const l of LOCALES) {
      const html = renderSandbox(view(), l, { flash: null, practice: report });
      const compose = html.slice(at(html, 'id="compose"'), at(html, 'class="practice-trust"'));
      expect(at(html, 'class="timeline"'), l).toBeLessThan(at(html, 'id="compose"'));
      expect(compose, l).toContain('action="/app/sandbox/message"');
      expect(compose, l).toContain('<form method="post" action="/app/sandbox/scenario" class="scenariobar">');
      expect(at(compose, 'action="/app/sandbox/message"'), l).toBeLessThan(at(compose, 'action="/app/sandbox/scenario"'));
      expect(at(compose, 'action="/app/sandbox/scenario"'), l).toBeLessThan(at(compose, 'class="practice-media"'));
      expect(html, l).not.toContain('practice-scenarios');
    }
  });

  it('the trust evidence is ONE disclosure beside the box: the newest turn and the safety checks, the count on it', () => {
    for (const l of LOCALES) {
      const html = withoutIsolates(renderSandbox(view(), l, { flash: null, practice: report }));
      const count = withoutIsolates(esc(t(l, 'practice.scripted.count', { passed: 41, total: 41 })));
      expect(html, l).toContain(`<div class="sbx-pair">`);
      expect(html.match(/<details class="practice-trust">/g), l).toHaveLength(1);
      expect(html, l).toContain(`<details class="practice-trust"><summary>${esc(t(l, 'sandbox.trust.title'))} · <span class="pcount">${count}</span></summary>`);
      const fold = html.slice(at(html, 'class="practice-trust"'), html.indexOf('</details>', at(html, 'class="sbx-scripted"')));
      expect(fold, l).toContain('class="card sbx-trust');
      expect(fold, l).toContain(`<h3>${esc(t(l, 'practice.scripted.title'))} · ${count}</h3>`);
      expect(fold, l).toContain('<ul class="pcases">');
      // the safety checks are not said twice
      expect(html, l).not.toContain('class="card pchecks"');
    }
    // An earlier window has no box: there, the safety checks keep a fold of their own.
    const older = renderSandbox(view({ transcript: { earlier: null, older: true } }), 'en', { flash: null, practice: report });
    expect(older).toContain('<details class="card pchecks">');
    expect(older).not.toContain('id="compose"');
    expect(area).toContain('@media (min-width:1200px){.assistant-practice .sbx-pair{grid-template-columns:minmax(0,2fr) minmax(0,1fr);}}');
    expect(area).toContain('.assistant-practice summary:focus-visible{outline:2px solid var(--color-ink);outline-offset:2px;}');
  });

  it('Start over: the same form and confirmation where it was, drawn as a quiet secondary button; the situation is outlined', () => {
    for (const l of LOCALES) {
      const html = renderSandbox(view(), l, { flash: null });
      expect(html, l).toContain(`<div class="dhead spread sbx-log-h"><h2>${esc(t(l, 'inbox.detail.log'))}</h2><form method="post" action="/app/sandbox/reset" class="inline"><button class="btn danger" type="submit" onclick="return confirm(this.dataset.confirm)"`);
      expect(html, l).toContain(`data-confirm="${esc(t(l, 'sandbox.reset.confirm'))}"`);
      expect(html.split('class="btn send"').length - 1, l).toBe(1);
    }
    expect(area).toContain('.assistant-practice .sbx-log-h .btn.danger{border-color:var(--color-control-line);border-width:1px;font-weight:400;}');
    expect(area).not.toContain('.sbx-log-h .btn.danger{border-color:var(--color-ink);border-width:2px;}');
    expect(area).toContain('.assistant-practice .scenariobar .btn,.assistant-practice .mediabar .btn{background:transparent;color:var(--color-ink);border:1px solid var(--color-ink);}');
  });
});

describe('UI Block 6 · F38 — Getting started', () => {
  const ms = { signedUpAt: null, productsIn: new Date('2026-11-01T10:00:00Z'), contactsIn: null, channelConnected: null, firstReply: null };
  const guide = (l: (typeof LOCALES)[number]) => withoutIsolates(withAssistantName('Lily', () => renderGuide(
    GUIDE, l, 'Lily', undefined,
    { milestones: ms, now: new Date('2026-11-24T10:00:00Z'), canManage: true })));

  it('progress is said once — the count of the five, with the set-up times one press away, before the steps', () => {
    for (const l of LOCALES) {
      const html = guide(l);
      const line = withoutIsolates(esc(t(l, 'guide.progress', { done: '1', total: '5' })));
      expect(html, l).toContain(`<details class="gs-progress"><summary>${line} · ${esc(t(l, 'guide.progress.times'))}</summary><section class="setup-clock"`);
      expect(at(html, 'gs-progress'), l).toBeLessThan(at(html, 'guide setup-steps'));
      expect(html.match(/data-milestone=/g), l).toHaveLength(4);
    }
    expect(split).toContain('.gs-progress > summary:focus-visible, .setup-steps summary:focus-visible { outline:2px solid var(--color-ink); outline-offset:2px; }');
  });

  it('the next step is the one framed card, its instructions open; the rest are compact rows, all five kept', () => {
    for (const l of LOCALES) {
      const html = guide(l);
      expect(html.match(/class="guide-step/g), l).toHaveLength(5);
      expect(html, l).toContain('<li class="guide-step next" id="products">');
      expect(html.match(/<details class="gs-help" open>/g), l).toHaveLength(1);
      expect(buttonsAndDoors(html), l).toEqual([]);
    }
    expect(split).toContain('.setup-steps .guide-step.next { border:1px solid var(--color-ink); border-radius:var(--radius-card); padding:var(--space-20);');
    expect(split).toContain('.setup-steps .guide-step:not(.next) { padding-block:var(--space-8); }');
  });

  it('every new label is in all five catalogues, the French its own', () => {
    for (const k of ['guide.progress', 'guide.progress.times'] as MessageKey[]) {
      for (const l of LOCALES) expect(t(l, k), `${l} ${k}`).not.toBe('');
      expect(t('fr', k)).not.toBe(t('en', k));
    }
  });
});
