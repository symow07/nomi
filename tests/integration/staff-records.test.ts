import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * D17 (the data-protection audit, 2026-10-12; 0146) — WHAT IS ARCHIVED STOPS
 * HOLDING WHO SOMEONE WAS, OR A WAY IN.
 *
 * A team member with an access code, a login, a device and an alert channel is
 * removed through the app's own function: their name stays; the code, when they
 * were last seen, the channel go; their login and device are archived with them
 * and keep nothing that identifies them or opens anything (an unfinished
 * sign-up of their address goes too). A mailbox disconnected keeps no token.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `d1700000-0000-4000-8000-${RUN}0001`;
const EMAIL = `wen.${RUN}@team.test`;

d('D17 · archived rows keep nothing of the person (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  const ids = { person: '', login: '', device: '', mailbox: '', signup: '' };
  const one = async (q: string, p: unknown[]) => (await admin.query(q, p)).rows[0];

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    await admin.query(`insert into businesses (id, name, owner_locale) values ($1, $2, 'en')`, [BIZ, `Staff Records ${RUN}`]);
    ids.person = (await one(`insert into people (business_id, name, is_owner, code_hash, last_seen_at, alert_channel)
                             values ($1, 'Wen', false, $2, now(), 'browser') returning id::text as id`, [BIZ, `codehash-${RUN}`])).id;
    ids.login = (await one(`insert into logins (business_id, person_id, email, password_hash) values ($1, $2, $3, 'scrypt$16384$8$1$c2FsdA$aGFzaA')
                            returning id::text as id`, [BIZ, ids.person, EMAIL])).id;
    ids.device = (await one(`insert into push_subscriptions (business_id, person_id, endpoint, p256dh, auth, device)
                             values ($1, $2, $3, $4, $5, 'Phone') returning id::text as id`,
      [BIZ, ids.person, `https://push.example.test/${RUN}`, 'B'.repeat(87), 'a'.repeat(22)])).id;
    ids.mailbox = (await one(`insert into mail_accounts (business_id, provider, address, refresh_token_ciphertext, fingerprint, scopes, connected_by)
                              values ($1, 'google', $2, 'v1.sealed-token', '0123456789ab', '{}', 'owner') returning id::text as id`,
      [BIZ, `sales.${RUN}@shop.test`])).id;
    ids.signup = (await one(`insert into login_codes (email, purpose, code_hash, expires_at, payload)
                             values ($1, 'signup', 'x', now() + interval '10 minutes', '{"name":"Wen"}'::jsonb) returning id::text as id`, [EMAIL])).id;
  }, 60_000);

  afterAll(async () => { await db?.destroy(); await admin?.end(); });

  it('removed through the app: the name stays; the code, last seen and channel go; login and device are archived empty', async () => {
    const { removePerson } = await import('../../src/api/web/people.js');
    expect(await removePerson(db, BIZ, ids.person)).toEqual({ code: 'removed' });
    expect(await one('select name, code_hash, last_seen_at, alert_channel from people where id = $1', [ids.person]))
      .toEqual({ name: 'Wen', code_hash: null, last_seen_at: null, alert_channel: null });
    const login = await one('select archived_at, email, password_hash from logins where id = $1', [ids.login]);
    expect(login.archived_at).not.toBeNull();
    expect(login.email).toBe(`erased.${ids.login}@login.invalid`);
    expect(login.password_hash).toBe('scrypt$erased');
    const device = await one('select archived_at, endpoint, p256dh, auth, device from push_subscriptions where id = $1', [ids.device]);
    expect(device.archived_at).not.toBeNull();
    expect(device.endpoint).toBe(`https://erased.invalid/${ids.device}`);
    expect(device.device).toBeNull();
    expect(device.p256dh).not.toContain('B');
    expect(await one('select email, payload from login_codes where id = $1', [ids.signup])).toEqual({ email: '', payload: null });
    for (const t of ['logins', 'push_subscriptions', 'people', 'login_codes']) {
      expect((await admin.query(`select 1 from ${t} x where x::text like $1`, [`%${EMAIL}%`])).rowCount, t).toBe(0);
    }
  });

  it('a mailbox disconnected keeps no token', async () => {
    await admin.query(`update mail_accounts set archived_at = now(), archived_by = 'owner' where id = $1`, [ids.mailbox]);
    expect((await one('select refresh_token_ciphertext from mail_accounts where id = $1', [ids.mailbox])).refresh_token_ciphertext).toBe('v1.erased');
  });
});
