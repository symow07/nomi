/**
 * The cleanup of 2026-11-26 (the owner's text-and-alignment audit, sections 1 and 7) — what it changed that no other
 * test pins: a run of messages says its time once, the assistant's name once; a list's preview skips the disclosure
 * a first reply opens with, and the message itself is untouched.
 */
import { describe, expect, it } from 'vitest';
import { renderConversationDetail, type ConversationDetail, type TimelineMessage } from '../../src/api/web/inbox.js';
import { afterDisclosure, carriesDisclosure, disclosureFor, withDisclosure } from '../../src/core/conversation/disclosure.js';

const NOW = new Date('2026-11-26T12:00:00Z');
const at = (min: number): Date => new Date(NOW.getTime() - min * 60_000);
const detail = (messages: TimelineMessage[]): ConversationDetail => ({
  conversationId: '00000000-0000-0000-0000-0000000000a1', buyer: 'Maya', country: null, status: 'done', product: { name: null, nameZh: null }, quantity: null,
  quote: null, order: null, messages, pendingDraft: null,
  ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [], unheardReason: null, lastHumanAction: null,
  knowledgeUsed: [], rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
} as ConversationDetail);

describe('a run of messages: one time, one name', () => {
  const html = renderConversationDetail(detail([
    { direction: 'inbound', text: 'hello', at: at(30) },
    { direction: 'inbound', text: 'do you ship to Lagos?', at: at(29) },
    { direction: 'outbound', by: 'employee', text: 'Yes, we do.', at: at(28) },
    { direction: 'outbound', by: 'employee', text: 'It takes five days.', at: at(27) },
    { direction: 'outbound', by: 'owner', text: 'I can call you too.', at: at(26) },
    { direction: 'inbound', text: 'thanks', at: at(10) },
  ]), 'en', NOW, null);
  const classes = [...html.matchAll(/class="msg ([a-z ]+)">/g)].map((m) => m[1]);

  it('every message of a run but its last is marked; a new speaker, or a gap, ends the run', () => {
    expect(classes).toEqual(['inbound mid', 'inbound', 'outbound mid', 'outbound', 'outbound', 'inbound']);
  });

  it('the assistant is named over the first bubble of its run only; every message keeps its own time for a reader', () => {
    expect(html.match(/<div class="msg-by">/g)).toHaveLength(1);
    expect(html.match(/<div class="ts muted">/g)).toHaveLength(6);
  });

  it('the customer is named by the heading, not under every bubble: the caption keeps the name for a reader only', () => {
    expect(html).toContain('<span class="sr"> · <bdi>Maya</bdi></span></div>');
    expect(html).not.toMatch(/<div class="ts muted">[^<]* · <bdi>Maya<\/bdi>/);
  });

  it('nothing waiting: the pill alone, and "Hand to me" is not a phone\'s band over the tab bar', () => {
    expect(html).not.toContain('takeover-note');
    expect(html).not.toContain('data-band="take"');
    expect(renderConversationDetail({ ...detail([]), ownership: 'WAITING_HUMAN', handoffReasons: ['human_requested'] } as ConversationDetail, 'en', NOW, null))
      .toContain('data-band="take"');
  });
});

describe('a list\'s preview starts after the disclosure', () => {
  const said = disclosureFor({ detected: 'en', name: 'Lily', business: 'Westlake Canvas Co.' })!;

  it('the sentence a first reply opens with is skipped; the reply is what is shown', () => {
    const sent = withDisclosure(said, 'The tote is $4.50 each.');
    expect(carriesDisclosure(sent)).toBe(true);
    expect(afterDisclosure(sent)).toBe('The tote is $4.50 each.');
  });

  it('a message that is the disclosure alone, or does not open with it, is shown as it is', () => {
    expect(afterDisclosure(said)).toBe(said);
    expect(afterDisclosure('The tote is $4.50 each.')).toBe('The tote is $4.50 each.');
    const later = `Sure.\n\n${said}`;
    expect(afterDisclosure(later)).toBe(later);
  });
});
