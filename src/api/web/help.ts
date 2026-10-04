import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { t, assistantName } from './say.js';
import { esc, back } from './layout.js';
import { channelScreenHref, channelScreenTitle } from './channels.js';
import * as show from './values.js';
import { AWAY } from './icons.js';

/**
 * CH2 (the one-month build order, 2026-09-30) — WHAT TO CHECK, AND WHY.
 *
 * One page for connecting a Facebook Page and its Instagram, in the order of
 * "Your accounts" (CH1): each step says what to check and why it matters, and
 * — where Meta has a page for it — links to Meta's own help for where to
 * click. Meta's screens change, and three languages of screenshots would be
 * wrong within the year; what to check does not change, and the Channels page
 * proves each step by reading its state.
 *
 * Only links whose pages were read and named on 2026-09-30 (their titles are
 * in the comments). A step with no such page says where the setting is instead.
 */

type HelpStep = {
  readonly id: string;
  readonly title: MessageKey;
  readonly check: MessageKey;
  /** Phase 9 — the check, said without pointing at a status this installation does not show. */
  readonly checkNoStatus?: MessageKey;
  readonly why: MessageKey;
  readonly meta: readonly { readonly href: string; readonly label: MessageKey }[];
};

export const META_HELP_STEPS: readonly HelpStep[] = [
  {
    id: 'page', title: 'help.meta.page.title', check: 'help.meta.page.check', why: 'help.meta.page.why',
    // "Create a Facebook Page | Facebook Help Center"
    meta: [{ href: 'https://www.facebook.com/help/104002523024878', label: 'help.meta.link.createPage' }],
  },
  {
    id: 'instagram', title: 'help.meta.instagram.title', check: 'help.meta.instagram.check', why: 'help.meta.instagram.why',
    meta: [
      // "Set up a professional Instagram account to access business or creator tools and controls"
      { href: 'https://www.facebook.com/business/help/502981923235522', label: 'help.meta.link.professional' },
      // "Connect or disconnect your professional Instagram account and a Facebook Page | Meta Business Help Center"
      { href: 'https://www.facebook.com/business/help/898752960195806', label: 'help.meta.link.linkPage' },
    ],
  },
  { id: 'connect', title: 'help.meta.connect.title', check: 'help.meta.connect.check', checkNoStatus: 'help.meta.connect.check.noStatus', why: 'help.meta.connect.why', meta: [] },
  { id: 'permissions', title: 'help.meta.permissions.title', check: 'help.meta.permissions.check', why: 'help.meta.permissions.why', meta: [] },
  { id: 'subscription', title: 'help.meta.subscription.title', check: 'help.meta.subscription.check', checkNoStatus: 'help.meta.subscription.check.noStatus', why: 'help.meta.subscription.why', meta: [] },
  { id: 'test-message', title: 'help.meta.test.title', check: 'help.meta.test.check', why: 'help.meta.test.why', meta: [] },
];

/**
 * Phase 9 — `statusShown`: whether the Channels page shows each step's state
 * ("Your Facebook Page and Instagram", CH1 — only where this installation can
 * connect a Page). Where it does not, the page does not send the owner to
 * look for it. The back link names the page by its own name and sits above
 * the heading, as on every other page; the rules are the Channels page's own
 * sentences, so the two pages cannot say two things.
 */
export function renderMetaHelp(locale: Locale, o: { readonly statusShown?: boolean } = {}): string {
  const name = assistantName(locale);
  const shown = o.statusShown ?? true;
  // Phase 9 (w4-business-assistant-07) — the steps are on Instagram and Messenger's own screen, under its name.
  const where = { section: t(locale, 'accounts.title'), page: channelScreenTitle(locale, 'meta') };
  const steps = META_HELP_STEPS.map((s, i) => `
    <section class="block help-step" id="${s.id}" aria-labelledby="${s.id}-h">
      <h2 id="${s.id}-h">${esc(show.count(locale, i + 1))}. ${esc(t(locale, s.title))}</h2>
      <p class="help-line"><b>${esc(t(locale, 'help.meta.checkLabel'))}</b> ${esc(t(locale, !shown && s.checkNoStatus ? s.checkNoStatus : s.check, { name, ...where }))}</p>
      <p class="help-line muted">${esc(t(locale, 'help.meta.whyLabel'))} ${esc(t(locale, s.why, { name }))}</p>
      ${s.meta.length ? `<ul class="help-links">${s.meta.map((m) =>
        `<li><a href="${esc(m.href)}" rel="noopener noreferrer" target="_blank">${esc(t(locale, m.label))}${AWAY}<span class="sr">${esc(t(locale, 'help.meta.opensMeta'))}</span></a></li>`).join('')}</ul>` : ''}
    </section>`).join('');
  return `
    <div class="dhead">${back(`${channelScreenHref('meta')}${shown ? '#your-accounts' : ''}`, channelScreenTitle(locale, 'meta'))}</div>
    <h1 class="page">${esc(t(locale, 'help.meta.title'))}</h1>
    <p class="lede">${esc(t(locale, shown ? 'help.meta.lead' : 'help.meta.lead.noStatus', { name, ...where }))}</p>
    ${steps}
    <section class="block" id="rules" aria-labelledby="rules-h">
      <h2 id="rules-h">${esc(t(locale, 'help.meta.rules.title'))}</h2>
      <ul class="frules">
        <li>${esc(t(locale, 'meta.rules.window', { name }))}</li>
        <li>${esc(t(locale, 'meta.rules.first', { name }))}</li>
        <li>${esc(t(locale, 'meta.rules.media', { name }))}</li>
      </ul>
    </section>`;
}
