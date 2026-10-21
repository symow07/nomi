import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buttonsAndDoors } from './buttons-and-doors.js';
import { renderGuide } from '../../src/api/web/guide.js';
import { STEP_LINK } from '../../src/api/web/onboarding.js';
import { SETUP_STEPS, setupFrom, type SetupStep } from '../../src/db/setup.js';
import { renderConversationDetail, type ConversationDetail } from '../../src/api/web/inbox.js';
import { OWNER_VIEW } from '../../src/core/conversation/people.js';
import { usd } from '../../src/core/types/money.js';

/**
 * Buttons do things; doors go places — the rule (./buttons-and-doors.ts),
 * proved to catch each way it can be broken, held over the source of every
 * page, and over the page the owner uses most. Every real page, in two
 * languages, on real rows, goes through the same checker in
 * tests/integration/surface-walk.test.ts.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('the checker catches each way the rule breaks — and passes what keeps it', () => {
  it('a link dressed as a button, a button outside a form, a form that posts with nothing to post it', () => {
    expect(buttonsAndDoors('<a class="btn send" href="/app/products/add">Teach</a>')).toEqual(['a link drawn as a button: /app/products/add']);
    expect(buttonsAndDoors('<a class="btn" href="/x">Go</a>')).toHaveLength(1);
    expect(buttonsAndDoors('<button class="btn">Save</button>')).toHaveLength(1);
    expect(buttonsAndDoors('<button type="button" class="btn">Look</button>')).toHaveLength(1);
    expect(buttonsAndDoors('<form method="post" action="/x"><input name="a"></form>')).toEqual(['a form that posts has no button to post it']);
  });
  it('a door, a button in a form, a script control, a search form', () => {
    expect(buttonsAndDoors('<a class="deeper" href="/x">Go<span class="go">›</span></a>')).toEqual([]);
    expect(buttonsAndDoors('<form method="post" action="/x"><button class="btn send">Send</button></form>')).toEqual([]);
    expect(buttonsAndDoors('<button type="button" class="btn ghost" data-notify-ask hidden>Tell me</button>')).toEqual([]);
    expect(buttonsAndDoors('<form method="get" action="/app/inbox"><input name="q"></form>')).toEqual([]);
  });
});

describe('the one exception has a hard cap: one filled button on its page, on the first incomplete step only', () => {
  const button = '<a class="btn send" data-first-step href="/app/settings/profile">Do it now</a>';
  it('the first step\'s button alone passes; a second, or another filled button beside it, does not', () => {
    expect(buttonsAndDoors(`<p>${button}</p><a class="deeper" href="/app/guide#profile">Watch</a>`)).toEqual([]);
    expect(buttonsAndDoors(button + button)).toEqual(['2 first-step buttons on one page: the cap is one']);
    expect(buttonsAndDoors(`${button}<form method="post" action="/x"><button class="btn send">Send</button></form>`))
      .toEqual(['the first step\'s button is not the page\'s only filled button (2 filled)']);
    // A plain button in a form beside it is not filled: it stays.
    expect(buttonsAndDoors(`${button}<form method="post" action="/x"><button class="btn">Save</button></form>`)).toEqual([]);
    // Without the mark, it is a link dressed as a button like any other.
    expect(buttonsAndDoors('<a class="btn send" href="/app/settings/profile">Do it now</a>')).toEqual(['a link drawn as a button: /app/settings/profile']);
  });

  it('Getting started: the first incomplete step\'s "Do it now" is the button, every later step\'s a door; none once all are done', () => {
    const steps = (done: Record<SetupStep, boolean>) => ({ steps: SETUP_STEPS.map((step) => ({ step, done: done[step] })), next: setupFrom(done).next });
    const some = steps({ profile: true, products: false, name: false, channels: true, first_success: false });
    const html = renderGuide(some, 'en', 'Mira', () => false);
    expect(buttonsAndDoors(html)).toEqual([]);
    expect([...html.matchAll(/data-first-step href="([^"]+)"/g)].map((m) => m[1])).toEqual([STEP_LINK.products]);
    for (const later of ['name', 'first_success'] as const) expect(html).toContain(`<a class="deeper" href="${STEP_LINK[later]}"`);
    const all = renderGuide(steps({ profile: true, products: true, name: true, channels: true, first_success: true }), 'en', 'Mira', () => false);
    expect(all).not.toContain('data-first-step');
  });
});

describe('the source of every page draws no link as a button', () => {
  it('src/api/web — one <a class="btn">, and it is the first step\'s (the owner\'s exception, 2026-10-13)', () => {
    const found: string[] = [];
    for (const f of readdirSync(`${ROOT}src/api/web`).filter((n) => n.endsWith('.ts'))) {
      const src = readFileSync(`${ROOT}src/api/web/${f}`, 'utf8');
      for (const m of src.matchAll(/<a\b[^>]*\bclass="(?:[^"$]*\s)?btn(?:[\s"])/g)) {
        found.push(`${f}: ${src.slice(m.index!, m.index! + 70).replace(/\s+/g, ' ')}`);
      }
    }
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^guide\.ts: <a class="btn send" data-first-step href="\$\{esc\(STEP_LINK\[next\]\)\}">/);
    // It takes the step, never an address: it can only open the step it names.
    expect(readFileSync(`${ROOT}src/api/web/guide.ts`, 'utf8')).toContain('export const firstStepButton = (locale: Locale, next: SetupStep): string =>');
  });
});

describe('the page the owner uses most keeps the rule', () => {
  it('the conversation page, with a reply to review and an order waiting', () => {
    const d: ConversationDetail = {
      conversationId: 'conv-1', buyer: 'Maya', country: 'GB', status: 'awaiting',
      product: { name: 'Gift box', nameZh: null }, quantity: 40, quote: null, order: null, messages: [],
      pendingDraft: { draftId: 'd1', draftText: 'Anything else I can help with?', capability: 'qualify', heldBecause: null },
      ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [],
      unheardReason: null, unreadable: null, lastHumanAction: null, knowledgeUsed: [],
      rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
      orderProposal: {
        id: 'f0000000-0000-0000-0000-000000000001', conversationId: 'conv-1', productId: 'b0000000-0000-0000-0000-000000000001',
        productName: 'Gift box', quantity: 40, unit: 'boxes', unitPrice: usd('2.1'), total: usd('84'), email: 'c@example.com',
        paymentTerms: null, incoterm: null, createdAt: new Date('2026-09-29T09:00:00Z'),
      },
    };
    expect(buttonsAndDoors(renderConversationDetail(d, 'en', new Date('2026-09-29T10:00:00Z'), null, OWNER_VIEW))).toEqual([]);
  });
});
