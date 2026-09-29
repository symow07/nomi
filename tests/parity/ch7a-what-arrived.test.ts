import { describe, it, expect } from 'vitest';
import { parseMetaMessaging } from '../../src/channels/meta/messaging.js';
import { inboundDisposition } from '../../src/core/conversation/inbound.js';
import { renderConversationDetail, refOf, type ConversationDetail } from '../../src/api/web/inbox.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * CH7a — NAME WHAT ARRIVED (the one-month build order, 2026-09-29). A post
 * shared into the chat, a mention in the customer's story, a reply to the
 * shop's story with no words: each reached the owner as "a message" nobody
 * could read. Now each is named, and the post's or story's own link is kept so
 * the owner can open it. Matching it to a product is CH7, later, with its own
 * review; nothing here fetches or reads the link.
 */

const envelope = (message: Record<string, unknown>) => ({
  object: 'instagram',
  entry: [{ id: 'ig-acct', time: 1790000000000, messaging: [{
    sender: { id: 'igsid-1' }, recipient: { id: 'ig-acct' }, timestamp: 1790000000000, message: { mid: 'mid-1', ...message },
  }] }],
});
const POST = 'https://www.instagram.com/p/Cabc123/';
const STORY = 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1';

describe('CH7a · what arrived, by name, with its link', () => {
  it('a shared post keeps its kind and its link', () => {
    const [e] = parseMetaMessaging('instagram', envelope({ attachments: [{ type: 'share', payload: { url: POST } }] }));
    expect(e).toMatchObject({ messageType: 'unsupported', received: 'share', text: null, ref: POST });
    expect(inboundDisposition('unsupported', 'share')).toEqual({ kind: 'owner', received: 'shared_post' });
    expect(inboundDisposition('unsupported', 'ig_reel')).toEqual({ kind: 'owner', received: 'shared_post' });
  });

  it('a story mention, and a story reply with no words, are named too', () => {
    const [m] = parseMetaMessaging('instagram', envelope({ attachments: [{ type: 'story_mention', payload: { url: STORY } }] }));
    expect(m).toMatchObject({ received: 'story_mention', ref: STORY });
    expect(inboundDisposition('unsupported', 'story_mention')).toEqual({ kind: 'owner', received: 'story_mention' });
    const [r] = parseMetaMessaging('instagram', envelope({ reply_to: { story: { url: STORY, id: 's1' } } }));
    expect(r).toMatchObject({ messageType: 'unsupported', received: 'story_reply', ref: STORY });
    expect(inboundDisposition('unsupported', 'story_reply')).toEqual({ kind: 'owner', received: 'story_reply' });
  });

  it('a story reply WITH words is answered as ever — its story kept beside it', () => {
    const [r] = parseMetaMessaging('instagram', envelope({ text: 'how much is this?', reply_to: { story: { url: STORY } } }));
    expect(r).toMatchObject({ messageType: 'text', received: 'text', text: 'how much is this?', ref: STORY });
    expect(inboundDisposition('text', 'text')).toEqual({ kind: 'answer' });
  });

  it('an ordinary text has no link, and a kind nobody named is still handed over as "a message"', () => {
    const [e] = parseMetaMessaging('instagram', envelope({ text: 'hello' }));
    expect((e as { ref?: string }).ref).toBeUndefined();
    expect(inboundDisposition('unsupported', 'template')).toEqual({ kind: 'owner', received: 'other' });
  });
});

describe('CH7a · the owner\'s page names it, and opens it — only on Meta\'s own hosts', () => {
  const base: ConversationDetail = {
    conversationId: 'c-1', buyer: 'Maya', country: null, status: 'handled',
    product: { name: null, nameZh: null }, quantity: null, quote: null, order: null, messages: [], pendingDraft: null,
    ownership: 'WAITING_HUMAN', refusals: [], uncertainSends: [], handoffReasons: ['media_unreadable'], unheardReason: null,
    lastHumanAction: null, knowledgeUsed: [], rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
    unreadable: 'shared_post', unreadableRef: POST,
  };

  it('"A shared post from the buyer", with a door to it', () => {
    const html = renderConversationDetail(base, 'en', new Date(), null);
    expect(html).toContain(t('en', 'received.shared_post'));
    expect(html).toContain(`href="${POST}" rel="noopener noreferrer" target="_blank">${t('en', 'unreadable.open')}`);
  });

  it('only an https link on Meta\'s own hosts is ever made a door', () => {
    expect(refOf(POST)).toBe(POST);
    expect(refOf(STORY)).toBe(STORY);                         // Meta's own host for story links
    expect(refOf('https://scontent.cdninstagram.com/v/x.jpg')).toBe('https://scontent.cdninstagram.com/v/x.jpg');
    for (const bad of ['http://www.instagram.com/p/x/', 'javascript:alert(1)', 'https://instagram.com.evil.example/p/x',
      'https://evil.example/?u=instagram.com', 42, null, `https://www.instagram.com/${'x'.repeat(2100)}`]) {
      expect(refOf(bad), String(bad).slice(0, 40)).toBeNull();
    }
  });

  it('no link, no door', () => {
    expect(renderConversationDetail({ ...base, unreadableRef: null }, 'en', new Date(), null)).not.toContain('target="_blank"');
  });
});
