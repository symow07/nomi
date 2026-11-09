import { describe, it, expect } from 'vitest';
import { renderInstagramComments, type CommentPage } from '../../src/api/web/instagramComments.js';
import type { InstagramComment } from '../../src/db/instagramComments.js';
import { suggestCommentReply } from '../../src/core/channel/commentSuggestion.js';
import { unisolatedFigures } from './isolates.js';
import { buttonsAndDoors } from './buttons-and-doors.js';

const now = new Date('2027-01-15T12:00:00Z');
const base: InstagramComment = {
  id: '11111111-1111-4111-8111-111111111111', business_id: 'b', meta_account_id: 'a', account_id: '123456', comment_id: '234567',
  identity: '345678', username: 'shopper42', words: 'Is this still available?', media_id: '456789', received_at: now,
  created_at: new Date(now.getTime() - 3_600_000), asking: true, match_state: 'matched', product_id: 'p', product_name: 'Blue bag 24',
  post_url: null, enriched_at: now, read_failed: false, conversation_id: null, attribution_ambiguous: false,
  reply_outcome: null, reply_attempted_at: null, reply_status: null, public_requested: null, public_outcome: null,
};
const page = (c: Partial<InstagramComment>, o: Partial<CommentPage> = {}): string => renderInstagramComments('en',
  { comments: [{ ...base, ...c }], enabled: true, configured: true, connected: true, owner: true, now, ...o });
const textarea = (html: string): string => /<textarea[^>]*>([\s\S]*?)<\/textarea>/.exec(html)?.[1] ?? '';

describe('5.4 Part B · the suggestion carries no price unless the owner types one', () => {
  it('names the matched product and quotes words that hold no figure', () => {
    expect(suggestCommentReply({ words: 'Is this still available?', productName: 'Blue bag' }))
      .toBe('Hi, thanks for your comment on our post about Blue bag. You asked: “Is this still available?” How can I help?');
  });
  for (const words of ['Is it $20?', 'price 15', '多少钱 ٥٠', 'combien 12€', 'is it £?'])
    it(`never quotes words holding a figure or a currency sign: ${words}`, () => {
      const s = suggestCommentReply({ words, productName: null });
      expect(s).toBe('Hi, thanks for your comment on our post. How can I help?');
      expect(s).not.toMatch(/[\p{Nd}\p{Sc}]/u);
    });
  it('no product named → no product guessed; several → none named', () => {
    expect(page({ match_state: 'several', product_name: 'Blue bag 24' })).not.toContain('about Blue bag');
    expect(textarea(page({}))).toContain('about Blue bag 24');
  });
  it('a suggestion of its own has no figure besides the catalogue name', () => {
    expect(suggestCommentReply({ words: 'how much?', productName: 'Tote' })).not.toMatch(/[\p{Nd}\p{Sc}]/u);
  });
});

describe('5.4 Part B · the Comments page', () => {
  for (const locale of ['en', 'ar'] as const) it(`${locale}: the owner's form posts to the reply route, with the public tick unticked`, () => {
    const html = renderInstagramComments(locale, { comments: [base], enabled: true, configured: true, connected: true, owner: true, now });
    expect(html).toContain(`action="/app/channels/instagram/comments/${base.id}/reply"`);
    expect(html).toMatch(/<textarea[^>]*name="body"[^>]*maxlength="1000"/);
    expect(html).toContain('name="public" value="1"');
    expect(html).not.toMatch(/name="public"[^>]*checked/);
    expect(html).not.toMatch(/igComments\.[a-z]/);
    expect(textarea(html)).not.toMatch(/[⁦-⁩]/);
    if (locale === 'ar') expect(unisolatedFigures(html)).toEqual([]);
    expect(buttonsAndDoors(html)).toEqual([]);
  });
  it('staff see the state and no form', () => {
    const html = page({}, { owner: false });
    expect(html).not.toContain('/reply"');
    expect(html).toContain('Only the owner can reply');
  });
  it('no form when off, not asking, expired, unknown age, or already replied', () => {
    for (const html of [page({}, { enabled: false }), page({ asking: false }), page({ created_at: new Date(now.getTime() - 7 * 86_400_000) }),
      page({ created_at: null }), page({ created_at: new Date(now.getTime() + 1000) }),
      page({ reply_outcome: 'reserved', reply_status: 'queued' }), page({ reply_outcome: 'accepted', reply_attempted_at: now, reply_status: 'sent' }),
      page({ reply_outcome: 'uncertain', reply_attempted_at: now, reply_status: 'uncertain' }),
      page({ reply_outcome: 'refused', reply_attempted_at: now, reply_status: 'failed' })]) expect(html).not.toContain('/reply"');
  });
  it('each state says what happened, and that nothing is sent again', () => {
    expect(page({ reply_outcome: 'reserved', reply_status: 'queued' })).toContain('on its way');
    expect(page({ reply_outcome: 'accepted', reply_attempted_at: now })).toContain('Your private reply was sent');
    expect(page({ reply_outcome: 'uncertain', reply_attempted_at: now })).toContain('It is not sent again');
    expect(page({ reply_outcome: 'refused', reply_attempted_at: now })).toContain('Instagram refused your private reply');
    expect(page({ reply_outcome: 'accepted', reply_attempted_at: now, public_requested: true, public_outcome: 'failed' })).toContain('It is not tried again');
    expect(page({ reply_outcome: 'accepted', reply_attempted_at: now, public_requested: true, public_outcome: 'accepted' })).toContain('public reply was posted');
    expect(page({ reply_outcome: 'reserved', reply_status: 'queued', public_requested: true })).toContain('once the private reply is accepted');
    expect(page({ attribution_ambiguous: true })).toContain('did not guess');
  });
  it('a reply refused before it reached Instagram may be sent again', () => {
    const html = page({ reply_outcome: 'reserved', reply_attempted_at: null, reply_status: 'canceled' });
    expect(html).toContain('You can send it again');
    expect(html).toContain('/reply"');
  });
});
