import type { Locale } from '../../core/owner/i18n/locale.js';
import type { FollowUpRun } from '../../db/followUps.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { esc } from './layout.js';
import { t } from './say.js';
import * as show from './values.js';

const words = (s: string): string => `<bdi lang="en" dir="ltr">${esc(s)}</bdi>`;
const say = (l: Locale, k: MessageKey, p?: Record<string, string | number>): string => words(t(l, k, p));
const exact = (s: string): string => `<blockquote class="follow-up-words" dir="auto">${esc(s)}</blockquote>`;

/* The rule's own fields (on or off, the days, the words) are a section of Settings › Assistant › Reply permissions,
   saved by that page's one Save (employee.ts `renderEmployee`, rule 104). This file draws a conversation's follow-ups. */

const reasons: Readonly<Record<string, MessageKey>> = {
  customer_answered: 'followUp.answered', opted_out: 'followUp.optedOut', unsubscribed: 'followUp.unsubscribed',
  deletion: 'followUp.deletion', held_by_person: 'followUp.person', conversation_closed: 'followUp.conversationClosed',
  stopped: 'followUp.stopped', silenced: 'followUp.silenced', allowance: 'followUp.allowance', billing: 'followUp.billing',
  workspace_closed: 'followUp.workspaceClosed', practice: 'followUp.practice', owner_skipped: 'followUp.skipped',
};
export function renderFollowUps(locale: Locale, runs: readonly FollowUpRun[], owner: boolean, now: Date): string {
  if (!runs.length) return '';
  return `<section class="follow-ups" aria-labelledby="follow-up-heading"><h2 id="follow-up-heading">${say(locale, 'followUp.title')}</h2>${runs.map(r => {
    const accepted = ['sent', 'delivered', 'read'].includes(r.outbound_status ?? '');
    const approved = ['approved', 'edited'].includes(r.draft_status ?? '');
    const active = ['scheduled', 'draft', 'window_closed'].includes(r.state) && !approved
      && (!r.draft_status || r.draft_status === 'pending');
    const state: MessageKey = accepted ? 'followUp.sent'
      : approved ? (['failed', 'uncertain', 'canceled'].includes(r.outbound_status ?? '') ? 'followUp.failed' : 'followUp.sending')
      : r.state === 'skipped' ? 'followUp.skipped' : r.state === 'canceled' ? 'followUp.canceled'
      : r.draft_status === 'expired' ? 'followUp.expired' : r.draft_status === 'rejected' ? 'followUp.dismissed'
      : r.draft_status === 'superseded' ? 'followUp.canceled' : r.state === 'window_closed' ? 'followUp.closed'
      : r.state === 'draft' ? 'followUp.review' : r.due_at <= now ? 'followUp.dueNow' : 'followUp.planned';
    const date = (at: Date) => `<time datetime="${at.toISOString()}">${esc(show.dateYear(locale, at))} · ${esc(show.time(locale, at))}</time>`;
    return `<article class="follow-up-run"><h3>${say(locale, 'followUp.run')}</h3>
      <p>${say(locale, state, { channel: t(locale, `conv.channel.${r.channel}` as MessageKey) })}</p>
      ${r.reason && reasons[r.reason] ? `<p>${say(locale, reasons[r.reason]!)}</p>` : ''}
      ${r.answered_after_approval ? `<p role="note">${say(locale, 'followUp.race')}</p>` : ''}
      <p>${say(locale, 'followUp.due')} · ${date(r.due_at)}</p>
      ${exact(r.wording)}
      <details><summary>${say(locale, 'followUp.source')}</summary><p>${date(r.quoted_at)}</p>${r.source_words ? exact(r.source_words) : ''}</details>
      ${owner && active ? `<form method="post" action="/app/inbox/${esc(r.conversation_id)}/follow-ups/${esc(r.id)}/skip"><button class="btn" type="submit">${say(locale, 'followUp.skip')}</button></form>` : ''}
      </article>`;
  }).join('')}</section>`;
}
