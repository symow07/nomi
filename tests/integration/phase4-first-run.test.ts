import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { flashSaid } from './tenant.js';

/**
 * Phase 4b — first-run without WhatsApp (audit A4 / CC-11, CC-15, F2, F4).
 *
 * A business that sells on Instagram, Messenger or e-mail could not finish
 * setting up: the channels step, Getting ready's item and My business all
 * asked about WhatsApp alone, and a refusal on an Instagram thread said
 * "WhatsApp is not connected". Production's one live business runs on
 * Instagram and Messenger. Proven here over Postgres and the owner's own
 * routes, with a WhatsApp business beside it to show nothing was lost there.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const IG_BIZ = `dd4b0000-0000-4000-8000-${RUN}0001`;
const WA_BIZ = `dd4b0000-0000-4000-8000-${RUN}0002`;
const MAIL_BIZ = `dd4b0000-0000-4000-8000-${RUN}0003`;
const CLIENT = `dd4b0000-0000-4000-8000-${RUN}00c1`;
const CONV = `dd4b0000-0000-4000-8000-${RUN}00d1`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
// Meta ids are digits; unique per run so a second run never finds them taken.
const digits = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`.slice(0, 18);
const IG_ACCOUNT = digits();
const PAGE_ID = `${digits().slice(0, 16)}7`;
const WA_NUMBER_ID = `${digits().slice(0, 16)}3`;

d('Phase 4b · first run without WhatsApp (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let esc: typeof import('../../src/api/web/layout.js')['esc'];
  let ig: import('fastify').FastifyInstance;
  let wa: import('fastify').FastifyInstance;
  let igOwner = '';
  let igStaff = '';
  let waOwner = '';

  const bidOf = async (raw: string) => {
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(raw); if (!b.ok) throw new Error('fixture'); return b.value;
  };
  const tx = async <R>(biz: string, fn: (x: import('../../src/db/client.js').Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(db, await bidOf(biz), fn);
  };
  const progress = async (biz: string) => {
    const { setupProgress } = await import('../../src/db/setup.js');
    return tx(biz, async (x) => setupProgress(x, await bidOf(biz)));
  };
  const channelsStep = async (biz: string) =>
    (await progress(biz)).steps.find((s) => s.step === 'channels')!.done;

  const build = async (biz: string, code: string, o: Record<string, unknown>) => {
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: biz, accessCode: code, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼',
      secureCookie: false, kickOutbound: async () => {}, kickDrive: async () => {},
      // The setup count is cached a minute in production; asked at once here.
      factsTtlMs: 0,
      ...o,
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    return app;
  };
  const login = async (app: import('fastify').FastifyInstance, code: string) => String((await app.inject({
    method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`, headers: FORM,
  })).headers['set-cookie'] ?? '').split(';')[0] ?? '';
  const get = (app: import('fastify').FastifyInstance, cookie: string, url: string) =>
    app.inject({ method: 'GET', url, headers: { cookie } });
  const post = (app: import('fastify').FastifyInstance, cookie: string, url: string, fields: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, headers: { cookie, ...FORM }, payload: new URLSearchParams(fields).toString() });
  /** The Getting ready row for the channel item, done or not. */
  const channelRow = (html: string, done: boolean) =>
    html.includes(`<div class="pr ${done ? 'done' : 'todo'}"><span class="mk">${done ? '✓' : '○'}</span> <span class="lbl">${esc(t('en', 'pilot.item.channel'))}</span>`);

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    ({ esc } = await import('../../src/api/web/layout.js'));
    db = createDb(DATABASE_URL!);
    for (const [biz, name, country] of [[IG_BIZ, 'Atlas Agency', 'MA'], [WA_BIZ, 'Yiwu Cups', 'CN'], [MAIL_BIZ, 'Mailbox Only', null]] as const) {
      await tx(biz, (x) => sql`insert into businesses (id, name, owner_locale, country) values (${biz}, ${name}, 'en', ${country})
                               on conflict (id) do nothing`.execute(x));
    }
    await tx(IG_BIZ, async (x) => {
      await sql`insert into clients (id, business_id, display_name) values (${CLIENT}, ${IG_BIZ}, 'Instagram Buyer') on conflict (id) do nothing`.execute(x);
      await sql`insert into conversations (id, business_id, client_id, channel) values (${CONV}, ${IG_BIZ}, ${CLIENT}, 'instagram') on conflict (id) do nothing`.execute(x);
    });

    // An installation that offers Instagram and Messenger and has no WhatsApp
    // provider — the shape of a business that never uses WhatsApp.
    ig = await build(IG_BIZ, `p4-ig-${RUN}`, {
      provider: 'disabled', messagingEnabled: false,
      instagramAccountId: IG_ACCOUNT, messengerPageId: PAGE_ID,
    });
    igOwner = await login(ig, `p4-ig-${RUN}`);
    const person = await addPerson(db, IG_BIZ, SECRET, 'Mei');
    igStaff = await login(ig, (person as { accessCode: string }).accessCode);
    // A WhatsApp installation with its number configured.
    wa = await build(WA_BIZ, `p4-wa-${RUN}`, {
      provider: 'meta', messagingEnabled: true, connectableNumber: WA_NUMBER_ID,
    });
    waOwner = await login(wa, `p4-wa-${RUN}`);
    expect(igOwner).not.toBe(''); expect(igStaff).not.toBe(''); expect(waOwner).not.toBe('');
  }, 60_000);

  afterAll(async () => { await ig?.close(); await wa?.close(); await db?.destroy(); });

  it('before anything is connected, the step is open everywhere it is shown', async () => {
    expect(await channelsStep(IG_BIZ)).toBe(false);
    const today = await get(ig, igOwner, '/app');
    expect(today.body).toContain(esc(t('en', 'nav.setup.progress', { done: 0, total: 5 })));
    expect(channelRow((await get(ig, igOwner, '/app/onboarding')).body, false)).toBe(true);
  });

  it('INSTAGRAM ALONE completes the channels step: setup progress, Getting ready, and the Today count', async () => {
    const r = await post(ig, igOwner, '/app/channels/instagram/connect');
    expect(flashSaid(r, SECRET)).toBe(t('en', 'reach.inbound.flash.connected'));
    expect(await channelsStep(IG_BIZ)).toBe(true);
    // the same answer on every surface that states it
    expect(channelRow((await get(ig, igOwner, '/app/onboarding')).body, true)).toBe(true);
    const today = await get(ig, igOwner, '/app');
    expect(today.body).toContain(esc(t('en', 'nav.setup.progress', { done: 1, total: 5 })));
    expect(today.body).not.toContain(esc(t('en', 'nav.setup.progress', { done: 0, total: 5 })));
    // and Setup's one definition agrees with the Channels page's
    const { metaLinkStatus } = await import('../../src/api/web/metaChannels.js');
    expect((await metaLinkStatus(db, IG_BIZ)).instagram).toBe(true);
  });

  it('My business shows the channel she uses, and no WhatsApp list of who may be messaged', async () => {
    const html = (await get(ig, igOwner, '/app/factory')).body;
    expect(html).toContain(esc(t('en', 'reach.channel.instagram')));
    expect(html).toContain('answers buyers who write here');             // reach.inbound.connected
    expect(html).toContain('<div class="fconn on">');
    // Messenger is offered here, not yet connected, and is a door to connect it
    expect(html).toContain(esc(t('en', 'reach.channel.messenger')));
    expect(html).toContain('cannot answer buyers who write here until it is connected');
    // the list of who may be messaged is WhatsApp's alone
    expect(html).not.toContain('action="/app/factory/allowlist/add"');
    expect(html).not.toContain('Add your own number first');
    // WhatsApp is still listed — the Channels page shows it too — but it does
    // not claim nobody can be answered while Instagram is answering.
    expect(html).toContain('>WhatsApp<');
    expect(html).not.toContain('cannot receive or answer a buyer');
  });

  it('messenger connected too: still one step, and both read as connected', async () => {
    await post(ig, igOwner, '/app/channels/messenger/connect');
    expect(await channelsStep(IG_BIZ)).toBe(true);
    expect((await progress(IG_BIZ)).done).toBe(1);
    const html = (await get(ig, igOwner, '/app/factory')).body;
    expect(html.split(`<div class="fconn on">`).length - 1).toBe(2);
  });

  it('a refusal on an Instagram thread does not say WhatsApp (the decision itself is unchanged)', async () => {
    const r = await post(ig, igOwner, `/app/inbox/${CONV}/reply`, { text: 'Hello from the owner' });
    expect(r.statusCode).toBe(302);
    const said = flashSaid(r, SECRET);
    expect(said).toBe(t('en', 'inbox.blocked.not_connected'));
    expect(said).not.toMatch(/whatsapp/i);
    for (const l of ['zh', 'ar'] as const) {
      expect(flashSaid(r, SECRET, l)).not.toMatch(/whatsapp|واتساب/i);
    }
  });

  it('the phone example comes from her country, never a Chinese number for everybody', async () => {
    // Atlas is in Morocco: the Channels page's alert number shows +212
    const html = (await get(ig, igOwner, '/app/channels')).body;
    expect(html).toContain('placeholder="+212 …"');
    expect(html).not.toContain('+8613800000000');
  });

  it('the machine room is its own page, owner-only; Getting ready no longer shows "App secret"', async () => {
    const ready = (await get(ig, igOwner, '/app/onboarding')).body;
    expect(ready).not.toContain(t('en', 'meta.cred.appSecret'));
    expect(ready).not.toContain(t('en', 'meta.cred.verifyToken'));
    expect(ready).not.toContain(esc(t('en', 'runbook.deploy.title')));
    expect(ready).toContain('href="/app/onboarding/technical"');

    const tech = await get(ig, igOwner, '/app/onboarding/technical');
    expect(tech.statusCode).toBe(200);
    expect(tech.body).toContain(t('en', 'meta.cred.appSecret'));
    expect(tech.body).toContain(esc(t('en', 'runbook.deploy.title')));
    expect(tech.body).toContain(esc(t('en', 'pilot.technical.title')));

    // staff are sent back with the owner-only sentence, and see nothing of it
    const staff = await get(ig, igStaff, '/app/onboarding/technical');
    expect(staff.statusCode).toBe(302);
    expect(staff.headers['location']).toBe('/app/onboarding');
    expect(flashSaid(staff, SECRET)).toBe(t('en', 'staff.notAllowed'));
    expect(staff.body).not.toContain(t('en', 'meta.cred.appSecret'));

    const anon = await ig.inject({ method: 'GET', url: '/app/onboarding/technical' });
    expect(anon.statusCode).toBe(302);
    expect(anon.headers['location']).toBe('/login');
  });

  it('a WhatsApp business still sees its list of who may be messaged, and completes the step', async () => {
    expect(await channelsStep(WA_BIZ)).toBe(false);
    const before = (await get(wa, waOwner, '/app/factory')).body;
    expect(before).not.toContain('action="/app/factory/allowlist/add"');   // nothing connected yet

    const r = await post(wa, waOwner, '/app/channels/whatsapp/connect');
    expect(flashSaid(r, SECRET)).not.toBe('');
    expect(await channelsStep(WA_BIZ)).toBe(true);
    expect(channelRow((await get(wa, waOwner, '/app/onboarding')).body, true)).toBe(true);

    const html = (await get(wa, waOwner, '/app/factory')).body;
    expect(html).toContain('action="/app/factory/allowlist/add"');
    expect(html).toContain('Add your own number first');
    // Yiwu is in China, so here +86 is the right example
    expect(html).toContain('placeholder="+86 …"');
  });

  it('a mailbox alone completes the step, and the shared answer matches the live mailbox', async () => {
    const { connectMailAccount, liveMailAccount, markMailAccountNeedsAttention } = await import('../../src/db/mailAccounts.js');
    const { connectedChannels } = await import('../../src/db/connectedChannels.js');
    const bid = await bidOf(MAIL_BIZ);
    expect(await channelsStep(MAIL_BIZ)).toBe(false);
    await tx(MAIL_BIZ, (x) => connectMailAccount(x, bid, {
      provider: 'google', address: `sales-${RUN}@mailbox.test`, ciphertext: 'v1.locked-for-the-test', fingerprint: `${RUN}0000`.replace(/[^0-9a-f]/g, '0'),
      scopes: 'openid email', by: 'owner',
    }));
    const agree = async () => tx(MAIL_BIZ, async (x) => {
      const live = await liveMailAccount(x, bid);
      const c = await connectedChannels(x, bid);
      expect(c.email).toBe(live !== null && live.needsAttention === null);
      return c.email;
    });
    expect(await agree()).toBe(true);
    expect(await channelsStep(MAIL_BIZ)).toBe(true);

    const { loadFactory, renderFactory } = await import('../../src/api/web/factory.js');
    const page = renderFactory(await loadFactory(db, MAIL_BIZ, false), 'en');
    expect(page).toContain(esc(t('en', 'reach.channel.email')));
    expect(page).toContain(`<bdi>sales-${RUN}@mailbox.test</bdi>`);
    expect(page).not.toContain('action="/app/factory/allowlist/add"');
    // No country given: a neutral sentence, not somebody else's number
    const { phonePlaceholder } = await import('../../src/api/web/channels.js');
    expect(phonePlaceholder('en', null)).toBe(t('en', 'settings.alerts.placeholder'));

    // A mailbox the provider refused is not connected, on either side
    await tx(MAIL_BIZ, async (x) => {
      const live = await liveMailAccount(x, bid);
      await markMailAccountNeedsAttention(x, live!.id, 'revoked');
    });
    expect(await agree()).toBe(false);
    expect(await channelsStep(MAIL_BIZ)).toBe(false);
  });
});
