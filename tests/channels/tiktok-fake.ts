import { createHmac, randomUUID } from 'node:crypto';
import type { TikTokApp, TikTokFetch } from '../../src/channels/tiktok/api.js';

/**
 * 0215 — A RECORDED FAKE OF TIKTOK'S BUSINESS MESSAGING API, from TikTok API for Business's own documentation (read
 * 2026-10-24: "Authentication", "Revoke a short-term access token", "Send a message to a conversation", "Subscribe to
 * Business Messaging Webhook events", "Webhook verification"). Every answer is HTTP 200 with a `code` (0 for success),
 * as TikTok's are. Nothing here is TikTok: the real API waits on the owner's access steps.
 *
 *   · /tt_user/oauth2/token/ — a code made by `code()` (once) → an access token, a refresh token, the account's
 *     open_id and the granted scope (all four messaging permissions unless `grant()` says fewer).
 *   · /tt_user/oauth2/refresh_token/ — a live refresh token → a NEW access token (the refresh token kept).
 *   · /tt_user/oauth2/revoke/ — the access token's grant ends: its access and refresh tokens stop working.
 *   · /business/message/send/ — a live access token, the account's open_id, a conversation → a message id; recorded.
 *     A dead token answers 40105.
 */
export const TIKTOK_APP: TikTokApp = {
  appId: '7300000000000000001', appSecret: 'tiktok-app-secret-for-tests-only',
  authUrl: 'https://www.tiktok.com/v2/auth/authorize?client_key=7300000000000000001&scope=message.list.read%2Cmessage.list.send&response_type=code&redirect_uri=https%3A%2F%2Fapp.example%2Fapp%2Fconnect%2Ftiktok%2Fcallback',
};
export const ALL_SCOPES = 'message.list.read,message.list.send,message.list.manage,user.account.type,user.info.basic';

export type TikTokFake = {
  readonly fetch: TikTokFetch;
  /** A fresh authorisation code for this account (`open_id`), as TikTok's redirect brings one. */
  code(openId?: string): string;
  /** The scope the next codes grant (default: every messaging permission). */
  grant(scope: string): void;
  /** Access tokens issued from now on last this many seconds (default: a day). */
  accessLasts(seconds: number): void;
  /** Every grant is dead from now on (the owner removed the app in TikTok): sends answer 40105, refreshes refuse. */
  killAll(): void;
  /** The revoke endpoint does not answer (a 503) — or, with false, answers again. */
  revokeDown(down?: boolean): void;
  readonly sent: { readonly openId: string; readonly conversation: string; readonly body: string; readonly messageId: string }[];
  readonly refreshes: () => number;
  readonly revoked: () => number;
  /** Is any token of this grant still honoured? */
  readonly live: (openId: string) => boolean;
};

const answer = (body: unknown, status = 200) => ({ status, text: async () => JSON.stringify(body) });
const ok = (data: unknown) => answer({ code: 0, message: 'OK', request_id: randomUUID(), data });
const no = (code: number, message: string) => answer({ code, message, request_id: randomUUID(), data: {} });

export function tiktokFake(app: TikTokApp = TIKTOK_APP): TikTokFake {
  const codes = new Map<string, string>();               // code → open_id
  const access = new Map<string, string>();              // access token → open_id
  const refresh = new Map<string, string>();             // refresh token → open_id
  let scope = ALL_SCOPES; let lasts = 86_400; let dead = false; let revokeIsDown = false;
  let refreshCount = 0; let revokeCount = 0;
  const sent: TikTokFake['sent'] = [];
  const issue = (openId: string, r?: string) => {
    const a = `act.${randomUUID()}`; const rt = r ?? `rft.${randomUUID()}`;
    access.set(a, openId); refresh.set(rt, openId);
    return { access_token: a, expires_in: lasts, open_id: openId, refresh_token: rt, refresh_token_expires_in: 31_536_000, scope, token_type: 'Bearer' };
  };
  const fetch: TikTokFetch = async (url, init) => {
    const u = new URL(url);
    const body = JSON.parse(init.body ?? '{}') as Record<string, unknown>;
    const clientOk = body['client_id'] === app.appId && body['client_secret'] === app.appSecret;
    switch (u.pathname) {
      case '/open_api/v1.3/tt_user/oauth2/token/': {
        if (!clientOk) return no(40001, 'client');
        const openId = codes.get(String(body['auth_code']));
        if (!openId || body['grant_type'] !== 'authorization_code') return no(40002, 'auth_code invalid');
        codes.delete(String(body['auth_code']));
        return ok(issue(openId));
      }
      case '/open_api/v1.3/tt_user/oauth2/refresh_token/': {
        refreshCount++;
        if (!clientOk) return no(40001, 'client');
        const openId = refresh.get(String(body['refresh_token']));
        if (dead || !openId) return no(40105, 'refresh token invalid');
        return ok(issue(openId, String(body['refresh_token'])));
      }
      case '/open_api/v1.3/tt_user/oauth2/revoke/': {
        revokeCount++;
        if (revokeIsDown) return answer('Service Unavailable', 503);
        if (!clientOk) return no(40001, 'client');
        const openId = access.get(String(body['access_token']));
        if (!openId) return no(40105, 'access token invalid');
        for (const [k, v] of [...access]) if (v === openId) access.delete(k);
        for (const [k, v] of [...refresh]) if (v === openId) refresh.delete(k);
        return ok({});
      }
      case '/open_api/v1.3/business/message/send/': {
        const openId = access.get(init.headers['Access-Token'] ?? '');
        if (dead || !openId) return no(40105, 'access token invalid');
        if (body['business_id'] !== openId || body['recipient_type'] !== 'CONVERSATION' || body['message_type'] !== 'TEXT') return no(40002, 'param');
        const text = (body['text'] as { body?: unknown } | undefined)?.body;
        if (typeof text !== 'string' || text.length > 6000) return no(40002, 'text');
        const messageId = `m.${randomUUID()}`;
        sent.push({ openId, conversation: String(body['recipient']), body: text, messageId });
        return ok({ message: { message_id: messageId } });
      }
      default: return no(40400, 'not found');
    }
  };
  return {
    fetch, sent,
    code(openId = `oid-${randomUUID()}`) { const c = `code-${randomUUID()}`; codes.set(c, openId); return c; },
    grant(s) { scope = s; },
    accessLasts(s) { lasts = s; },
    killAll() { dead = true; },
    revokeDown(down = true) { revokeIsDown = down; },
    refreshes: () => refreshCount,
    revoked: () => revokeCount,
    live: (openId) => [...access.values(), ...refresh.values()].includes(openId),
  };
}

/** A signed webhook delivery, as TikTok posts it: the body, and its `Tiktok-Signature` header. */
export function tiktokDelivery(app: TikTokApp, event: string, openId: string, content: Record<string, unknown>, at = Math.floor(Date.now() / 1000)):
  { readonly body: string; readonly signature: string } {
  const body = JSON.stringify({ client_key: app.appId, event, create_time: at, user_openid: openId, content: JSON.stringify(content) });
  return { body, signature: `t=${at},s=${createHmac('sha256', app.appSecret).update(`${at}.${body}`).digest('hex')}` };
}

/** What a customer's message looks like inside `content` (im_receive_msg). */
export function customerSays(o: { readonly conversation: string; readonly text?: string; readonly type?: string; readonly from?: string; readonly to?: string; readonly at?: number }): Record<string, unknown> {
  return {
    from: o.from ?? 'amira.shop', to: o.to ?? 'westlake.canvas', unique_identifier: `u-${o.conversation}`,
    from_user: { id: `u-${o.conversation}`, role: 'personal_account' }, to_user: { id: 'biz', role: 'business_account' },
    conversation_id: o.conversation, message_id: `in.${randomUUID()}`, timestamp: o.at ?? Date.now(),
    type: o.type ?? 'text', ...(o.text !== undefined ? { text: { body: o.text } } : {}), scene_type: 0, is_follower: false,
    message_tag: { source: 'APP' },
  };
}
