import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseMetaMessaging } from '../../src/channels/meta/messaging.js';
import { matchCaption, postLine, captionShown, foldForMatch, type CatalogueEntry } from '../../src/core/conversation/sharedPost.js';
import { metaPostCaption } from '../../src/channels/meta/posts.js';

/**
 * CH7 — a shared post or a story reply, matched to a product: the media id
 * kept from Meta's webhook, the shop's own caption read with its token, one
 * product's name found whole, and nothing guessed otherwise.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const ig = (message: Record<string, unknown>) => parseMetaMessaging('instagram', {
  object: 'instagram',
  entry: [{ id: '17', time: 1, messaging: [{ sender: { id: 'IGSID' }, recipient: { id: '17' }, timestamp: 1, message: { mid: 'm1', ...message } }] }],
})[0] as { received: string; text: string | null; ref?: string; postId?: string };

describe('CH7 · the media id, as Meta gives it', () => {
  it('a post or a reel shared in; a story replied to, with words or without', () => {
    expect(ig({ attachments: [{ type: 'ig_post', payload: { ig_post_media_id: '18001', url: 'https://www.instagram.com/p/a/' } }] }))
      .toMatchObject({ received: 'ig_post', postId: '18001', ref: 'https://www.instagram.com/p/a/' });
    expect(ig({ attachments: [{ type: 'ig_reel', payload: { reel_video_id: 18002, url: 'https://www.instagram.com/reel/b/' } }] }))
      .toMatchObject({ received: 'ig_reel', postId: '18002' });
    expect(ig({ text: 'price?', reply_to: { story: { id: '18003', url: 'https://lookaside.fbsbx.com/x' } } }))
      .toMatchObject({ received: 'text', text: 'price?', postId: '18003' });
    expect(ig({ reply_to: { story: { id: '18004', url: 'https://lookaside.fbsbx.com/y' } } }))
      .toMatchObject({ received: 'story_reply', postId: '18004' });
  });
  it('no id, or one that is not an id: none — and a plain message carries none', () => {
    expect(ig({ attachments: [{ type: 'share', payload: { url: 'https://www.instagram.com/p/c/' } }] }).postId).toBeUndefined();
    expect(ig({ attachments: [{ type: 'ig_post', payload: { ig_post_media_id: '../../me/accounts' } }] }).postId).toBeUndefined();
    expect(ig({ text: 'hello' }).postId).toBeUndefined();
  });
});

describe('CH7 · one product named, found whole', () => {
  const CAT: CatalogueEntry[] = [
    { productId: 'scarf', name: 'Silk scarf', names: ['丝巾', 'foulard en soie'] },
    { productId: 'scarfxl', name: 'Silk scarf XL', names: [] },
    { productId: 'hat', name: 'Winter beanie', names: ['wool hat', 'S'] },
    { productId: 'bag', name: 'Bag', names: [] },
    { productId: 'oud', name: 'عود ملكي', names: [] },
  ];
  it('its name, its Chinese name, an alias; case, accents and punctuation folded', () => {
    expect(matchCaption('NEW: our SILK-SCARF in five colours', CAT)).toEqual({ kind: 'matched', productId: 'scarf', name: 'Silk scarf' });
    expect(matchCaption('新款丝巾上架啦', CAT)).toMatchObject({ productId: 'scarf' });
    expect(matchCaption('Le foulard en soie est là', CAT)).toMatchObject({ productId: 'scarf' });
    expect(matchCaption('The wool hat is back', CAT)).toEqual({ kind: 'matched', productId: 'hat', name: 'Winter beanie' });
    // Arabic's vowel marks folded away: the name is found however it was vowelled.
    expect(matchCaption('وصل عودٌ ملكيّ جديد', CAT)).toMatchObject({ productId: 'oud' });
    expect(matchCaption('عود ملكي — الإصدار الجديد', CAT)).toMatchObject({ productId: 'oud' });
  });
  it('the longer name wins where one holds the other', () => {
    expect(matchCaption('The Silk Scarf XL is here', CAT)).toMatchObject({ productId: 'scarfxl' });
  });
  it('nothing guessed: no name, two products, a name inside a word, a name too short', () => {
    expect(matchCaption('Spring is here', CAT)).toEqual({ kind: 'none' });
    expect(matchCaption('Silk scarf and the wool hat, together', CAT)).toEqual({ kind: 'several' });
    expect(matchCaption('our new handbag', CAT)).toEqual({ kind: 'none' });
    expect(matchCaption('Size S only', CAT)).toEqual({ kind: 'none' });
    expect(matchCaption(null, CAT)).toEqual({ kind: 'none' });
    expect(matchCaption('   ', CAT)).toEqual({ kind: 'none' });
  });
  it('folding', () => {
    expect(foldForMatch('Crème  BRÛLÉE!')).toBe('creme brulee');
  });
});

describe('CH7 · the line the turn reads, and the caption kept', () => {
  it('what the customer did, marked; the catalogue name only', () => {
    expect(postLine('shared_post', 'Silk scarf')).toBe('[shared your post about: Silk scarf]');
    expect(postLine('story_reply', 'Silk scarf')).toBe('[replied to your story about: Silk scarf]');
  });
  it('the caption for the card: spaces folded, 600 characters at most, nothing when empty', () => {
    expect(captionShown('  a\n\nb  ')).toBe('a b');
    expect(captionShown('x'.repeat(700))!.length).toBe(600);
    expect(captionShown('')).toBeNull();
    expect(captionShown(null)).toBeNull();
  });
});

describe('CH7 · the caption, read from Meta', () => {
  const fake = (status: number, body: unknown, seen: string[] = []) => async (url: string) => {
    seen.push(url);
    return { status, text: async () => JSON.stringify(body) };
  };
  it('the media\'s own caption with the Page token; anything else is none, never an error', async () => {
    const seen: string[] = [];
    expect(await metaPostCaption({ accessToken: 't', graphVersion: 'v23.0', fetchImpl: fake(200, { caption: 'Silk scarf', id: '1' }, seen) })('18001')).toBe('Silk scarf');
    expect(seen[0]).toBe('https://graph.facebook.com/v23.0/18001?fields=caption');
    expect(await metaPostCaption({ accessToken: 't', graphVersion: 'v23.0', fetchImpl: fake(400, { error: { code: 100 } }) })('18001')).toBeNull();
    expect(await metaPostCaption({ accessToken: 't', graphVersion: 'v23.0', fetchImpl: fake(200, { id: '1' }) })('18001')).toBeNull();
    expect(await metaPostCaption({ accessToken: 't', graphVersion: 'v23.0', fetchImpl: async () => { throw new Error('down'); } })('18001')).toBeNull();
    const none: string[] = [];
    expect(await metaPostCaption({ accessToken: 't', graphVersion: 'v23.0', fetchImpl: fake(200, {}, none) })('a/b')).toBeNull();
    expect(none).toEqual([]);
  });
});

describe('CH7 · where the worker reads it', () => {
  const w = src('src/worker/main.ts');
  it('after the holds and the unlisted number, outside any transaction, before the disposition', () => {
    const read = w.indexOf('await postCaption({ db, businessId: businessId.value, postId: job.data.postId })');
    expect(read).toBeGreaterThan(w.indexOf('const hold = await withTenantTx'));
    expect(read).toBeGreaterThan(w.indexOf('if (unlisted) {'));
    expect(read).toBeLessThan(w.indexOf("const disposition = inboundDisposition(job.data.messageType ?? 'text', job.data.received);"));
  });
  it('the timeline keeps his words; the fragment carries the line', () => {
    expect(w).toContain("text: named ? `${job.data.text}\\n${postLine('story_reply', named.name)}` : job.data.text,");
    expect(w).toContain('await recordTypedMessage(tx, conversationId.value, job.data.messageId, job.data.text);');
  });
});
