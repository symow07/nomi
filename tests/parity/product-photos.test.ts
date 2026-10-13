import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { productPhotoType, productPhotoUrl, productPhotoPath, PHOTO_CHANNELS, PRODUCT_PHOTO_MAX_BYTES } from '../../src/db/productPhotos.js';
import { metaImageSender, type MetaFetch } from '../../src/channels/meta/messaging.js';
import { instagramAdapter } from '../../src/channels/instagram/adapter.js';
import { messengerAdapter } from '../../src/channels/messenger/adapter.js';
import { sentPhotoPath } from '../../src/api/web/inbox.js';
import { renderProductDetail, type ProductDetail } from '../../src/api/web/products.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { usd } from '../../src/core/types/money.js';
import type { Viewer } from '../../src/core/conversation/people.js';

/**
 * Phase 2d (the owner's roadmap and word, 2026-10-13; 0152) — a product's photo, kept in Postgres, served by Nomi,
 * sent in an Instagram (or Messenger, or WhatsApp) chat by the owner holding the conversation.
 *
 *   · what a file is comes from its own first bytes; at most 5 MB;
 *   · Meta gets an image attachment by Nomi's address, never a caption it cannot carry (refused, not dropped);
 *   · the owner's page keeps one photo, replace or remove; staff see it and no form;
 *   · the conversation draws a sent photo only when Nomi served it.
 */

const TOKEN = 'a'.repeat(43);

describe('Phase 2d · what a photo is, and where it lives', () => {
  it('JPEG, PNG and WebP by their own bytes; anything else (a GIF, text, a short file) is no photo', () => {
    expect(productPhotoType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1]))).toBe('image/jpeg');
    expect(productPhotoType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(productPhotoType(new Uint8Array([...Buffer.from('RIFF'), 1, 2, 3, 4, ...Buffer.from('WEBP')]))).toBe('image/webp');
    expect(productPhotoType(new Uint8Array(Buffer.from('GIF89a......')))).toBeNull();
    expect(productPhotoType(new Uint8Array(Buffer.from('<svg xmlns=')))).toBeNull();
    expect(productPhotoType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(PRODUCT_PHOTO_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  it('its address: from the root on the page, absolute on the public address to be sent — never guessed', () => {
    expect(productPhotoPath(TOKEN)).toBe(`/media/${TOKEN}`);
    expect(productPhotoUrl('https://app.example.test/', TOKEN)).toBe(`https://app.example.test/media/${TOKEN}`);
    expect(productPhotoUrl(null, TOKEN)).toBeNull();
    expect([...PHOTO_CHANNELS].sort()).toEqual(['instagram', 'messenger', 'whatsapp']);
  });

  it('the migration keeps one photo per product, its address its token, and gives the app no delete', () => {
    const sql = readFileSync('migrations/0152_product_photos.sql', 'utf8');
    expect(sql).toContain("url = '/media/' || token");
    expect(sql).toMatch(/create unique index if not exists product_images_one_served on product_images \(product_id\) where token is not null/);
    expect(sql).toContain('octet_length(bytes) between 1 and 5242880');
    expect(sql).toMatch(/p\.business_id = current_business_id\(\)/);
    expect(sql).not.toMatch(/grant (all|delete)[^;]*product_images/i);
  });
});

describe('Phase 2d · Meta sends the picture', () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl: MetaFetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return { status: 200, text: async () => JSON.stringify({ message_id: 'm-1' }) } as unknown as Awaited<ReturnType<MetaFetch>>;
  };
  const cfg = { accountId: 'page-1', accessToken: 'tok', graphVersion: 'v21.0', fetchImpl };

  it('an image attachment by Nomi’s address, as a response, through the Page', async () => {
    calls.length = 0;
    const r = await metaImageSender(cfg)('igsid-1', { url: `https://app.example.test/media/${TOKEN}`, caption: '' });
    expect(r).toEqual({ ok: true, providerMessageId: 'm-1' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://graph.facebook.com/v21.0/page-1/messages');
    expect(calls[0]!.body).toEqual({
      recipient: { id: 'igsid-1' }, messaging_type: 'RESPONSE',
      message: { attachment: { type: 'image', payload: { url: `https://app.example.test/media/${TOKEN}`, is_reusable: false } } },
    });
  });

  it('a caption is refused, never dropped: nothing is fetched', async () => {
    calls.length = 0;
    const r = await metaImageSender(cfg)('igsid-1', { url: `https://app.example.test/media/${TOKEN}`, caption: 'Our tote' });
    expect(r).toMatchObject({ ok: false, retryable: false });
    expect(calls).toHaveLength(0);
  });

  it('Instagram and Messenger both carry a picture now; e-mail still does not', () => {
    const meta = { accessToken: 'tok', appSecret: 's', graphVersion: 'v21.0', fetchImpl };
    expect(typeof instagramAdapter({ pageId: 'p', ...meta }).sendMedia).toBe('function');
    expect(typeof messengerAdapter({ accountId: 'p', ...meta }).sendMedia).toBe('function');
    expect(PHOTO_CHANNELS).not.toContain('email');
  });
});

describe('Phase 2d · the pages', () => {
  const product: ProductDetail = {
    currency: 'USD',
    id: 'p1', name: 'Canvas tote', nameZh: null, sku: 'CT-1', category: null,
    unit: 'pcs', moq: null, leadTimeDays: null, customizable: false, learned: true, status: 'learned', isActive: true, imageMatchable: false,
    tiers: [{ minQty: 1, maxQty: null, unitPrice: usd(2) }],
    aliases: [], images: [], recentQuotes: [],
  };
  const staff: Viewer = { id: 'staff-1', isOwner: false };

  it('the owner: "no photo yet", one form to add it (a file, the three types); with one, replace and a confirmed remove', () => {
    for (const l of LOCALES) {
      const none = renderProductDetail(product, l);
      expect(none, l).toContain('id="photo"');
      expect(none, l).toContain(t(l, 'product.photo.none'));
      expect(none, l).toContain('action="/app/products/p1/photo" enctype="multipart/form-data"');
      expect(none, l).toContain('accept="image/jpeg,image/png,image/webp"');
      expect(none, l).not.toContain('/photo/remove');
      const one = renderProductDetail({ ...product, images: [`/media/${TOKEN}`], photo: { token: TOKEN } }, l);
      expect(one, l).toContain(`<img src="/media/${TOKEN}"`);
      expect(one, l).toContain(t(l, 'product.photo.replace'));
      expect(one, l).toContain('action="/app/products/p1/photo/remove"');
      expect(one, l).toContain(`data-confirm="${t(l, 'product.photo.removeConfirm')}"`);
    }
  });

  it('staff: the photo, and no form; with none, no block at all', () => {
    const one = renderProductDetail({ ...product, images: [`/media/${TOKEN}`], photo: { token: TOKEN } }, 'en', null, {}, {}, staff);
    expect(one).toContain(`<img src="/media/${TOKEN}"`);
    expect(one).not.toContain('/app/products/p1/photo');
    expect(renderProductDetail(product, 'en', null, {}, {}, staff)).not.toContain('id="photo"');
  });

  it('a sent photo is drawn only when Nomi served it', () => {
    expect(sentPhotoPath(`https://app.example.test/media/${TOKEN}`)).toBe(`/media/${TOKEN}`);
    expect(sentPhotoPath('https://elsewhere.example/x.jpg')).toBeNull();
    expect(sentPhotoPath('https://app.example.test/media/short')).toBeNull();
    expect(sentPhotoPath(null)).toBeNull();
  });

  it('the routes: the public one answers 404 alike and is registered with its reason; the owner’s are owner-only', () => {
    const src = readFileSync('src/api/web/app.ts', 'utf8');
    expect(src).toMatch(/\{ method: 'GET', url: '\/media\/:token', why: '[^']+' \}/);
    const at = src.indexOf("app.get('/media/:token'");
    const handler = src.slice(at, src.indexOf('});', at));
    for (const h of ["'cache-control', 'no-store'", "'x-content-type-options', 'nosniff'", "'x-robots-tag', 'noindex, nofollow'"]) expect(handler, h).toContain(h);
    expect(handler).not.toContain('403');
    for (const route of ["app.post('/app/products/:id/photo'", "app.post('/app/products/:id/photo/remove'"]) {
      const r = src.slice(src.indexOf(route), src.indexOf('});', src.indexOf(route)));
      expect(r, route).toContain("ownerOnly(req, reply, 'price_rules'");
    }
  });
});
