import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import pg from 'pg';
import { withTenantTx, lockConversation } from '../../src/db/client.js';
import { channelStore } from '../../src/db/channels.js';
import { queueCommentPrivateReply } from '../../src/db/commentReplyQueue.js';
import { prepareConversationOutbound, callProvider } from '../../src/outbound/worker.js';
import type { ChannelAdapter } from '../../src/channels/contract.js';
import { parseBusinessId } from '../../src/core/types/ids.js';
import { connectMetaAccount, linkMetaCredentials } from '../../src/db/metaAccounts.js';
import { encryptSecret, deriveKey } from '../../src/security/credentials.js';
import { META_LOGIN_SCOPES } from '../../src/channels/meta/connect.js';
import { makeSessionCodec } from '../../src/api/web/session.js';
import { PUBLIC_COMMENT_REPLY } from '../../src/channels/meta/commentReplies.js';
import { offlineModels } from '../pipeline/fakes.js';
import { dropQueuedWork } from './tenant.js';

/**
 * 5.4 Part B through the production composition: the owner's route, the real outbound worker and gate, a fake Meta
 * at the fetch, the public reply's worker, and the first DM's bracket. No real network.
 */
const suite = process.env['DATABASE_URL'] && process.env['MIGRATE_DATABASE_URL'] ? describe : describe.skip;
const ROOT = '/app/channels/instagram/comments';
type Mode = 'ok' | 'fail' | 'uncertain' | 'unauthorized';

// Each test drives the real outbound and comment workers and waits for them: the default five seconds is too short
// under a full run.
suite('5.4 · the owner\'s one private reply to a comment, end to end', { timeout: 60_000 }, () => {
  let prod: import('../../src/main.js').Production; let admin: pg.Client; let account: string;
  let cookie: string; let staffCookie: string; let otherCookie: string; let product: string;
  const business = randomUUID(); const other = randomUUID();
  const key = 'd'.repeat(64); const appSecret = 'fake-reply-app-secret';
  const secret = createHmac('sha256', key).update('yf-web-session').digest('hex');
  const ig = String(Date.now()) + '71', page = String(Date.now()) + '72', appId = '223456789';
  const b = parseBusinessId(business); if (!b.ok) throw new Error('fixture'); const bid = b.value;
  const calls: { url: string; body: unknown }[] = [];
  const privateMode = new Map<string, Mode>(); const publicMode = new Map<string, Mode>();
  let seq = 0;
  const answer = (mode: Mode, ok: unknown) => mode === 'ok' ? { status: 200, body: ok }
    : mode === 'uncertain' ? { status: 200, body: { message_id: 'mid.half' } }
    : mode === 'unauthorized' ? { status: 401, body: { error: { message: 'fake' } } } : { status: 500, body: { error: { message: 'fake' } } };
  const metaFetch: import('../../src/channels/meta/messaging.js').MetaFetch = async (url, init) => {
    const body: unknown = init.body ? JSON.parse(init.body) : null; calls.push({ url, body });
    const u = new URL(url); const parts = u.pathname.split('/');
    let r: { status: number; body: unknown } = { status: 400, body: {} };
    const cid = (body as { recipient?: { comment_id?: string } } | null)?.recipient?.comment_id;
    if (parts.at(-1) === 'messages' && parts.at(-2) === ig && cid) r = answer(privateMode.get(cid) ?? 'ok', { message_id: `mid.${cid}`, recipient_id: `igsid-${cid}` });
    else if (parts.at(-1) === 'replies') { const c = parts.at(-2)!; r = answer(publicMode.get(c) ?? 'ok', { id: `pub.${c}` }); }
    else if (parts.at(-1) === 'messages') r = { status: 200, body: { message_id: 'mid.dm.' + randomUUID(), recipient_id: 'x' } };
    else if (parts.at(-1) === 'debug_token') r = { status: 200, body: { data: { is_valid: true, app_id: appId, scopes: [...META_LOGIN_SCOPES, 'instagram_manage_comments'] } } };
    return { status: r.status, text: async () => JSON.stringify(r.body) };
  };
  const post = (url: string, fields: Record<string, string>, who = cookie) => prod.app.inject({ method: 'POST', url,
    headers: { cookie: who, 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(fields).toString() });
  const get = (url: string, who = cookie) => prod.app.inject({ method: 'GET', url, headers: { cookie: who } });
  const q = async (text: string, values: unknown[] = []) => (await admin.query(text, values)).rows;
  const commentCalls = (cid: string) => calls.filter((c) => (c.body as { recipient?: { comment_id?: string } } | null)?.recipient?.comment_id === cid);
  const publicCalls = (cid: string) => calls.filter((c) => c.url.endsWith(`/${cid}/replies`));

  /** An asking comment as Part A leaves it: enriched, matched to Blue bag unless told otherwise. */
  const comment = async (o: { ageMs?: number | null; identity?: string; matched?: boolean; asking?: boolean; biz?: string } = {}) => {
    const external = String(9_000_000 + (++seq)); const identity = o.identity ?? `igsid-${external}`;
    const created = o.ageMs === null ? null : new Date(Date.now() - (o.ageMs ?? 3_600_000));
    const rows = await q(`insert into ig_comments (business_id, meta_account_id, account_id, comment_id, identity, username, words, media_id,
        asking, created_at, match_state, product_id, enriched_at) values ($1,$2,$3,$4,$5,'shopper','Is this available?','media-1',$6,$7,$8,$9,now()) returning id`,
      [o.biz ?? business, account, ig, external, identity, o.asking ?? true, created, o.matched === false ? 'none' : 'matched', o.matched === false ? null : product]);
    return { id: rows[0].id as string, external, identity };
  };
  const send = (id: string, fields: Record<string, string> = {}, who = cookie) => post(`${ROOT}/${id}/reply`, { body: 'Hi, yes it is. Want a photo?', ...fields }, who);
  const state = async (id: string) => (await q(`select r.outcome, r.attempted_at, r.recipient_id, r.provider_message_id, o.status, o.kind, o.origin, o.approved,
      o.channel, o.to_wa_id, o.body, p.outcome as public_outcome from ig_comment_replies r left join outbound_messages o on o.id = r.outbound_id
      left join ig_comment_public_replies p on p.comment_id = r.comment_id where r.comment_id = $1`, [id]))[0];
  const settled = (id: string) => expect.poll(async () => (await state(id))?.outcome, { timeout: 15_000 }).not.toBe('reserved');

  beforeAll(async () => {
    process.env['PILOT_BUSINESS_ID'] = business; process.env['OWNER_ACCESS_CODE'] = 'fake-reply-owner-code';
    process.env['META_SOCIAL_APP_SECRET'] = appSecret; process.env['META_SOCIAL_APP_ID'] = appId;
    process.env['META_LOGIN_CONFIG_ID'] = '456789013'; process.env['META_COMMENTS_LOGIN_CONFIG_ID'] = '567890124';
    delete process.env['META_PAGE_ACCESS_TOKEN']; delete process.env['META_PAGE_ID']; delete process.env['META_IG_ACCOUNT_ID'];
    const { buildProduction } = await import('../../src/main.js');
    prod = await buildProduction({ provider: 'disabled', DATABASE_URL: process.env['DATABASE_URL']!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'fake-reply-verify', CREDENTIAL_KEY: key, PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test' },
      { models: offlineModels(), logger: false, metaFetch });
    admin = new pg.Client({ connectionString: process.env['MIGRATE_DATABASE_URL'] }); await admin.connect();
    await q(`insert into businesses (id, name) values ($1, 'Reply shop'), ($2, 'Other shop') on conflict (id) do nothing`, [business, other]);
    await withTenantTx(prod.db, bid, async (x) => {
      const a = await connectMetaAccount(x, bid, { pageId: page, pageName: 'Reply shop', igAccountId: ig, igUsername: 'replyshop',
        ciphertext: encryptSecret('fake-reply-page-secret', deriveKey(key)), fingerprint: '000000000000',
        scopes: [...META_LOGIN_SCOPES, 'instagram_manage_comments'].join(' '), by: 'owner' });
      if (!a.ok) throw new Error(a.reason); account = a.id;
      await linkMetaCredentials(x, bid, { accountId: account, pageId: page, igAccountId: ig, actor: 'owner' });
    });
    await q(`insert into ig_comment_settings (business_id, meta_account_id, account_id, enabled, changed_by) values ($1,$2,$3,true,'owner')`, [business, account, ig]);
    product = (await q(`insert into products (business_id, sku, name) values ($1, 'RBLUE', 'Blue bag') returning id`, [business]))[0].id;
    const codec = makeSessionCodec(secret);
    cookie = 'yf_session=' + codec.sign({ businessId: business, exp: Date.now() + 3_600_000 });
    otherCookie = 'yf_session=' + codec.sign({ businessId: other, exp: Date.now() + 3_600_000 });
    const staff = randomUUID(); await q(`insert into people (id, business_id, name, is_owner) values ($1,$2,'Staff',false)`, [staff, business]);
    staffCookie = 'yf_session=' + codec.sign({ businessId: business, exp: Date.now() + 3_600_000, person: { id: staff, name: 'Staff', isOwner: false } });
  }, 90_000);
  afterAll(async () => { if (prod) await dropQueuedWork(prod, [business, other]); await prod?.close(); await admin?.end(); });

  it('the owner\'s Send writes one approved owner row of the new kind and Instagram gets one comment-addressed call', async () => {
    const c = await comment();
    const html = (await get(ROOT)).body;
    expect(html).toContain(`${ROOT}/${c.id}/reply`); expect(html).toContain('about Blue bag');
    const r = await send(c.id); expect(r.statusCode).toBe(302);
    await settled(c.id);
    const s = await state(c.id);
    expect(s).toMatchObject({ outcome: 'accepted', status: 'sent', kind: 'comment_private_reply', origin: 'owner', approved: true,
      channel: 'instagram', to_wa_id: c.identity, recipient_id: `igsid-${c.external}`, provider_message_id: `mid.${c.external}`, public_outcome: null });
    expect(commentCalls(c.external)).toHaveLength(1);
    expect(commentCalls(c.external)[0]!.url).toBe(`https://graph.facebook.com/v23.0/${ig}/messages`);
    expect(commentCalls(c.external)[0]!.body).toEqual({ recipient: { comment_id: c.external }, message: { text: 'Hi, yes it is. Want a photo?' } });
    expect(publicCalls(c.external)).toHaveLength(0);
    // The 'sent' side effect: on the conversation's timeline as the owner's own message.
    const timeline = await q(`select m.direction, o.origin, m.text_content from messages m
      join outbound_messages o on m.external_id = 'out:' || o.id::text join ig_comment_replies r on r.outbound_id = o.id
      where r.comment_id = $1`, [c.id]);
    expect(timeline).toEqual([{ direction: 'outbound', origin: 'owner', text_content: 'Hi, yes it is. Want a photo?' }]);
    expect((await get(ROOT)).body).toContain('Your private reply was sent');
    // Once, ever: a second Send changes nothing and calls nothing.
    expect((await send(c.id)).statusCode).toBe(302);
    expect((await q('select count(*)::int n from outbound_messages where conversation_id = (select conversation_id from ig_comments where id = $1)', [c.id]))[0].n).toBe(1);
    expect(commentCalls(c.external)).toHaveLength(1);
  });

  it('on an Arabic page the English notice is set apart, and an answered comment shows no hours left', async () => {
    const c = await comment();
    const res = await send(c.id, {}, `${cookie}; yf_locale=ar`);
    const flash = String(res.headers['set-cookie'] ?? '').match(/yf_flash=[^;]+/)?.[0];
    expect(flash).toBeTruthy();
    await settled(c.id);
    const body = (await get(ROOT, `${cookie}; yf_locale=ar; ${flash}`)).body;
    expect(body).toMatch(/<div class="flash"[^>]*><bdi lang="en" dir="ltr">Your private reply is on its way\.<\/bdi><\/div>/);
    const card = /<article class="card" id="comment-[^"]*"[\s\S]*?<\/article>/g;
    const mine = [...body.matchAll(card)].map((m) => m[0]).find((a) => a.includes(`id="comment-${c.id}"`)) ?? '';
    expect(mine).toContain('Your private reply was sent');
    expect(mine).not.toContain('Hours left to reply');
  });

  it('the public reply goes once, only after the private reply is accepted', async () => {
    const c = await comment();
    await send(c.id, { public: '1' }); await settled(c.id);
    await expect.poll(async () => (await state(c.id)).public_outcome, { timeout: 15_000 }).toBe('accepted');
    expect(publicCalls(c.external)).toHaveLength(1);
    expect(publicCalls(c.external)[0]!.body).toEqual({ message: PUBLIC_COMMENT_REPLY });
    expect((await get(ROOT)).body).toContain('public reply was posted');
  });

  it('a failed public reply is shown and never tried again', async () => {
    const c = await comment(); publicMode.set(c.external, 'fail');
    await send(c.id, { public: '1' }); await settled(c.id);
    await expect.poll(async () => (await state(c.id)).public_outcome, { timeout: 15_000 }).toBe('failed');
    await new Promise((r) => setTimeout(r, 3_000));
    expect(publicCalls(c.external)).toHaveLength(1);
    expect((await get(ROOT)).body).toContain('not tried again');
  });

  for (const mode of ['fail', 'uncertain'] as const) it(`a ${mode} private reply queues no public job, is not retried, and stays used`, async () => {
    const c = await comment(); privateMode.set(c.external, mode);
    await send(c.id, { public: '1' }); await settled(c.id);
    expect((await state(c.id)).outcome).toBe(mode === 'fail' ? 'refused' : 'uncertain');
    expect((await q(`select count(*)::int n from pgboss.job where name = 'instagram.comment_public' and data->>'commentId' = $1`, [c.id]))[0].n).toBe(0);
    expect((await state(c.id)).public_outcome).toBeNull();
    const shown = /<article class="card" id="comment-[^"]*"[\s\S]*?<\/article>/g;
    const card = [...(await get(ROOT)).body.matchAll(shown)].map((m) => m[0]).find((a) => a.includes(`id="comment-${c.id}"`)) ?? '';
    expect(card).toContain(mode === 'fail' ? 'No public reply will be posted.'
      : 'Your private reply may have reached them. It is not sent again, and no public reply will be posted.');
    expect(card).not.toContain('once the private reply is accepted');
    await new Promise((r) => setTimeout(r, 3_000));
    expect(commentCalls(c.external)).toHaveLength(1);
    privateMode.delete(c.external);
    await send(c.id);
    expect(commentCalls(c.external)).toHaveLength(1);
    expect(publicCalls(c.external)).toHaveLength(0);
  });

  it('a 401 marks the account revoked, as for DMs', async () => {
    const c = await comment(); privateMode.set(c.external, 'unauthorized');
    await send(c.id); await settled(c.id);
    expect((await q('select last_error from meta_accounts where id = $1', [account]))[0].last_error).toBe('revoked');
    await q('update meta_accounts set last_error = null, needs_attention_at = null where id = $1', [account]);
  });

  it('refused at the route with zero calls and nothing kept: expired, unknown age, off, not asking, empty', async () => {
    const before = calls.length;
    const conversations = async () => (await q('select count(*)::int n from conversations where business_id = $1', [business]))[0].n;
    const n = await conversations();
    for (const [o, flash] of [[{ ageMs: 7 * 86_400_000 }, 'expired'], [{ ageMs: null }, 'age_unknown'], [{ asking: false }, 'not_asking']] as const) {
      const c = await comment(o); const r = await send(c.id);
      expect(r.statusCode).toBe(302); expect(String(r.headers['set-cookie'])).toBeTruthy();
      expect(await state(c.id)).toBeUndefined(); void flash;
    }
    const c = await comment();
    expect((await send(c.id, { body: '   ' })).statusCode).toBe(302);
    await q('update ig_comment_settings set enabled = false where meta_account_id = $1', [account]);
    try { await send(c.id); } finally { await q('update ig_comment_settings set enabled = true where meta_account_id = $1', [account]); }
    expect(await state(c.id)).toBeUndefined();
    expect(await conversations()).toBe(n);
    expect(calls.length).toBe(before);
  });

  it('staff are refused, another workspace cannot see it, and a form value cannot choose the comment\'s recipient', async () => {
    const c = await comment();
    expect((await send(c.id, {}, staffCookie)).statusCode).toBe(302);
    expect(await state(c.id)).toBeUndefined();
    expect((await send(c.id, {}, otherCookie)).statusCode).toBe(404);
    expect(await state(c.id)).toBeUndefined();
    await send(c.id, { to: 'someone-else', recipient: 'x', comment_id: '1' }); await settled(c.id);
    expect((await state(c.id)).to_wa_id).toBe(c.identity);
    expect(commentCalls(c.external)).toHaveLength(1);
  });

  it('two Sends at once queue one reply and Instagram is called once', async () => {
    const c = await comment();
    await Promise.all([send(c.id), send(c.id), send(c.id)]);
    await settled(c.id);
    expect((await q('select count(*)::int n from outbound_messages where kind = $1 and conversation_id = (select conversation_id from ig_comments where id = $2)', ['comment_private_reply', c.id]))[0].n).toBe(1);
    expect(commentCalls(c.external)).toHaveLength(1);
  });

  it('a standing opt-out refuses at send time with zero calls, and the reply may be sent once it is lifted', async () => {
    const c = await comment();
    await q(`insert into opt_outs (business_id, channel, identity, last_asked_at) values ($1, 'instagram', $2, now())`, [business, c.identity]);
    await send(c.id);
    await expect.poll(async () => (await state(c.id)).status, { timeout: 15_000 }).toBe('canceled');
    expect(commentCalls(c.external)).toHaveLength(0);
    expect((await state(c.id)).attempted_at).toBeNull();
    expect((await get(ROOT)).body).toContain('You can send it again');
    await q(`update opt_outs set lifted_at = now(), lifted_by = 'owner' where business_id = $1 and identity = $2`, [business, c.identity]);
    await send(c.id); await settled(c.id);
    expect((await state(c.id)).outcome).toBe('accepted');
    expect(commentCalls(c.external)).toHaveLength(1);
  });

  it('two concurrent drives of the same row, each under the production locks, make exactly one provider call', async () => {
    const c = await comment();
    // Queued without its job, so only the two drives below take it.
    const queued = await withTenantTx(prod.db, bid, (tx) => queueCommentPrivateReply(tx, bid, { commentId: c.id, ownerId: 'owner', body: 'Race', publicRequested: false, now: new Date() }));
    if (!queued.ok) throw new Error(queued.reason);
    let provider = 0; let dm = 0;
    const adapter = { kind: 'instagram', verifyWebhook: () => true, parseWebhook: () => [], commentPrivateReplyAccountId: ig,
      sendText: async () => { dm++; return { ok: true, providerMessageId: 'x' }; },
      sendCommentPrivateReply: async () => { provider++; await new Promise((r) => setTimeout(r, 200)); return { ok: true, providerMessageId: 'mid.race', recipientId: 'r' }; },
    } as unknown as ChannelAdapter;
    const drive = async () => {
      const prepared = await withTenantTx(prod.db, bid, async (tx) => {
        await lockConversation(tx, queued.conversationId);
        return prepareConversationOutbound({ store: channelStore(tx, bid, { template: 'none' }), adapters: () => adapter, now: () => new Date() }, queued.conversationId);
      });
      return prepared.send ? callProvider(prepared.send) : null;
    };
    const results = await Promise.all([drive(), drive(), drive()]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(provider).toBe(1); expect(dm).toBe(0);
    expect((await q('select attempted_at from ig_comment_replies where comment_id = $1', [c.id]))[0].attempted_at).not.toBeNull();
  });

  describe('when the person answers in DMs', () => {
    const dm = (sender: string, text: string, replyTo?: string) => {
      const payload = { object: 'instagram', entry: [{ id: ig, time: Math.floor(Date.now() / 1000), messaging: [{ sender: { id: sender }, recipient: { id: ig },
        timestamp: Date.now(), message: { mid: 'dm-' + randomUUID(), text, ...(replyTo ? { reply_to: { mid: replyTo } } : {}) } }] }] };
      const raw = JSON.stringify(payload);
      return prod.app.inject({ method: 'POST', url: '/webhook/instagram', payload: raw,
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex') } });
    };
    /** Two comments by one person share a conversation: Instagram's ordering (existing) waits for the first reply's receipt. */
    const sendBoth = async (first: string, second: string) => {
      await send(first); await settled(first);
      await q(`update outbound_messages set status = 'delivered', delivered_at = now() where id = (select outbound_id from ig_comment_replies where comment_id = $1)`, [first]);
      await send(second);
      await expect.poll(async () => (await state(second))?.outcome, { timeout: 40_000 }).toBe('accepted');
    };
    const fragment = (text: string) => expect.poll(async () => (await q(`select f.text from message_fragments f where f.business_id = $1 and f.text like $2`,
      [business, text + '%']))[0]?.text, { timeout: 15_000 });

    it('the unique accepted reply to this person: the first turn names the product, once', async () => {
      const c = await comment({ identity: 'igsid-unique-1' });
      privateMode.set(c.external, 'ok'); await send(c.id); await settled(c.id);
      // The fake gives back recipient igsid-<comment id>; the person answers from that id.
      const sender = `igsid-${c.external}`;
      await dm(sender, 'yes please unique-one');
      await fragment('yes please unique-one').toBe('yes please unique-one\n[commented on your post about: Blue bag]');
      await dm(sender, 'and in green? unique-two');
      await fragment('and in green? unique-two').toBe('and in green? unique-two');
      // The DM conversation is the comment's now; the comment's own identity still finds it for an erasure.
      const linked = await q(`select c.conversation_id, v.id as dm from ig_comments c, conversations v join client_channels cc on cc.client_id = v.client_id
        where c.id = $1 and cc.channel = 'instagram' and cc.channel_user_id = $2 and v.business_id = $3`, [c.id, sender, business]);
      expect(linked).toHaveLength(1); expect(linked[0].conversation_id).toBe(linked[0].dm);
    });

    it('the provider\'s reply-to id picks the comment even when the person has several', async () => {
      const a = await comment({ identity: 'igsid-many' }); const b2 = await comment({ identity: 'igsid-many', matched: false });
      await sendBoth(a.id, b2.id);
      await q(`update ig_comment_replies set recipient_id = 'igsid-many-dm' where comment_id = any($1::uuid[])`, [[a.id, b2.id]]);
      await dm('igsid-many-dm', 'replying to the bag unique-three', `mid.${a.external}`);
      await fragment('replying to the bag unique-three').toBe('replying to the bag unique-three\n[commented on your post about: Blue bag]');
      expect((await q('select attribution_ambiguous from ig_comments where id = $1', [a.id]))[0].attribution_ambiguous).toBe(false);
    });

    it('several and no reply-to: no bracket, nothing guessed, and the ambiguity is shown', async () => {
      const a = await comment({ identity: 'igsid-two' }); const b2 = await comment({ identity: 'igsid-two' });
      await sendBoth(a.id, b2.id);
      await q(`update ig_comment_replies set recipient_id = 'igsid-two-dm' where comment_id = any($1::uuid[])`, [[a.id, b2.id]]);
      await dm('igsid-two-dm', 'hello there unique-four');
      await fragment('hello there unique-four').toBe('hello there unique-four');
      expect((await q('select bool_and(attribution_ambiguous) a from ig_comments where id = any($1::uuid[])', [[a.id, b2.id]]))[0].a).toBe(true);
      expect((await get(ROOT)).body).toContain('did not guess');
    });

    it('a comment that named no single product links the conversation and names nothing', async () => {
      const c = await comment({ matched: false });
      await send(c.id); await settled(c.id);
      await dm(`igsid-${c.external}`, 'what colours unique-five');
      await fragment('what colours unique-five').toBe('what colours unique-five');
      expect((await q('select context_used_at from ig_comment_replies where comment_id = $1', [c.id]))[0].context_used_at).not.toBeNull();
    });
  });

  it('customer erasure takes the comment, its reply and its public state, and leaves a used marker', async () => {
    const c = await comment(); await send(c.id, { public: '1' }); await settled(c.id);
    await expect.poll(async () => (await state(c.id)).public_outcome, { timeout: 15_000 }).toBe('accepted');
    const client = (await q('select client_id from ig_comments where id = $1', [c.id]))[0].client_id;
    await q('select erase_customer_rows($1, $2, null, false)', [business, client]);
    for (const t of ['ig_comments', 'ig_comment_replies', 'ig_comment_public_replies']) {
      expect((await q(`select count(*)::int n from ${t} where ${t === 'ig_comments' ? 'id' : 'comment_id'} = $1`, [c.id]))[0].n).toBe(0);
    }
    expect((await q('select state from ig_comment_tombstones where digest = ig_comment_digest($1,$2,$3)', [business, ig, c.external]))[0].state).toBe('used');
  });
});
