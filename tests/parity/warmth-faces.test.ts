import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { face, faceLink, initialOf, tintOf, cardHref, FACE_PX } from '../../src/api/web/faces.js';
import { renderCustomerCard } from '../../src/api/web/customerCard.js';
import { shell } from '../../src/api/web/layout.js';
import { LIVE_SCRIPT } from '../../src/api/web/liveScript.js';
import { metaProfilePhoto, photoType, type PhotoFetch, type MetaFetch } from '../../src/channels/meta/messaging.js';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import type { CustomerCard } from '../../src/db/customerCard.js';
import { linkedCss } from './linked-css.js';

/**
 * THE WARMTH RUN (2026-10-03) — customers' faces and the profile card.
 *
 * The owner: "Real customer faces are the main source of colour and life. Use
 * the customer's profile photo where the channel provides one … Where it does
 * not (e-mail), fall back to a coloured initial. Cache them; never block a page
 * render on fetching a photo; handle a missing or failed photo silently." And
 * phase 3: "A rounded panel that springs up over the page in ~200 ms. Not a
 * new screen … on a phone it behaves as a bottom sheet."
 */
const ID = '5a1e0000-0000-4000-8000-0000000000aa';

const lum = (hex: string): number => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const contrast = (a: string, b: string): number => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};
const hue = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

describe('a face: the photo where there is one, a coloured initial where there is not', () => {
  it('the initial is the first letter a reader would pick, in every script', () => {
    expect(initialOf('maya rahman')).toBe('M');
    expect(initialOf('@lily_shop')).toBe('L');
    expect(initialOf('élodie')).toBe('É');
    expect(initialOf('王芳')).toBe('王');
    expect(initialOf('أحمد')).toBe('أ');
    expect(initialOf('"Omar"')).toBe('O');
    expect(initialOf('+86 138 0000 0000')).toBeNull();
    expect(initialOf(null)).toBeNull();
  });

  it('a customer keeps one tint everywhere, one of eight', () => {
    expect(tintOf(ID)).toBe(tintOf(ID));
    const seen = new Set(Array.from({ length: 200 }, (_, i) => tintOf(`5a1e0000-0000-4000-8000-${String(i).padStart(12, '0')}`)));
    expect([...seen].every((n) => n >= 1 && n <= 8)).toBe(true);
    expect(seen.size).toBe(8);
  });

  it('eight tints, each initial at least 6:1 on its ground; none is magenta\'s, nor a state\'s', () => {
    const tints = DESIGN_TOKENS.faceTint;
    expect(tints).toHaveLength(8);
    for (const f of tints) {
      expect(contrast(f.fg, f.bg), `${f.fg} on ${f.bg}`).toBeGreaterThanOrEqual(6);
      const h = hue(f.bg);
      expect(h < 300 || h > 350, `${f.bg} is not magenta`).toBe(true);
    }
    const values = tints.flatMap((f) => [f.bg, f.fg]);
    const C = DESIGN_TOKENS.color;
    for (const state of [C.ok, C.okWash, C.waiting, C.waitingWash, C.warn, C.warnWash, C.assistant, C.assistantWash]) expect(values).not.toContain(state);
  });

  it('no photo: the initial on its tint, hidden from a screen reader; never an <img>', () => {
    const html = face({ clientId: ID, name: 'Maya', photo: null }, 'm');
    expect(html).toBe(`<span class="face face-m t${tintOf(ID)}" aria-hidden="true"><span class="face-i">M</span></span>`);
    expect(html).not.toContain('<img');
    // no letter (a number on WhatsApp): a person's outline, still no picture fetched
    expect(face({ clientId: ID, name: '+212600000000' }, 's')).toContain('<svg');
  });

  it('a kept photo: an <img> laid on the initial, by its version, lazy, sized, with no words of its own', () => {
    const html = face({ clientId: ID, name: 'Maya', photo: 'a1b2c3d4e5f6' }, 'xl');
    expect(html).toContain('<span class="face-i">M</span>');
    expect(html).toContain(`<img class="face-p" src="/app/faces/${ID}?v=a1b2c3d4e5f6" alt="" width="96" height="96" loading="lazy" decoding="async">`);
    expect(Object.values(FACE_PX)).toEqual([24, 32, 40, 56, 96]);
  });

  it('a face that opens the card is a plain link to the card\'s page, marked for the script', () => {
    const html = faceLink({ clientId: ID, name: 'Maya' }, { size: 's', after: '<span>Maya</span>' });
    expect(html).toMatch(new RegExp(`^<a class="face-link" href="${cardHref(ID)}" data-card><span class="face face-s[^"]*"`));
    expect(html).toContain('<span>Maya</span></a>');
    expect(cardHref(ID)).toBe(`/app/customers/${ID}`);
  });

  it('the stylesheet rounds a face, lays the photo on the initial, and draws all eight tints from tokens', () => {
    const css = linkedCss(shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' }));
    expect(css).toMatch(/\.face \{[^}]*border-radius:var\(--radius-chip\)/);
    expect(css).toMatch(/\.face-p \{ position:absolute; inset:0;/);
    for (let i = 1; i <= 8; i++) expect(css).toContain(`.face.t${i} { background:var(--face-${i}-bg); color:var(--face-${i}-fg); }`);
  });
});

describe('the photo, fetched in the background from the customer\'s channel', () => {
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
  const graph = (body: unknown, status = 200): MetaFetch => async () => ({ status, text: async () => JSON.stringify(body) });
  const photo = (bytes: Buffer, o: { status?: number; type?: string; url?: string; length?: number } = {}) => {
    const seen: { url: string; init: unknown }[] = [];
    const fn: PhotoFetch = async (url, init) => {
      seen.push({ url, init });
      return { status: o.status ?? 200, url: o.url ?? url,
        headers: { get: (n: string) => (n === 'content-length' ? String(o.length ?? bytes.length) : n === 'content-type' ? (o.type ?? 'image/jpeg') : null) },
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer };
    };
    return { fn, seen };
  };
  const look = (g: MetaFetch, p: PhotoFetch) => metaProfilePhoto({ accessToken: 'TOKEN', graphVersion: 'v21.0', fetchImpl: g, photoFetch: p })('psid-1');

  it('kept: a picture from Meta\'s own addresses, its type read from its bytes; the token never goes to the photo\'s address', async () => {
    const p = photo(JPEG);
    const r = await look(graph({ profile_pic: 'https://platform-lookaside.fbsbx.com/platform/profilepic/?psid=1' }), p.fn);
    expect(r).toMatchObject({ state: 'kept', type: 'image/jpeg' });
    expect(JSON.stringify(p.seen)).not.toContain('TOKEN');
  });

  it('none: the channel answered with no photo', async () => {
    expect(await look(graph({ id: 'psid-1' }), photo(JPEG).fn)).toEqual({ state: 'none' });
  });

  it('failed, and nothing fetched or kept: an address that is not Meta\'s, a redirect away from Meta, too big, not a picture, a refusal', async () => {
    const p = photo(JPEG);
    expect(await look(graph({ profile_pic: 'https://evil.example/x.jpg' }), p.fn)).toEqual({ state: 'failed' });
    expect(await look(graph({ profile_pic: 'http://scontent.cdninstagram.com/x.jpg' }), p.fn)).toEqual({ state: 'failed' });
    expect(p.seen).toEqual([]);
    expect(await look(graph({ profile_pic: 'https://scontent.cdninstagram.com/x.jpg' }), photo(JPEG, { url: 'https://evil.example/y' }).fn)).toEqual({ state: 'failed' });
    expect(await look(graph({ profile_pic: 'https://scontent.cdninstagram.com/x.jpg' }), photo(JPEG, { length: 600_000 }).fn)).toEqual({ state: 'failed' });
    expect(await look(graph({ profile_pic: 'https://scontent.cdninstagram.com/x.jpg' }), photo(Buffer.from('<svg/>')).fn)).toEqual({ state: 'failed' });
    expect(await look(graph({ error: {} }, 400), photo(JPEG).fn)).toEqual({ state: 'failed' });
    expect(await look(async () => { throw new Error('down'); }, photo(JPEG).fn)).toEqual({ state: 'failed' });
  });

  it('a picture\'s type is what its first bytes say', () => {
    expect(photoType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(photoType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('image/gif');
    expect(photoType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp');
    expect(photoType(new Uint8Array(Buffer.from('<svg>')))).toBeNull();
  });
});

describe('phase 3 · the profile card', () => {
  const card = (over: Partial<CustomerCard> = {}): CustomerCard => ({
    clientId: ID, name: 'Maya Rahman', photo: null, channels: ['instagram'], lastWrote: new Date('2026-10-02T10:00:00Z'),
    bought: [{ name: 'Canvas tote', nameZh: '帆布袋', quantity: 200, unit: 'pcs' }], askedAbout: [],
    value: { clientId: ID, spent: { amount: 1840, currency: 'USD' }, orders: 4, lastOrderAt: new Date('2026-09-20T00:00:00Z'), regular: true, quietSince: null },
    waiting: true, conversationId: 'c0de0000-0000-4000-8000-000000000001', ...over,
  });
  const NOW = new Date('2026-10-03T08:00:00Z');

  it('in every language: the large face, the name, where and when, spent and orders, what they bought, the waiting flag, one action', () => {
    for (const l of LOCALES) {
      const html = renderCustomerCard(card(), l, NOW);
      expect(html, l).toContain('data-card-body');
      expect(html, l).toContain('<span class="face face-xl');
      expect(html, l).toContain('<h1 class="pc-name" id="pc-name"><bdi>Maya Rahman</bdi></h1>');
      expect(html, l).toContain(`<p class="pc-wait">${esc(t(l, 'inbox.filter.pending'))}</p>`);
      expect(html, l).toContain(`<p class="pc-regular">${esc(t(l, 'pcard.regular'))}</p>`);
      expect(html, l).toContain(esc(t(l, 'pcard.spent')));
      expect(html, l).toContain(esc(t(l, 'pcard.orders')));
      expect(html, l).toContain(esc(t(l, 'pcard.bought')));
      // One door, drawn as the product draws a door (a link is never a button, buttons-and-doors.test.ts).
      expect(html.match(/<a class="deeper pc-open"/g), l).toHaveLength(1);
      expect(html, l).toContain('href="/app/inbox/c0de0000-0000-4000-8000-000000000001#latest"');
    }
  });

  it('not waiting, not a regular: no flag, no mark; nothing bought: what they asked about; neither: says so', () => {
    const quiet = renderCustomerCard(card({ waiting: false, value: { ...card().value, regular: false, spent: null, orders: 0 },
      bought: [], askedAbout: [{ name: 'Apron', nameZh: null }] }), 'en', NOW);
    expect(quiet).not.toContain('pc-wait');
    expect(quiet).not.toContain('pc-regular');
    expect(quiet).toContain(t('en', 'pcard.askedAbout'));
    expect(quiet).toContain(t('en', 'pcard.nothingSpent'));
    expect(renderCustomerCard(card({ bought: [], askedAbout: [] }), 'en', NOW)).toContain(t('en', 'pcard.nothingYet'));
  });

  it('every page carries the closed sheet it springs up in; it springs only for a reader who did not ask for less motion', () => {
    for (const l of LOCALES) {
      const html = shell({ title: 'T', active: 'home', locale: l, path: '/app', bodyHtml: '' });
      expect(html, l).toContain(`<dialog class="sheet" aria-labelledby="pc-name" data-sheet><form method="dialog" class="sheet-bar"><button type="submit" class="sheet-x" aria-label="${esc(t(l, 'pcard.close'))}">×</button></form><div data-sheet-body></div></dialog>`);
    }
    const css = linkedCss(shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' }));
    const calm = css.indexOf('@media (prefers-reduced-motion: no-preference)');
    const spring = css.indexOf('dialog.sheet[open] { animation:nomi-spring var(--motion-normal) var(--motion-spring) both; }');
    expect(spring).toBeGreaterThan(calm);
    expect(css).toMatch(/\.pcard \{[^}]*border-radius:var\(--radius-panel\)/);
    // a bottom sheet on a phone: full width, at the foot, its lower corners square
    const phone = css.slice(css.indexOf('dialog.sheet { inline-size:100%'));
    expect(phone).toMatch(/^dialog\.sheet \{ inline-size:100%; max-width:100%; margin:auto 0 0; \}/);
  });
});

describe('phase 3 · the script lifts the card into the sheet, and a photo that fails leaves the initial', () => {
  /** The least of a page the two parts touch: a sheet, a face link, a photo. */
  function page(o: { answer?: () => Promise<unknown> } = {}) {
    const handlers: Record<string, ((e: unknown) => void)[]> = {};
    const body = { children: [] as unknown[], get firstChild() { return this.children[0]; },
      removeChild(c: unknown) { this.children.splice(this.children.indexOf(c), 1); }, appendChild(c: unknown) { this.children.push(c); } };
    const sheetHandlers: Record<string, ((e: unknown) => void)[]> = {};
    const sheet = {
      open: false, querySelector: (s: string) => (s === '[data-sheet-body]' ? body : null),
      showModal() { this.open = true; }, close() { this.open = false; for (const h of sheetHandlers['close'] ?? []) h({}); },
      addEventListener: (k: string, h: (e: unknown) => void) => { (sheetHandlers[k] ??= []).push(h); },
    };
    const doc = {
      visibilityState: 'visible',
      querySelector: (s: string) => (s === '[data-sheet]' ? sheet : null),
      querySelectorAll: () => [],
      addEventListener: (k: string, h: (e: unknown) => void) => { (handlers[k] ??= []).push(h); },
      adoptNode: (n: unknown) => n,
    };
    const location = { href: 'https://nomi.test/app', pathname: '/app', search: '', hash: '' };
    const asked: string[] = [];
    const win = {
      addEventListener: () => undefined, sessionStorage: undefined,
      fetch: (u: string) => { asked.push(u); return o.answer ? o.answer() : Promise.resolve({ ok: true, type: 'basic', text: async () => '<main></main>' }); },
    };
    const cardNode = { card: true };
    const context = vm.createContext({
      window: win, document: doc, location, history: { scrollRestoration: 'auto' }, URL, fetch: win.fetch,
      DOMParser: class { parseFromString() { return { querySelector: (s: string) => (s === '[data-card-body]' ? cardNode : null) }; } },
      setTimeout: () => 0, clearTimeout: () => undefined,
    });
    new vm.Script(LIVE_SCRIPT).runInContext(context);
    const click = (a: unknown) => {
      let prevented = false;
      const e = { target: { closest: (s: string) => (s === 'a[data-card]' ? a : null) }, button: 0, preventDefault: () => { prevented = true; } };
      for (const h of handlers['click'] ?? []) h(e);
      return prevented;
    };
    return { sheet, body, asked, location, click, handlers, cardNode, flush: () => new Promise<void>((r) => setImmediate(r)) };
  }

  it('a press on a face fetches the card\'s own page and opens it in the sheet; closing empties it', async () => {
    const p = page();
    const a = { href: `https://nomi.test${cardHref(ID)}`, focus: () => undefined };
    expect(p.click(a)).toBe(true);
    await p.flush(); await p.flush();
    expect(p.asked).toEqual([a.href]);
    expect(p.sheet.open).toBe(true);
    expect(p.body.children).toEqual([p.cardNode]);
    p.sheet.close();
    expect(p.body.children).toEqual([]);
  });

  it('a card that cannot be had: the face\'s link goes to the card\'s page', async () => {
    const p = page({ answer: () => Promise.resolve({ ok: false, status: 500, type: 'basic', text: async () => '' }) });
    const a = { href: `https://nomi.test${cardHref(ID)}`, focus: () => undefined };
    p.click(a);
    await p.flush(); await p.flush();
    expect(p.sheet.open).toBe(false);
    expect(p.location.href).toBe(a.href);
  });

  it('a photo that does not load is taken away, and the initial under it shows', () => {
    const p = page();
    const parent = { removed: [] as unknown[], removeChild(c: unknown) { this.removed.push(c); } };
    const img = { tagName: 'IMG', className: 'face-p', parentNode: parent };
    const other = { tagName: 'IMG', className: 'product-photo', parentNode: parent };
    for (const h of p.handlers['error'] ?? []) { h({ target: img }); h({ target: other }); }
    expect(parent.removed).toEqual([img]);
  });
});
