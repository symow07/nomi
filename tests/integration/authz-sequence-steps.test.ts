import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { asTenant, purgeBusinesses } from './books-db.js';

/**
 * The authorization audit (Block 7), fix round V1 — A SEQUENCE'S STEP BELONGS TO ITS OWN WORKSPACE'S SEQUENCE.
 *
 * The same class as 0241's bank match: `sequence_steps_frozen()` (0047) runs as the caller and read the sequence by id
 * alone. `sequence_steps.sequence_id` is a single-column key (its check looks past row security) and no tenant_ref_check
 * covers it, so from workspace A's session B's sequence was invisible: `approved` was null and the freeze did not
 * raise. A could write a step on B's APPROVED sequence; a step at position 1 of B's draft took that position, and B's
 * own first step was then refused (`unique (sequence_id, position)`) for a reason B cannot see; as admin there was no
 * workspace check at all. No route reaches it (the step routes read the sequence under row security first).
 *
 * 0241 reads the sequence in the step's own workspace and refuses one it does not find (23503,
 * `sequence_steps_own_sequence`). The tests were written by the independent verification and kept as they were.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const A = `c0741000-0000-4000-8000-${RUN}0001`;
const B = `c0741000-0000-4000-8000-${RUN}0002`;
const code = (p: Promise<unknown>) => p.then(() => 'accepted', (e: { code?: string }) => e.code ?? 'error');

d('Authorization audit · a sequence step names only its own workspace\'s sequence (0241; requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 60_000 }, () => {
  let admin: pg.Client; let tenant: pg.Client;
  let approvedB = ''; let draftB = '';
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL }); await tenant.connect();
    for (const [biz, tag] of [[A, 'A'], [B, 'B']] as const) {
      await admin.query(`insert into businesses (id, name, engine, country, currency) values ($1, $2, 'service', 'GB', 'USD')`, [biz, `verify seq ${tag} ${RUN}`]);
    }
    await asTenant(tenant, B, async (q) => {
      approvedB = (await q(`insert into sequences (business_id, name, created_by) values (current_business_id(), 'B approved', 'owner') returning id::text id`)).rows[0].id;
      await q(`insert into sequence_steps (business_id, sequence_id, position, delay_days, subject, body) values (current_business_id(), $1, 1, 0, 'B says', 'B words')`, [approvedB]);
      await q(`update sequences set approved_at = now(), approved_by = 'owner' where id = $1`, [approvedB]);
      draftB = (await q(`insert into sequences (business_id, name, created_by) values (current_business_id(), 'B draft', 'owner') returning id::text id`)).rows[0].id;
    });
  });
  afterAll(async () => { await tenant?.end(); await purgeBusinesses(admin, [A, B], 'verify-seq'); await admin?.end(); });

  it('control: B itself cannot add a step to its approved sequence (the freeze works in-workspace)', async () => {
    expect(await code(asTenant(tenant, B, (q) => q(`insert into sequence_steps (business_id, sequence_id, position, delay_days, subject, body) values (current_business_id(), $1, 2, 0, 's', 'b')`, [approvedB])))).toBe('23514');
  });

  it('A (app role) cannot write a step that names B\'s APPROVED sequence', async () => {
    const c = await code(asTenant(tenant, A, (q) => q(`insert into sequence_steps (business_id, sequence_id, position, delay_days, subject, body) values (current_business_id(), $1, 2, 0, 'from A', 'A words on B''s approved sequence')`, [approvedB])));
    console.log('[verify-seq] A app insert on B approved ->', c);
    expect(c).not.toBe('accepted');
  });

  it('A (app role) cannot take a position on B\'s draft sequence, and B can still add its own first step', async () => {
    const c = await code(asTenant(tenant, A, (q) => q(`insert into sequence_steps (business_id, sequence_id, position, delay_days, subject, body) values (current_business_id(), $1, 1, 0, 'from A', 'A words')`, [draftB])));
    const bOwn = await code(asTenant(tenant, B, (q) => q(`insert into sequence_steps (business_id, sequence_id, position, delay_days, subject, body) values (current_business_id(), $1, 1, 0, 'B first', 'B words')`, [draftB])));
    console.log('[verify-seq] A on B draft ->', c, '; then B own position 1 ->', bOwn);
    expect(c).not.toBe('accepted');
    expect(bOwn).toBe('accepted');
  });

  it('as admin (no row security), a step of workspace A naming B\'s sequence is refused', async () => {
    const draft2 = await asTenant(tenant, B, async (q) => (await q(`insert into sequences (business_id, name, created_by) values (current_business_id(), 'B draft 2', 'owner') returning id::text id`)).rows[0].id as string);
    const c = await code(admin.query(`insert into sequence_steps (business_id, sequence_id, position, delay_days, subject, body) values ($1, $2, 1, 0, 'from A', 'A words')`, [A, draft2]));
    console.log('[verify-seq] admin A-step on B draft ->', c);
    expect(c).not.toBe('accepted');
  });
  it('the refusal names itself: 23503 sequence_steps_own_sequence, as the app role and as admin', async () => {
    const named = (p: Promise<unknown>) => p.then(() => 'accepted', (e: { code?: string; constraint?: string }) => `${e.code}:${e.constraint}`);
    const draft3 = await asTenant(tenant, B, async (q) => (await q(`insert into sequences (business_id, name, created_by) values (current_business_id(), 'B draft 3', 'owner') returning id::text id`)).rows[0].id as string);
    const insert = `insert into sequence_steps (business_id, sequence_id, position, delay_days, subject, body) values ($1, $2, 1, 0, 'from A', 'A words')`;
    expect(await named(asTenant(tenant, A, (q) => q(insert.replace('$1', 'current_business_id()').replace('$2', '$1'), [draft3])))).toBe('23503:sequence_steps_own_sequence');
    expect(await named(admin.query(insert, [A, draft3]))).toBe('23503:sequence_steps_own_sequence');
    // Moving A's own step onto B's sequence is the same refusal.
    const own = await asTenant(tenant, A, async (q) => {
      const seq = (await q(`insert into sequences (business_id, name, created_by) values (current_business_id(), 'A draft', 'owner') returning id::text id`)).rows[0].id as string;
      await q(`insert into sequence_steps (business_id, sequence_id, position, delay_days, subject, body) values (current_business_id(), $1, 1, 0, 'A', 'A')`, [seq]);
      return seq;
    });
    expect(await named(admin.query(`update sequence_steps set sequence_id = $1 where sequence_id = $2`, [draft3, own]))).toBe('23503:sequence_steps_own_sequence');
  });
});
