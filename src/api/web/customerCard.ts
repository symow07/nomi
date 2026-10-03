import type { Locale } from '../../core/owner/i18n/locale.js';
import type { CustomerCard } from '../../db/customerCard.js';
import { t } from './say.js';
import { esc, conversationUrl, deeper } from './layout.js';
import { face } from './faces.js';
import { channelName, productName } from './inbox.js';
import * as show from './values.js';

/**
 * THE WARMTH RUN (2026-10-03), phase 3 — THE PROFILE CARD.
 *
 * One rounded card: the large photo, the name, where they write and when they
 * last did, what they have bought (or asked about), what they have spent and
 * how many orders, and — when they are one of the people waiting on the owner
 * — the waiting signal. One action at the foot: the conversation.
 *
 * It is a PAGE (`/app/customers/:clientId`), so every face is a plain link
 * that works with scripting off; with it, the page's script lifts this card
 * (`[data-card-body]`) into a sheet that springs up over the page — a bottom
 * sheet on a phone — and the page underneath never moves.
 *
 * Phase 9 of the warmth run:
 *   - the waiting flag says what the conversation's strip and the Inbox say,
 *     in their word ("Needs you", `inbox.filter.pending`): one state, one name
 *     (w4-conversation-12 — the card said "Waiting for you" beside "Needs you");
 *   - opened from the very conversation its door leads to (`openedFrom`), the
 *     card has no door: "Open the conversation" led back to the page already
 *     open, and in the sheet it did nothing at all (a link that differs from
 *     the page only by its #latest). The sheet's × closes it; as a page, the
 *     route's back link returns there;
 *   - the door is the graphite primary action (w4-customers-26), its words
 *     inside its own padding.
 */
export function renderCustomerCard(c: CustomerCard, locale: Locale, now: Date, openedFrom: string | null = null): string {
  const name = c.name ?? t(locale, 'common.buyer');
  const where = c.channels.length > 0
    ? t(locale, 'pcard.on', { channels: c.channels.map((ch) => channelName(locale, ch)).join(' · ') }) : '';
  const wrote = c.lastWrote ? t(locale, 'pcard.lastWrote', { when: show.when(locale, c.lastWrote, now) }) : t(locale, 'pcard.neverWrote');
  const item = (p: { name: string | null; nameZh: string | null; quantity?: number | null; unit?: string | null }): string => {
    const label = productName(locale, p) ?? t(locale, 'pcard.unnamedProduct');
    const qty = p.quantity && p.unit ? ` <span class="pc-qty">${esc(show.quantityOf(locale, p.quantity, p.unit))}</span>` : '';
    return `<li><bdi>${esc(label)}</bdi>${qty}</li>`;
  };
  const things = c.bought.length > 0
    ? `<h2 class="pc-h">${esc(t(locale, 'pcard.bought'))}</h2><ul class="pc-list">${c.bought.map(item).join('')}</ul>`
    : c.askedAbout.length > 0
      ? `<h2 class="pc-h">${esc(t(locale, 'pcard.askedAbout'))}</h2><ul class="pc-list">${c.askedAbout.map(item).join('')}</ul>`
      : `<p class="pc-none">${esc(t(locale, 'pcard.nothingYet'))}</p>`;
  const spent = c.value.spent ? show.money(locale, c.value.spent) : t(locale, 'pcard.nothingSpent');
  return `<article class="pcard" data-card-body aria-labelledby="pc-name">
    <div class="pc-top">
      ${face({ clientId: c.clientId, name: c.name, photo: c.photo }, 'xl')}
      <h1 class="pc-name" id="pc-name"><bdi>${esc(name)}</bdi></h1>
      ${c.value.regular ? `<p class="pc-regular">${esc(t(locale, 'pcard.regular'))}</p>` : ''}
      ${c.waiting ? `<p class="pc-wait">${esc(t(locale, 'inbox.filter.pending'))}</p>` : ''}
      <p class="pc-meta">${where ? `<span>${esc(where)}</span>` : ''}<span>${esc(wrote)}</span></p>
    </div>
    <dl class="pc-facts">
      <div><dt>${esc(t(locale, 'pcard.spent'))}</dt><dd>${esc(spent)}</dd></div>
      <div><dt>${esc(t(locale, 'pcard.orders'))}</dt><dd>${esc(show.count(locale, c.value.orders))}</dd></div>
    </dl>
    <section class="pc-things">${things}</section>
    ${c.conversationId && c.conversationId !== openedFrom ? deeper(conversationUrl(c.conversationId), t(locale, 'pcard.open'), 'pc-open') : ''}
  </article>`;
}

/**
 * The conversation a card was opened from: the page that asked for it, when
 * that is one of this site's conversation pages (`/app/inbox/:id`, its own
 * host). The sheet's fetch and a plain link both send it; a browser that sends
 * none gets the card as it always was. It only decides which door is drawn.
 */
export function cardOpenedFrom(referer: string | undefined, host: string | undefined): string | null {
  if (!referer || !host) return null;
  try {
    const u = new URL(referer);
    if (u.host !== host) return null;
    const m = /^\/app\/inbox\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(u.pathname);
    return m ? m[1]!.toLowerCase() : null;
  } catch { return null; }
}
