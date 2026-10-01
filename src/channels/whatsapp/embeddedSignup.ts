import { randomInt } from 'node:crypto';
import type { MetaFetch } from '../meta/messaging.js';

/**
 * WA — A BUSINESS CONNECTS ITS OWN WHATSAPP NUMBER (Meta's Embedded Signup,
 * the Tech Provider path; decision 43). Built as if Tech Provider status and
 * the review had passed: none of it has met Meta's real servers (the
 * never-run list in docs/PROGRESS.md).
 *
 * THE FLOW, with no script on our page (the Page connect's shape, C10):
 *
 *   1. The owner presses Connect. We send them to Facebook Login for Business
 *      with the Embedded Signup configuration (`config_id`) and the extras
 *      that open WhatsApp's own steps: their business portfolio, a WhatsApp
 *      Business Account, a number that is not on the WhatsApp app, its
 *      display name, the code Meta sends to that number.
 *   2. Meta sends them back with a `code`, which we exchange for the business
 *      token (a Business Integration System User token: it does not expire).
 *   3. Which WhatsApp Business Account they shared: `debug_token` lists it
 *      under the `whatsapp_business_management` scope's target ids — the
 *      documented way when the page runs no script to hear the session event.
 *   4. Its numbers (`GET /{waba}/phone_numbers`); with several, they choose.
 *   5. Our app is subscribed to the account's webhooks
 *      (`POST /{waba}/subscribed_apps`) and the number is registered for the
 *      Cloud API with a two-step PIN we make (`POST /{number}/register`).
 *
 * Every call here NEVER throws: a refusal or a silence is a reason the owner
 * reads, and nothing is half-stored — the caller stores only a finished one.
 */

export type WaLogin = {
  /** The WhatsApp app (the one whose secret signs `/webhook/whatsapp`). */
  readonly appId: string;
  readonly appSecret: string;
  /** The Facebook Login for Business configuration set up for Embedded Signup. */
  readonly configId: string;
};

/** All three or nothing; the secret is the WhatsApp app's own, META_APP_SECRET. */
export function waLoginFrom(env: Record<string, string | undefined>, appSecret: string | undefined): WaLogin | null {
  const appId = env['META_WHATSAPP_APP_ID']?.trim();
  const configId = env['META_WHATSAPP_ES_CONFIG_ID']?.trim();
  if (!appId || !configId || !appSecret) return null;
  if (!/^[0-9]{5,}$/.test(appId) || !/^[0-9]{5,}$/.test(configId)) return null;
  return { appId, appSecret, configId };
}

/** Where the owner is sent: Embedded Signup's own steps, in Meta's dialog. */
export function waDialogUrl(login: WaLogin, o: { readonly redirectUri: string; readonly state: string; readonly graphVersion: string }): string {
  const q = new URLSearchParams({
    client_id: login.appId, redirect_uri: o.redirectUri, state: o.state, config_id: login.configId,
    response_type: 'code', override_default_response_type: 'true',
    extras: JSON.stringify({ setup: {}, featureType: '', sessionInfoVersion: '3' }),
  });
  return `https://www.facebook.com/${o.graphVersion}/dialog/oauth?${q.toString()}`;
}

export const WA_TIMEOUT_MS = 15_000;

type J = Record<string, unknown>;
const obj = (v: unknown): J => (typeof v === 'object' && v !== null ? v as J : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : null);
const ID = /^[0-9]{5,30}$/;

const call = async (
  fetchImpl: MetaFetch, method: 'GET' | 'POST', url: string, o: { token?: string; body?: J } = {},
): Promise<{ status: number; body: J } | null> => {
  try {
    const res = await fetchImpl(url, {
      method,
      headers: {
        ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}),
        ...(o.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(o.body ? { body: JSON.stringify(o.body) } : {}),
      signal: AbortSignal.timeout(WA_TIMEOUT_MS),
    });
    const text = await res.text().catch(() => '');
    let body: J = {};
    try { body = obj(JSON.parse(text)); } catch { /* not JSON */ }
    return { status: res.status, body };
  } catch {
    return null;
  }
};
const ok = (r: { status: number } | null): boolean => r !== null && r.status >= 200 && r.status < 300;

export type WaFailure =
  /** Meta refused the code (expired, reused, wrong address). */
  | 'rejected'
  /** Meta did not answer. */
  | 'unavailable'
  /** The owner finished without sharing a WhatsApp Business Account. */
  | 'no_account'
  /** The account they shared has no number. */
  | 'no_number'
  /** Meta would not subscribe us to the account, or would not register the number. */
  | 'refused';

/** The code → the business token. */
export async function exchangeWaCode(
  login: WaLogin, input: { readonly code: string; readonly redirectUri: string; readonly graphVersion: string }, fetchImpl: MetaFetch,
): Promise<{ readonly ok: true; readonly token: string } | { readonly ok: false; readonly reason: WaFailure }> {
  const r = await call(fetchImpl, 'GET', `https://graph.facebook.com/${input.graphVersion}/oauth/access_token?${new URLSearchParams({
    client_id: login.appId, client_secret: login.appSecret, redirect_uri: input.redirectUri, code: input.code,
  }).toString()}`);
  if (!r) return { ok: false, reason: 'unavailable' };
  const token = str(r.body['access_token']);
  if (!ok(r) || !token) return { ok: false, reason: r.status >= 500 ? 'unavailable' : 'rejected' };
  return { ok: true, token };
}

/** The WhatsApp Business Accounts the token was granted (debug_token, asked with the app's own token). */
export async function sharedWabas(
  login: WaLogin, input: { readonly token: string; readonly graphVersion: string }, fetchImpl: MetaFetch,
): Promise<readonly string[] | null> {
  const r = await call(fetchImpl, 'GET', `https://graph.facebook.com/${input.graphVersion}/debug_token?${new URLSearchParams({
    input_token: input.token, access_token: `${login.appId}|${login.appSecret}`,
  }).toString()}`);
  if (!ok(r)) return null;
  const scopes = Array.isArray(obj(r!.body['data'])['granular_scopes']) ? obj(r!.body['data'])['granular_scopes'] as unknown[] : [];
  const ids = scopes.map(obj)
    .filter((s) => s['scope'] === 'whatsapp_business_management')
    .flatMap((s) => (Array.isArray(s['target_ids']) ? s['target_ids'] as unknown[] : []))
    .map(str).filter((x): x is string => x !== null && ID.test(x));
  return [...new Set(ids)];
}

export type WaNumber = {
  readonly id: string;
  readonly display: string | null;
  readonly verifiedName: string | null;
  /** Meta's display-name review: APPROVED, PENDING_REVIEW, DECLINED, … */
  readonly nameStatus: string | null;
};

export async function wabaNumbers(
  input: { readonly wabaId: string; readonly token: string; readonly graphVersion: string }, fetchImpl: MetaFetch,
): Promise<readonly WaNumber[] | null> {
  if (!ID.test(input.wabaId)) return null;
  const r = await call(fetchImpl, 'GET',
    `https://graph.facebook.com/${input.graphVersion}/${input.wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,name_status`,
    { token: input.token });
  if (!ok(r)) return null;
  const list = Array.isArray(r!.body['data']) ? r!.body['data'] as unknown[] : [];
  return list.map(obj).flatMap((n) => {
    const id = str(n['id']);
    if (!id || !ID.test(id)) return [];
    return [{
      id,
      display: str(n['display_phone_number'])?.slice(0, 40) ?? null,
      verifiedName: str(n['verified_name'])?.slice(0, 200) ?? null,
      nameStatus: str(n['name_status'])?.slice(0, 40) ?? null,
    }];
  });
}

/** Our app hears this account's messages. */
export async function subscribeWaba(
  input: { readonly wabaId: string; readonly token: string; readonly graphVersion: string }, fetchImpl: MetaFetch,
): Promise<boolean> {
  if (!ID.test(input.wabaId)) return false;
  return ok(await call(fetchImpl, 'POST', `https://graph.facebook.com/${input.graphVersion}/${input.wabaId}/subscribed_apps`, { token: input.token }));
}

/** A two-step PIN: six digits, made here, never shown on a page. */
export const newPin = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** The number joins the Cloud API. A number already registered answers 200 again. */
export async function registerNumber(
  input: { readonly phoneNumberId: string; readonly token: string; readonly pin: string; readonly graphVersion: string }, fetchImpl: MetaFetch,
): Promise<boolean> {
  if (!ID.test(input.phoneNumberId) || !/^[0-9]{6}$/.test(input.pin)) return false;
  return ok(await call(fetchImpl, 'POST', `https://graph.facebook.com/${input.graphVersion}/${input.phoneNumberId}/register`,
    { token: input.token, body: { messaging_product: 'whatsapp', pin: input.pin } }));
}

/** Disconnect: our app stops hearing the account. Best effort — the credential is switched off either way. */
export async function unsubscribeWaba(
  input: { readonly wabaId: string; readonly token: string; readonly graphVersion: string }, fetchImpl: MetaFetch,
): Promise<boolean> {
  if (!ID.test(input.wabaId)) return false;
  try {
    const res = await fetchImpl(`https://graph.facebook.com/${input.graphVersion}/${input.wabaId}/subscribed_apps`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${input.token}` }, signal: AbortSignal.timeout(WA_TIMEOUT_MS) });
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}
