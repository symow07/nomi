import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';

import type { MetaLiveCheck } from '../../channels/meta/health.js';
import { t } from './say.js';
import { esc } from './layout.js';
import * as show from './values.js';

/**
 * CH1 — "YOUR ACCOUNTS": the steps of connecting a Facebook Page and its
 * Instagram, each marked from what is actually there (`channels/meta/health.ts`
 * reads Meta; the first message is our own record). The owner sees which step
 * is done, which one is not and why, and — for each — the help page that says
 * what to check (CH2, `/app/help/meta`).
 *
 * A line Meta did not answer is "could not check just now", never a failure.
 */

export type YourAccounts = {
  /** The Page she connected; null: none yet. */
  readonly page: string | null;
  /** Its Instagram account, `@name`; null: none linked. */
  readonly instagram: string | null;
  /** What Meta said just now; null when there is no Page to ask about, or no login to ask with. */
  readonly check: MetaLiveCheck | null;
  /** A send already found the token dead (`meta_accounts.needs_attention_at`). */
  readonly needsAttention: boolean;
  /** The first message a customer sent on each, as we recorded it; null: none yet. */
  readonly firstMessage: { readonly instagram: Date | null; readonly messenger: Date | null };
};

type Mark = 'done' | 'todo' | 'bad' | 'unknown';
const MARK: Record<Mark, string> = { done: '✓', todo: '○', bad: '✕', unknown: '–' };

const step = (locale: Locale, mark: Mark, label: MessageKey, said: string, help: string): string => `
    <div class="pr ${mark}"><span class="mk" aria-hidden="true">${MARK[mark]}</span>
      <span class="lbl"><b>${esc(t(locale, label))}</b> <span class="sr">${esc(t(locale, `accounts.mark.${mark}` as MessageKey))}</span></span>
      <span class="pr-note">${esc(said)} <a href="/app/help/meta#${help}">${esc(t(locale, 'accounts.help'))}</a></span></div>`;

export function renderYourAccounts(v: YourAccounts, locale: Locale): string {
  const c = v.check;
  const rows: string[] = [];

  rows.push(v.page
    ? step(locale, 'done', 'accounts.page', t(locale, 'accounts.page.done', { page: v.page }), 'page')
    : step(locale, 'todo', 'accounts.page', t(locale, 'accounts.page.todo'), 'page'));

  rows.push(!v.page ? step(locale, 'todo', 'accounts.instagram', t(locale, 'accounts.after'), 'instagram')
    : v.instagram ? step(locale, 'done', 'accounts.instagram', t(locale, 'accounts.instagram.done', { account: v.instagram }), 'instagram')
    : step(locale, 'bad', 'accounts.instagram', t(locale, 'accounts.instagram.bad'), 'instagram'));

  const dead = v.needsAttention || c?.token === 'invalid';
  rows.push(!v.page ? step(locale, 'todo', 'accounts.token', t(locale, 'accounts.after'), 'connect')
    : dead ? step(locale, 'bad', 'accounts.token', t(locale, 'accounts.token.bad'), 'connect')
    : c?.token === 'valid' ? step(locale, 'done', 'accounts.token', t(locale, 'accounts.yes'), 'connect')
    : step(locale, 'unknown', 'accounts.token', t(locale, 'accounts.unknown'), 'connect'));

  const later = t(locale, !v.page ? 'accounts.after' : 'accounts.afterReconnect');
  rows.push(!v.page || dead ? step(locale, 'todo', 'accounts.permissions', later, 'permissions')
    : c?.missing == null ? step(locale, 'unknown', 'accounts.permissions', t(locale, 'accounts.unknown'), 'permissions')
    : c.missing.length === 0 ? step(locale, 'done', 'accounts.permissions', t(locale, 'accounts.permissions.done'), 'permissions')
    : step(locale, 'bad', 'accounts.permissions', t(locale, 'accounts.permissions.bad', { missing: c.missing.join(', ') }), 'permissions'));

  rows.push(!v.page || dead ? step(locale, 'todo', 'accounts.subscribed', later, 'subscription')
    : c?.subscribed == null ? step(locale, 'unknown', 'accounts.subscribed', t(locale, 'accounts.unknown'), 'subscription')
    : c.subscribed ? step(locale, 'done', 'accounts.subscribed', t(locale, 'accounts.yes'), 'subscription')
    : step(locale, 'bad', 'accounts.subscribed', t(locale, 'accounts.subscribed.bad'), 'subscription'));

  const first = [
    v.firstMessage.instagram ? t(locale, 'accounts.test.on', { channel: t(locale, 'reach.channel.instagram'), date: show.date(locale, v.firstMessage.instagram) }) : null,
    v.firstMessage.messenger ? t(locale, 'accounts.test.on', { channel: t(locale, 'reach.channel.messenger'), date: show.date(locale, v.firstMessage.messenger) }) : null,
  ].filter((s): s is string => s !== null);
  rows.push(first.length > 0
    ? step(locale, 'done', 'accounts.test', first.join(' · '), 'test-message')
    : step(locale, 'todo', 'accounts.test', t(locale, 'accounts.test.todo'), 'test-message'));

  return `<section class="block" id="your-accounts" aria-labelledby="your-accounts-h">
    <h2 id="your-accounts-h">${esc(t(locale, 'accounts.title'))}</h2>
    <p class="muted ch-desc">${esc(t(locale, 'accounts.lead'))}</p>
    ${rows.join('')}
  </section>`;
}
