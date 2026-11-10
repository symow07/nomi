import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * 5.4 — tools/erase-buyer.mjs carries out a request for a customer who commented and was answered privately: the
 * comment, the reply, the public reply and the alert are ERASED (as the contract says), their outbound row with
 * the conversation, a "used" tombstone kept so the comment can never be answered again, the comment's id on the
 * ledger — and another customer's comment untouched. The tool compares the database function's counts with its
 * own plan table by table and rolls back on any difference, so a wrapper that reported these rows under another
 * heading (or not at all) fails here.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ADMIN = process.env['MIGRATE_DATABASE_URL'];
const suite = process.env['DATABASE_URL'] && ADMIN ? describe : describe.skip;
suite('5.4 · erase-buyer erases a customer\'s comment rows', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  const business = randomUUID(), account = randomUUID(), ig = '178414000000' + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  const A = { client: randomUUID(), conversation: randomUUID(), comment: randomUUID(), outbound: randomUUID(), req: randomUUID(), identity: 'igsid-erase-a', external: '9' + Date.now() };
  const B = { client: randomUUID(), conversation: randomUUID(), comment: randomUUID(), identity: 'igsid-erase-b', external: '8' + Date.now() };
  const tool = (args: string[]) => {
    const r = spawnSync(process.execPath, ['tools/erase-buyer.mjs', ...args], { cwd: ROOT, env: { ...process.env, MIGRATE_DATABASE_URL: ADMIN }, encoding: 'utf8', timeout: 120_000 });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  const q = (text: string, values: unknown[] = []) => admin.query(text, values);
  const n = async (table: string, id: string) => Number((await q(`select count(*) from ${table} where ${table === 'ig_comments' ? 'id' : 'comment_id'} = $1`, [id])).rows[0].count);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN }); await admin.connect();
    await q("insert into businesses (id, name) values ($1, 'Comment erasure fixture')", [business]);
    await q("insert into meta_accounts (id, business_id, page_id, page_name, ig_account_id, token_ciphertext, fingerprint, scopes, connected_by) values ($1, $2, $3, 'Page', $3, 'v1.fake-test-ciphertext', '000000000000', 'instagram_manage_comments', 'owner')", [account, business, ig]);
    await q("insert into ig_comment_settings (business_id, meta_account_id, account_id, enabled, changed_by) values ($1, $2, $3, true, 'owner')", [business, account, ig]);
    for (const p of [A, B]) {
      await q('insert into clients (id, business_id) values ($1, $2)', [p.client, business]);
      await q("insert into client_channels (client_id, channel, channel_user_id) values ($1, 'instagram', $2)", [p.client, p.identity]);
      await q("insert into conversations (id, business_id, client_id, channel) values ($1, $2, $3, 'instagram')", [p.conversation, business, p.client]);
      await q("insert into ig_comments (id, business_id, meta_account_id, account_id, comment_id, identity, words, media_id, asking, created_at, conversation_id, client_id) values ($1, $2, $3, $4, $5, $6, 'How much is the blue one?', '99999', true, now() - interval '1 hour', $7, $8)",
        [p.comment, business, account, ig, p.external, p.identity, p.conversation, p.client]);
    }
    await q("insert into outbound_messages (id, business_id, conversation_id, seq, body, channel, kind, origin, approved, to_wa_id, status) values ($1, $2, $3, 1, 'Hi, thanks for your comment.', 'instagram', 'comment_private_reply', 'owner', true, $4, 'sent')",
      [A.outbound, business, A.conversation, A.identity]);
    await q("insert into ig_comment_replies (business_id, comment_id, outbound_id, owner_id, public_requested, attempted_at, outcome, recipient_id, provider_message_id) values ($1, $2, $3, 'owner', true, now(), 'accepted', $4, 'mid.erase')",
      [business, A.comment, A.outbound, A.identity]);
    await q("insert into ig_comment_public_replies (business_id, comment_id, attempted_at, finished_at, outcome) values ($1, $2, now(), now(), 'accepted')", [business, A.comment]);
    await q('insert into ig_comment_alerts (business_id, comment_id, claimed_at, finished_at, outcome) values ($1, $2, now(), now(), $3)', [business, A.comment, 'sent']);
    await q('insert into ig_comment_alerts (business_id, comment_id) values ($1, $2)', [business, B.comment]);
    await q("insert into deletion_requests (id, business_id, scope, client_id, asked_by) values ($1, $2, 'buyer', $3, 'owner')", [A.req, business, A.client]);
  });
  afterAll(async () => { await admin?.end(); });

  it('a dry run lists the comment rows under what goes, and changes nothing', () => {
    const r = tool(['--request', A.req]);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    const erased = r.out.slice(r.out.indexOf('ERASED'), r.out.search(/KEPT|CHANGED IN PLACE|Dry run/));
    for (const t of ['ig_comments', 'ig_comment_replies', 'ig_comment_public_replies', 'ig_comment_alerts']) expect(erased, t).toMatch(new RegExp(`\\b1 {2}${t}\\b`));
    const changed = r.out.includes('CHANGED IN PLACE') ? r.out.slice(r.out.indexOf('CHANGED IN PLACE')) : '';
    expect(changed).not.toMatch(/ig_comment/);
  });

  it('--yes erases them, keeps the comment answered for good, records its id, and leaves the other customer\'s', async () => {
    const r = tool(['--request', A.req, '--yes', '--confirm', A.req.slice(0, 8), '--by', 'Operator Test']);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/buyer erased/);
    for (const t of ['ig_comments', 'ig_comment_replies', 'ig_comment_public_replies', 'ig_comment_alerts']) expect(await n(t, A.comment), t).toBe(0);
    expect(Number((await q('select count(*) from outbound_messages where id = $1', [A.outbound])).rows[0].count)).toBe(0);
    expect(await n('ig_comments', B.comment)).toBe(1);
    expect(await n('ig_comment_alerts', B.comment)).toBe(1);
    expect((await q("select state from ig_comment_tombstones where digest = ig_comment_digest($1, $2, $3)", [business, ig, A.external])).rows).toEqual([{ state: 'used' }]);
    expect((await q('select comment_ids from erasure_ledger where request_id = $1', [A.req])).rows.map((x) => x.comment_ids)).toEqual([[A.comment]]);
  });
});
