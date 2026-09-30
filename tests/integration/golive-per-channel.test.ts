import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';

/**
 * Going live, per channel (2026-09-27).
 *
 * Activation is WhatsApp's alone: the send gate reads a `channels` row only for
 * WhatsApp and treats Instagram, Messenger and e-mail as live once connected
 * (db/channels.ts, C4.a). My business said otherwise in two ways:
 *   - a business that never uses WhatsApp read "Connect WhatsApp." as the thing
 *     standing between its assistant and a real buyer, while replies it approved
 *     were already going out on Instagram;
 *   - "Stop messaging" said nothing further is sent, and stopped WhatsApp only.
 * Display only — this file also runs the page for a WhatsApp business to show
 * its switch is where it was.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const IG_BIZ = `dd5c0000-0000-4000-8000-${RUN}0001`;     // Instagram only, never WhatsApp
const NONE_BIZ = `dd5c0000-0000-4000-8000-${RUN}0002`;   // nothing connected, WhatsApp not among its channels
const BOTH_BIZ = `dd5c0000-0000-4000-8000-${RUN}0003`;   // WhatsApp started, Instagram connected
const WANT_BIZ = `dd5c0000-0000-4000-8000-${RUN}0004`;   // said WhatsApp at sign-up, not connected yet
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const digits = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`.slice(0, 18);

d('Going live, per channel (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let esc: typeof import('../../src/api/web/layout.js')['esc'];
  const apps: import('fastify').FastifyInstance[] = [];

  const tx = async <R>(biz: string, fn: (x: import('../../src/db/client.js').Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const open = async (biz: string, o: Record<string, unknown>) => {
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const app = Fastify({ logger: false });
    const code = `gl-${biz.slice(-4)}-${RUN}`;
    registerWebApp(app, {
      db, businessId: biz, accessCode: code, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', secureCookie: false,
      kickOutbound: async () => {}, kickDrive: async () => {}, factsTtlMs: 0,
      ...o,
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    apps.push(app);
    const cookie = String((await app.inject({
      method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`, headers: FORM,
    })).headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
    const page = async () => (await app.inject({ method: 'GET', url: '/app/business', headers: { cookie } })).body;
    return { app, cookie, page };
  };
  const connectInstagram = (biz: string) => tx(biz, (x) => sql`
    insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine, is_active)
    values (${biz}, 'instagram', ${digits()}, 'gl-secret', 'service', true)`.execute(x));
  const noChannel = () => esc(t('en', 'activation.blocker.no_channel', { name: 'your assistant' }));

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    ({ esc } = await import('../../src/api/web/layout.js'));
    db = createDb(DATABASE_URL!);
    for (const [biz, used] of [[IG_BIZ, '{instagram}'], [NONE_BIZ, '{instagram}'], [BOTH_BIZ, '{whatsapp,instagram}'], [WANT_BIZ, '{whatsapp}']] as const) {
      await tx(biz, (x) => sql`insert into businesses (id, name, owner_locale, channels_used)
                               values (${biz}, ${`Go-live ${biz.slice(-4)}`}, 'en', ${used}::text[])
                               on conflict (id) do nothing`.execute(x));
    }
    await connectInstagram(IG_BIZ);
    await connectInstagram(BOTH_BIZ);
    await tx(BOTH_BIZ, async (x) => {
      await sql`insert into channels (business_id, kind, status, pilot_mode, activated_at)
                values (${BOTH_BIZ}, 'whatsapp', 'connected', true, now())`.execute(x);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine, is_active)
                values (${BOTH_BIZ}, 'whatsapp', ${digits()}, 'gl-wa-secret', 'service', true)`.execute(x);
    });
  }, 60_000);

  afterAll(async () => { for (const a of apps) await a.close(); await db?.destroy(); });

  it('INSTAGRAM ONLY: never told to connect WhatsApp; told it is answering now, and how to stop it', async () => {
    const { page } = await open(IG_BIZ, { provider: 'disabled', messagingEnabled: false, instagramAccountId: digits() });
    const html = await page();
    expect(html).toContain('data-golive="elsewhere"');
    expect(html).not.toContain('data-golive="whatsapp"');
    expect(html).not.toContain(noChannel());
    expect(html).not.toContain('action="/app/business/activate"');
    expect(html).toContain(esc(t('en', 'golive.other.live', { channels: 'Instagram', name: 'your assistant' })));
    // the two ways those replies are stopped, each a real door
    expect(html).toMatch(/href="\/app\/employee"[^>]*>[\s\S]*?Make every reply wait for you/);
    expect(html).toMatch(/href="\/app\/channels"[^>]*>[\s\S]*?Disconnect the channel/);
  });

  it('NOTHING CONNECTED and WhatsApp not among its channels: a neutral next step, no WhatsApp blocker', async () => {
    const { page } = await open(NONE_BIZ, { provider: 'disabled', messagingEnabled: false });
    const html = await page();
    expect(html).toContain('data-golive="none"');
    expect(html).toContain(esc(t('en', 'golive.none', { name: 'your assistant' })));
    expect(html).not.toContain(noChannel());
    expect(html).not.toContain('data-golive="elsewhere"');
  });

  it('SAID WHATSAPP AT SIGN-UP: the WhatsApp switch is where it was, blocker and all', async () => {
    const { page } = await open(WANT_BIZ, { provider: 'meta', messagingEnabled: true, connectableNumber: digits() });
    const html = await page();
    expect(html).toContain('data-golive="whatsapp"');
    expect(html).toContain(noChannel());
    expect(html).toContain(esc(t('en', 'activation.cannot', { name: 'your assistant' })));
  });

  it('WHATSAPP STARTED, INSTAGRAM CONNECTED: Stop names WhatsApp, and says Instagram keeps answering', async () => {
    const { page } = await open(BOTH_BIZ, { provider: 'meta', messagingEnabled: true, connectableNumber: digits(), instagramAccountId: digits() });
    const html = await page();
    expect(html).toContain('data-golive="whatsapp"');
    expect(html).toContain('action="/app/business/deactivate"');
    expect(html).toContain(`>${esc(t('en', 'activation.action.deactivate'))}<`);
    expect(t('en', 'activation.action.deactivate')).toContain('WhatsApp');
    expect(html).toContain(esc(t('en', 'activation.stop.what')));
    expect(t('en', 'activation.stop.what')).toContain('on WhatsApp');
    expect(html).toContain(esc(t('en', 'golive.whatsappOnly', { channels: 'Instagram' })));
    expect(html).toContain('data-golive="elsewhere"');
  });

  it('every locale names what Stop stops, and has every line this page uses', () => {
    for (const l of ['en', 'zh', 'ar'] as const) {
      for (const k of ['activation.action.deactivate', 'activation.action.deactivateConfirm',
        'activation.stop.what', 'activation.flash.deactivated'] as const) {
        expect(t(l, k, { name: 'X' }), `${l} ${k}`).toMatch(/WhatsApp|واتساب/);
      }
      for (const k of ['golive.other.live', 'golive.other.stopHow',
        'golive.other.stopDrafts', 'golive.other.stopDisconnect', 'golive.whatsappOnly', 'golive.none'] as const) {
        expect(t(l, k, { name: 'X', channels: 'Y' }), `${l} ${k}`).not.toBe('');
      }
    }
  });
});
