import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * 0164 — a mailbox is connected to one workspace at a time (the isolation sweep's item 12). Over Postgres, through
 * the real last step of "Connect Gmail" (`completeMailConnection`; only Google's token endpoint faked):
 *
 *   · a mailbox live in one workspace is refused in another — whatever its letters' case — and the refusal changes
 *     nothing on either side;
 *   · the workspace that has it reconnects it as before (archive, then insert);
 *   · disconnected there, it connects in the other.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const A = `ab120000-0000-4000-8000-${RUN}0001`;
const B = `ab120000-0000-4000-8000-${RUN}0002`;
const GOOGLE = { clientId: 'google-client.apps.googleusercontent.com', clientSecret: 'g-secret' };
const ADDRESS = `sales.${RUN}@shared.example`;

const jwt = (claims: Record<string, unknown>): string =>
  `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

d('0164 · a mailbox is connected to one workspace at a time (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 60_000 }, () => {
  let admin: pg.Client;
  let db: import('../../src/db/client.js').Db;

  /** Google answers the code with a token for `email`. */
  const connect = async (businessId: string, email: string) => {
    const { completeMailConnection } = await import('../../src/channels/email/connectMailbox.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(businessId); if (!b.ok) throw new Error('fixture');
    const now = Date.now();
    return completeMailConnection({
      db, credentialKey: Buffer.alloc(32, 7), clients: { google: GOOGLE }, now: () => new Date(now),
      fetchImpl: async () => ({ status: 200, text: async () => JSON.stringify({
        access_token: 'at', refresh_token: `rt-${randomUUID()}`, expires_in: 3599,
        id_token: jwt({ iss: 'https://accounts.google.com', aud: GOOGLE.clientId, exp: now / 1000 + 3600, email, email_verified: true }),
        scope: 'openid https://www.googleapis.com/auth/gmail.send email',
      }) }),
    }, { businessId: b.value, provider: 'google', code: 'c', verifier: 'v', redirectUri: 'https://x.test/cb', by: 'owner' });
  };
  const live = async () => (await admin.query(
    `select business_id::text as business_id, address from mail_accounts
      where business_id = any($1::uuid[]) and archived_at is null order by business_id`, [[A, B]])).rows;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    for (const [id, name] of [[A, `Mail A ${RUN}`], [B, `Mail B ${RUN}`]]) {
      await admin.query(`insert into businesses (id, name, engine) values ($1, $2, 'service')`, [id, name]);
    }
  });
  afterAll(async () => { await admin?.end(); await db?.destroy(); });

  it('live in one workspace, refused in another — any case — and nothing changes on either side', async () => {
    expect(await connect(A, ADDRESS)).toEqual({ outcome: 'connected', address: ADDRESS });
    expect(await connect(B, ADDRESS.toUpperCase())).toMatchObject({ outcome: 'address_taken' });
    expect(await live()).toEqual([{ business_id: A, address: ADDRESS }]);
    // B's own mailbox, if it had one, stays: the refusal rolls the whole connect back.
    expect(await connect(B, `own.${RUN}@b.example`)).toMatchObject({ outcome: 'connected' });
    expect(await connect(B, ADDRESS)).toMatchObject({ outcome: 'address_taken' });
    expect(await live()).toEqual([{ business_id: A, address: ADDRESS }, { business_id: B, address: `own.${RUN}@b.example` }]);
  });

  it('the workspace that has it reconnects it as before; disconnected there, it connects in the other', async () => {
    expect(await connect(A, ADDRESS)).toMatchObject({ outcome: 'connected' });
    const { disconnectMailbox } = await import('../../src/channels/email/connectMailbox.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const a = parseBusinessId(A); if (!a.ok) throw new Error('fixture');
    expect(await disconnectMailbox(db, { businessId: a.value, by: 'owner' })).toBe(true);
    expect(await connect(B, ADDRESS)).toMatchObject({ outcome: 'connected' });
    expect(await live()).toEqual([{ business_id: B, address: ADDRESS }]);
  });
});
