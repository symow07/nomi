import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { purgeBusinesses } from './books-db.js';
import { odooFake } from '../books-connectors/odoo-fake.js';

/**
 * Audit batch 5 (2026-10-31, polish) — A GRANT THAT NO LONGER OPENS IS SAID. A connection whose stored grant cannot
 * be opened (here: sealed with a key the app no longer holds — a rotation gone wrong) was refused `revoked` by every
 * read and write-back, while the row kept `connected`, so the books' page kept saying "connected". Now the read and
 * the write-back each record it as a revoked grant: the row says connect again.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `deadd000-0000-4000-8000-${RUN}0001`;

d('a books grant that no longer opens reads as "connect again" (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 60_000 }, () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  const sealedWith = randomBytes(32);
  const heldNow = randomBytes(32);
  const odoo = odooFake();
  const row = async () => (await admin.query(`select state, reason from books_connections where business_id = $1 and system = 'odoo'`, [BIZ])).rows[0] as { state: string; reason: string | null };
  const connect = async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { saveConnection } = await import('../../src/db/booksConnections.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('id');
    await withTenantTx(db, bid.value, (tx) => saveConnection(tx, sealedWith, {
      businessId: BIZ, system: 'odoo', by: 'test', secret: JSON.stringify({ url: 'https://shop.odoo.com', database: 'shop-db', key: 'good-key' }),
      settings: { url: 'https://shop.odoo.com', database: 'shop-db' },
    }));
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area) values ($1, $2, 'service', 'MA', 'MAD', true)`, [BIZ, `Dead grant ${RUN}`]);
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
  });
  afterAll(async () => {
    await db?.destroy();
    await purgeBusinesses(admin, [BIZ], 'books-dead-grant-test');
    await admin?.end();
  });

  it('the read: refused, and the row no longer says connected', async () => {
    await connect();
    expect((await row()).state).toBe('connected');
    const { readConnectedSystem } = await import('../../src/books/readIn.js');
    const r = await readConnectedSystem({ db, credentialKey: heldNow, odoo: { post: odoo.post, today: () => '2026-10-31' } }, BIZ, 'odoo', 'test');
    expect(r).toEqual({ kind: 'refused', reason: 'revoked' });
    expect(await row()).toEqual({ state: 'connect_again', reason: 'revoked' });
  });

  it('the write-back: refused, and the row no longer says connected', async () => {
    await connect();
    expect((await row()).state).toBe('connected');
    const { writeBackOdoo } = await import('../../src/books/writeBack.js');
    const r = await writeBackOdoo({ db, credentialKey: heldNow, odoo: { post: odoo.post, today: () => '2026-10-31' } }, BIZ);
    expect(r).toEqual({ kind: 'refused', reason: 'revoked' });
    expect(await row()).toEqual({ state: 'connect_again', reason: 'revoked' });
  });

  it('the control: the key it was sealed with opens it, and the row stays connected', async () => {
    await connect();
    const { loadLiveConnection } = await import('../../src/db/booksConnections.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('id');
    expect(await loadLiveConnection(db, sealedWith, bid.value, 'odoo')).not.toBeNull();
    expect((await row()).state).toBe('connected');
  });
});
