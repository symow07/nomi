import type { MetaFetch } from '../meta/messaging.js';
import { REOPEN_BODY, REOPEN_TEMPLATE, type ReopenLanguage } from '../../core/channel/reopen.js';

/**
 * WA-S — the reopening template, asked of Meta and read back. Never throws:
 * a refusal or a silence is a status the owner reads. Built as if Tech
 * Provider status had passed; never run against Meta (the never-run list).
 *
 *   POST /{waba}/message_templates   — one language at a time, category UTILITY
 *                                      (a reply to the customer's own message)
 *   GET  /{waba}/message_templates   — its languages, each with Meta's status
 */
export const TEMPLATE_TIMEOUT_MS = 15_000;

type J = Record<string, unknown>;
const obj = (v: unknown): J => (typeof v === 'object' && v !== null ? v as J : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : null);
const WABA = /^[0-9]{5,30}$/;

export type SubmitOutcome =
  | { readonly ok: true; readonly id: string | null; readonly status: string }
  | { readonly ok: false; readonly reason: 'unavailable' | 'refused'; readonly detail: string | null };

export async function submitReopenTemplate(
  input: { readonly wabaId: string; readonly token: string; readonly graphVersion: string; readonly language: ReopenLanguage; readonly example: string },
  fetchImpl: MetaFetch,
): Promise<SubmitOutcome> {
  if (!WABA.test(input.wabaId)) return { ok: false, reason: 'refused', detail: null };
  try {
    const res = await fetchImpl(`https://graph.facebook.com/${input.graphVersion}/${input.wabaId}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: REOPEN_TEMPLATE, language: input.language, category: 'UTILITY',
        components: [{ type: 'BODY', text: REOPEN_BODY[input.language], example: { body_text: [[input.example]] } }],
      }),
      signal: AbortSignal.timeout(TEMPLATE_TIMEOUT_MS),
    });
    const text = await res.text().catch(() => '');
    let body: J = {};
    try { body = obj(JSON.parse(text)); } catch { /* not JSON */ }
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, id: str(body['id']), status: (str(body['status']) ?? 'PENDING').slice(0, 40) };
    }
    // Meta's own words for why, kept short: the owner reads a status, not this.
    const why = str(obj(body['error'])['error_user_msg']) ?? str(obj(body['error'])['message']);
    return { ok: false, reason: res.status >= 500 || res.status === 429 ? 'unavailable' : 'refused', detail: why ? why.slice(0, 200) : null };
  } catch {
    return { ok: false, reason: 'unavailable', detail: null };
  }
}

export type TemplateStatus = { readonly language: string; readonly status: string; readonly id: string | null; readonly reason: string | null };

/** Every language of the reopening template on this account, with Meta's status for each. Null when Meta does not answer. */
export async function reopenTemplateStatuses(
  input: { readonly wabaId: string; readonly token: string; readonly graphVersion: string }, fetchImpl: MetaFetch,
): Promise<readonly TemplateStatus[] | null> {
  if (!WABA.test(input.wabaId)) return null;
  try {
    const q = new URLSearchParams({ name: REOPEN_TEMPLATE, fields: 'name,language,status,id,rejected_reason', limit: '50' });
    const res = await fetchImpl(`https://graph.facebook.com/${input.graphVersion}/${input.wabaId}/message_templates?${q.toString()}`, {
      method: 'GET', headers: { Authorization: `Bearer ${input.token}` }, signal: AbortSignal.timeout(TEMPLATE_TIMEOUT_MS),
    });
    if (res.status < 200 || res.status >= 300) return null;
    const body = obj(JSON.parse(await res.text()));
    const list = Array.isArray(body['data']) ? body['data'] as unknown[] : [];
    return list.map(obj)
      .filter((t) => t['name'] === REOPEN_TEMPLATE)
      .flatMap((t) => {
        const language = str(t['language']); const status = str(t['status']);
        if (!language || !status) return [];
        const reason = str(t['rejected_reason']);
        return [{ language, status: status.slice(0, 40), id: str(t['id']), reason: reason && reason !== 'NONE' ? reason.slice(0, 200) : null }];
      });
  } catch {
    return null;
  }
}
