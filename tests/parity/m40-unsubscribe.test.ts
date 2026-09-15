import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  mintUnsubscribe, readUnsubscribe, unsubscribeHeaders, type UnsubscribeClaim,
} from '../../src/outbound/unsubscribe.js';
import { suppressionFor } from '../../src/core/outreach/events.js';
import { renderUnsubscribe, renderUnsubscribed } from '../../src/api/web/unsubscribe.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * M40.2 — the two ways a suppression arrives from outside her hands.
 *
 * Both write the same permanent row, and permanence is why both are careful in
 * the same direction: a suppression cannot be undone, so anything uncertain
 * must do nothing rather than something.
 */

const SECRET = 'a-test-session-secret-of-sufficient-length';
const claim: UnsubscribeClaim = {
  businessId: 'de300000-0000-4000-8000-0000000000b1',
  channel: 'email', identity: 'ahmed@example.com', locale: 'ar',
};

describe('M40.2 · the link at the bottom of the message', () => {
  it('carries who it is for, and comes back saying the same', () => {
    expect(readUnsubscribe(SECRET, mintUnsubscribe(SECRET, claim))).toEqual(claim);
  });

  it('CANNOT BE EDITED INTO SOMEBODY ELSE’S ADDRESS', () => {
    // The signature is the whole protection: the address is in the token,
    // encoded rather than encrypted, because the link is delivered to the inbox
    // of the person it names. What must be impossible is the other direction.
    const token = mintUnsubscribe(SECRET, claim);
    const [payload, mac] = token.split('.') as [string, string];
    const other = Buffer.from(JSON.stringify([
      claim.businessId, 'email', 'someone-else@example.com', 'en',
    ])).toString('base64url');
    expect(readUnsubscribe(SECRET, `${other}.${mac}`)).toBeNull();
    expect(readUnsubscribe(SECRET, `${payload}.${'A'.repeat(mac.length)}`)).toBeNull();
    expect(readUnsubscribe('a-different-secret-of-sufficient-length', token)).toBeNull();
  });

  it('NULL IS THE ONLY FAILURE — every bad token answers the same way', () => {
    // A token that told a visitor WHICH part was wrong would be a way to probe
    // for valid ones.
    for (const bad of ['', '.', 'nodot', 'a.b', `${'x'.repeat(80)}.y`,
      `${Buffer.from('not json').toString('base64url')}.y`,
      `${Buffer.from(JSON.stringify(['b', 'carrier-pigeon', 'a@b.c', 'en'])).toString('base64url')}.y`]) {
      expect(readUnsubscribe(SECRET, bad), bad).toBeNull();
    }
  });

  it('a channel or language we do not have is refused, not coerced', () => {
    /**
     * PROPERLY SIGNED, so the signature check cannot be what rejects it. The
     * first version of this test signed with a junk mac and passed for the
     * wrong reason — a mutation that deleted the channel check survived it.
     * Anything reaching here has a valid signature by definition; what is being
     * asserted is that a valid signature over nonsense is still nonsense.
     */
    const { createHmac } = require('node:crypto') as typeof import('node:crypto');
    const sign = (payload: string) =>
      createHmac('sha256', SECRET).update(`unsubscribe:${payload}`).digest('base64url');
    for (const body of [
      [claim.businessId, 'carrier_pigeon', 'a@b.c', 'en'],
      [claim.businessId, 'email', 'a@b.c', 'fr'],
      [claim.businessId, 'email', '', 'en'],
      ['', 'email', 'a@b.c', 'en'],
      [claim.businessId, 'email', 'a@b.c'],
    ]) {
      const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
      expect(readUnsubscribe(SECRET, `${payload}.${sign(payload)}`), JSON.stringify(body)).toBeNull();
    }
  });

  it('THE ACTION IS A POST — a GET would empty her list on delivery', async () => {
    // Mail providers, link scanners and security proxies fetch every URL in a
    // message before a human sees it.
    expect(unsubscribeHeaders('https://x/u/t')['List-Unsubscribe-Post'])
      .toBe('List-Unsubscribe=One-Click');
    const app = await readFile(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    const get = app.slice(app.indexOf("app.get('/u'"), app.indexOf("app.post('/u'"));
    expect(get).not.toContain('applyUnsubscribe');
    expect(app.slice(app.indexOf("app.post('/u'"))).toContain('applyUnsubscribe');
  });

  it('THE LINK SURVIVES A ROUTER THAT CAPS PATH SEGMENTS', () => {
    // Fastify caps a path parameter at 100 characters and these are longer.
    // Raising that cap is a server option every app-builder would have to
    // remember, and forgetting it turns every link into a 414 in production
    // while the tests that set it stay green.
    expect(mintUnsubscribe(SECRET, claim).length).toBeGreaterThan(100);
    expect(renderUnsubscribe(claim, mintUnsubscribe(SECRET, claim)))
      .toContain('action="/u?t=');
  });

  it('the page names nobody — not the factory, not what he was sent', () => {
    const html = renderUnsubscribe(claim, mintUnsubscribe(SECRET, claim));
    expect(html).not.toContain(claim.businessId);
    expect(html).not.toContain(claim.identity);
    expect(html).toContain('noindex');
    // and it is in HIS language, carried in the token because nothing else knows
    expect(html).toContain(t('ar', 'unsub.button'));
    expect(html).toContain('dir="rtl"');
  });

  it('it renders with no script, no stylesheet and no font to fetch', () => {
    const html = renderUnsubscribe(claim, 'tok') + renderUnsubscribed('en');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('@import');
  });

  it('every string exists in all three locales', () => {
    const KEYS: MessageKey[] = ['unsub.title', 'unsub.body', 'unsub.button',
      'unsub.done.title', 'unsub.done.body'];
    for (const locale of LOCALES) {
      for (const k of KEYS) {
        expect(t(locale, k).length, `${locale} ${k}`).toBeGreaterThan(1);
      }
      const html = renderUnsubscribed(locale);
      expect(html).toContain(t(locale, 'unsub.done.body'));
    }
  });
});

describe('M40.2 · what the provider says happened', () => {
  const ev = (over: Partial<Parameters<typeof suppressionFor>[0]> = {}) =>
    suppressionFor({ type: 'bounce', recipient: 'a@b.c', ...over });

  it('a complaint and an unsubscribe are permanent', () => {
    for (const type of ['complaint', 'spam_complaint', 'Complained']) {
      expect(ev({ type }), type).toBe('complained');
    }
    for (const type of ['unsubscribe', 'list_unsubscribe', 'Unsubscribed']) {
      expect(ev({ type }), type).toBe('unsubscribed');
    }
  });

  it('A SOFT BOUNCE IS NOT A SUPPRESSION — a full mailbox is not a dead one', () => {
    // Suppressing on one would permanently remove a real buyer because his
    // inbox was full on a Tuesday, and permanent is the whole point.
    expect(ev({ type: 'bounce', permanent: false })).toBeNull();
    expect(ev({ type: 'bounce' })).toBeNull();          // unclassified is soft
    expect(ev({ type: 'bounce', permanent: true })).toBe('bounced');
    expect(ev({ type: 'hard_bounce' })).toBe('bounced');
  });

  it('AND A NAMESPACED BOUNCE IS NOT CAUGHT BY PATTERN-MATCHING "bounce"', () => {
    /**
     * The list is a list rather than /bounce/. A provider that namespaces its
     * events — `delivery.bounce.soft`, `bounce_notification` — and flags the
     * envelope permanent would be read by a pattern as a hard bounce and
     * suppress a live buyer forever. An unrecognised name does nothing, which
     * is the only safe answer for an action with no undo.
     */
    for (const type of ['bounce.transient', 'delivery.bounce.soft', 'bounce_notification']) {
      expect(ev({ type, permanent: true }), type).toBeNull();
      expect(ev({ type, permanent: false }), type).toBeNull();
    }
    expect(ev({ type: 'soft_bounce' })).toBeNull();
  });

  it('ANYTHING UNRECOGNISED DOES NOTHING — it is not guessed into a reason', () => {
    for (const type of ['delivered', 'opened', 'clicked', 'deferred', 'quarantined', '']) {
      expect(ev({ type }), type).toBeNull();
    }
  });

  it('the mapper knows nothing about any provider’s JSON', async () => {
    // One place translates. A second would drift, and its drift would be
    // permanent rows nobody asked for.
    const src = await readFile(new URL('../../src/core/outreach/events.ts', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    expect(code).not.toMatch(/fetch|http|axios|JSON\.parse/);
  });
});

describe('M40.2 · the webhook', () => {
  it('IS NOT MOUNTED WITHOUT A SECRET — an open endpoint writes permanent rows', async () => {
    const app = await readFile(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    // G14 — it lives in a scope of its own now, so the signature can be taken
    // over the bytes the provider sent without changing any other route.
    // C4.c — exact route, with the comma: '/hooks/email/inbound' now shares the
    // prefix, and a prefix search found the reply route first.
    const at = app.indexOf("scope.post('/hooks/email', ");
    expect(at).toBeGreaterThan(-1);
    expect(app.slice(0, at)).toContain('if (deps.emailWebhookSecret) {');
    const body = app.slice(at, at + 2600);
    // The constant-time check is ONE helper both e-mail routes call (C4.c), so
    // the route must call it and the helper must be the timing-safe one.
    expect(body).toContain('signedBody(req)');
    const scope = app.slice(app.indexOf('void app.register(async (scope) => {'), at);
    expect(scope).toMatch(/const signedBody = [\s\S]*timingSafeEqual/);
    expect(body).toContain('reply.code(404).send()');
  });

  it('G14 · the signature is taken over the RAW body, and parsed only after it passes', async () => {
    const app = await readFile(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    const at = app.indexOf('void app.register(async (scope) => {');
    const body = app.slice(at, app.indexOf("app.get('/u'"));
    expect(body).toContain("scope.addContentTypeParser('application/json', { parseAs: 'string' }");
    expect(body).toContain('.update(rawBody)');
    // Parse AFTER the check: unverified bytes are never handed to JSON.parse
    // as if they were ours.
    expect(body.indexOf('timingSafeEqual')).toBeLessThan(body.indexOf('JSON.parse(rawBody)'));
  });

  it('reads the tenant from the signed token, never from the request', async () => {
    const app = await readFile(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    const body = app.slice(app.indexOf("scope.post('/hooks/email', "), app.indexOf("app.get('/u'"));
    expect(body).toContain('claimFrom(deps.sessionSecret, e.tag)');
    expect(body).not.toMatch(/businessId.*req\.(params|query|body)/);
  });
});
