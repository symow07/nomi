import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { deriveHealth, type ChannelStatus } from '../../core/channel/health.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
import { formatRelative } from '../../core/owner/i18n/format.js';
import { validateOwnerPhone } from '../../pipeline/notify.js';
import { esc } from './layout.js';

/**
 * M9.4 + ADR-0008 — Channel Center. A VIEW + connection-STATE management over
 * the EXISTING channel layer (channels / channel_credentials / channel_audit)
 * reusing M3's deriveHealth. The read model is language-NEUTRAL — a status code,
 * a problem code, a raw timestamp; the renderer localizes. Actions return a
 * result CODE (no strings in the service); the route localizes the flash.
 * NEVER a secret on screen.
 */

const KIND = 'whatsapp';

type ChannelProblem = 'disconnected' | 'needs_relogin' | 'send_failing' | null;

/** deriveHealth's status → the owner-facing problem code (web page only; the
 *  core's Chinese OwnerProblem is left for the notification layer, P3). */
function problemFor(status: ChannelStatus): ChannelProblem {
  if (status === 'disconnected') return 'disconnected';
  if (status === 'needs_attention') return 'needs_relogin';
  if (status === 'degraded') return 'send_failing';
  return null;
}

/** 'not_connected' = never set up (web-only); distinct from owner-disconnected. */
type WebChannelStatus = ChannelStatus | 'not_connected';

export type ChannelView = {
  readonly kind: string;
  readonly connected: boolean;
  readonly status: WebChannelStatus;
  readonly healthOk: boolean;
  readonly displayId: string | null;          // masked phone only — never a secret
  readonly lastActivityAt: Date | null;
  readonly problem: ChannelProblem;
};

export type ChannelsData = { readonly whatsapp: ChannelView; readonly ownerPhone: string | null };

export async function loadChannels(
  db: Db, businessIdRaw: string, messagingEnabled: boolean,
): Promise<ChannelsData> {
  const bid = parseBusinessId(businessIdRaw);
  const notConnected: ChannelView = {
    kind: KIND, connected: false, status: 'not_connected', healthOk: false,
    displayId: null, lastActivityAt: null, problem: null,
  };
  if (!bid.ok) return { whatsapp: notConnected, ownerPhone: null };

  return withTenantTx(db, bid.value, async (tx) => {
    const ownerPhone = (await sql<{ p: string | null }>`
      select owner_phone as p from businesses where id = ${bid.value}`.execute(tx)).rows[0]?.p ?? null;
    const row = (await sql<{
      status: string; display_phone: string | null;
      last_inbound_at: Date | null; last_delivered_at: Date | null; last_webhook_at: Date | null;
      consecutive_send_failures: number; last_error: string | null; cred_active: boolean | null;
    }>`
      select ch.status, ch.display_phone, ch.last_inbound_at, ch.last_delivered_at,
             ch.last_webhook_at, ch.consecutive_send_failures, ch.last_error,
             (select bool_or(is_active) from channel_credentials cc
                where cc.business_id = ch.business_id and cc.channel = ${KIND}) as cred_active
        from channels ch where ch.kind = ${KIND} limit 1
    `.execute(tx)).rows[0];

    if (!row || !row.cred_active || !messagingEnabled || row.status === 'disconnected') {
      if (row?.status !== 'disconnected') return { whatsapp: notConnected, ownerPhone };
      const health = deriveHealth({
        credentialActive: false, connecting: false, disconnectedByOwner: true,
        lastInboundAt: row.last_inbound_at, lastDeliveredAt: row.last_delivered_at,
        lastWebhookAt: row.last_webhook_at, consecutiveSendFailures: row.consecutive_send_failures,
        lastError: row.last_error,
      }, '');
      return {
        whatsapp: {
          kind: KIND, connected: false, status: health.status, healthOk: false,
          displayId: row.display_phone, lastActivityAt: null, problem: problemFor(health.status),
        },
        ownerPhone,
      };
    }

    const health = deriveHealth({
      credentialActive: true, connecting: false, disconnectedByOwner: false,
      lastInboundAt: row.last_inbound_at, lastDeliveredAt: row.last_delivered_at,
      lastWebhookAt: row.last_webhook_at, consecutiveSendFailures: row.consecutive_send_failures,
      lastError: row.last_error,
    }, '');
    const lastAt = row.last_webhook_at ?? row.last_inbound_at ?? row.last_delivered_at;

    return {
      whatsapp: {
        kind: KIND,
        connected: health.status === 'connected' || health.status === 'degraded',
        status: health.status,
        healthOk: health.inboundOk && health.outboundOk,
        displayId: row.display_phone,
        lastActivityAt: lastAt,
        problem: problemFor(health.status),
      },
      ownerPhone,
    };
  });
}

/** ── Owner alert-destination setting (minimal action; validated + audited) ── */

export type OwnerPhoneResult = { readonly code: 'saved' | 'cleared' | 'invalid' };

export async function saveOwnerPhone(db: Db, businessIdRaw: string, rawPhone: string, actor: string): Promise<OwnerPhoneResult> {
  const v = validateOwnerPhone(rawPhone);
  if (!v.ok) return { code: 'invalid' };
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'invalid' };
  await withTenantTx(db, bid.value, async (tx) => {
    await sql`update businesses set owner_phone = ${v.value} where id = ${bid.value}`.execute(tx);
    // Audit: store only a last-4 (not the full number), never a secret.
    const detail = JSON.stringify(v.value ? { last4: v.value.slice(-4) } : { cleared: true });
    await sql`
      insert into channel_audit (business_id, channel_id, action, actor, detail)
      values (${bid.value}, (select id from channels where business_id = ${bid.value} and kind = ${KIND} limit 1),
              'set_owner_phone', ${actor}, ${detail}::jsonb)`.execute(tx);
  });
  return { code: v.value ? 'saved' : 'cleared' };
}

/** ── State actions — real effects on channel_credentials, audited ─────────── */

export type ChannelFlash =
  | 'nothing_to_connect' | 'no_credential'      // M20.4 (F-08)
  | 'disconnected' | 'reconnected' | 'test_ok' | 'test_degraded' | 'test_not_connected' | 'failed';
export type ChannelActionResult = { readonly code: ChannelFlash };

async function audit(tx: import('../../db/client.js').Tx, businessId: string, action: string, actor: string) {
  await sql`
    insert into channel_audit (business_id, channel_id, action, actor, detail)
    select ${businessId}, id, ${action}, ${actor}, '{}'::jsonb
      from channels where business_id = ${businessId} and kind = ${KIND}
  `.execute(tx);
}

export async function disconnectChannel(db: Db, businessIdRaw: string, actor: string): Promise<ChannelActionResult> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'failed' };
  await withTenantTx(db, bid.value, async (tx) => {
    await sql`update channel_credentials set is_active = false where business_id = ${bid.value} and channel = ${KIND}`.execute(tx);
    await sql`update channels set status = 'disconnected', disconnected_at = now(), updated_at = now() where business_id = ${bid.value} and kind = ${KIND}`.execute(tx);
    await audit(tx, bid.value, 'disconnect', actor);
  });
  return { code: 'disconnected' };
}

export async function reconnectChannel(db: Db, businessIdRaw: string, actor: string): Promise<ChannelActionResult> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'failed' };
  // M20.4 (F-08) — the M21 rehearsal got "已重新连接。小雅又开始接待了。" while the
  // channels table went from 0 rows to 0 rows: the UPDATE matched nothing and the
  // route reported success anyway. Report what the row ACTUALLY says afterwards.
  return withTenantTx(db, bid.value, async (tx) => {
    await sql`update channel_credentials set is_active = true where business_id = ${bid.value} and channel = ${KIND}`.execute(tx);
    await sql`update channels set status = 'connected', connected_at = now(), disconnected_at = null, updated_at = now() where business_id = ${bid.value} and kind = ${KIND}`.execute(tx);
    const row = (await sql<{ status: string; cred: boolean | null }>`
      select ch.status,
             (select bool_or(cc.is_active) from channel_credentials cc
               where cc.business_id = ch.business_id and cc.channel = ${KIND}) as cred
        from channels ch where ch.business_id = ${bid.value} and ch.kind = ${KIND} limit 1
    `.execute(tx)).rows[0];
    if (!row) return { code: 'nothing_to_connect' as const };       // no channel exists
    if (row.cred !== true) return { code: 'no_credential' as const }; // nothing to connect WITH
    await audit(tx, bid.value, 'reconnect', actor);
    return { code: 'reconnected' as const };
  });
}

export async function testChannel(db: Db, businessIdRaw: string, actor: string, messagingEnabled: boolean): Promise<ChannelActionResult> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'failed' };
  const data = await loadChannels(db, businessIdRaw, messagingEnabled);
  await withTenantTx(db, bid.value, (tx) => audit(tx, bid.value, 'test', actor));
  return {
    code: data.whatsapp.connected
      ? (data.whatsapp.healthOk ? 'test_ok' : 'test_degraded')
      : 'test_not_connected',
  };
}

/** Localize an action result for the flash — called by the route (has locale). */
export const channelFlash = (locale: Locale, code: ChannelFlash): string =>
  t(locale, `channel.flash.${code}` as MessageKey, { name: EMPLOYEE_NAME[locale] });

/** ── Renderers (pure, mobile-first, localized, no secrets) ────────────────── */

const COMING_SOON: readonly ({ literal: string } | { key: MessageKey })[] = [
  { literal: 'Instagram' }, { literal: 'Messenger' }, { literal: 'Telegram' },
  { key: 'channel.platform.wecom' }, { key: 'channel.platform.rednote' },
];

function problemBlock(locale: Locale, code: Exclude<ChannelProblem, null>): string {
  const name = EMPLOYEE_NAME[locale];
  const what = t(locale, `channel.problem.${code}.what` as MessageKey);
  const doing = t(locale, `channel.problem.${code}.doing` as MessageKey, { name });
  const youKey = `channel.problem.${code}.youDo` as MessageKey;
  const hasYou = code !== 'send_failing';
  const youDo = hasYou ? t(locale, youKey) : '';
  return `<div class="prob">${esc(what)}<br>${esc(doing)}${hasYou ? `<br><b>${esc(youDo)}</b>` : ''}</div>`;
}

export function renderChannels(data: ChannelsData, locale: Locale, flash: string | null): string {
  const w = data.whatsapp;
  const actions = w.connected
    ? `<form method="post" action="/app/channels/whatsapp/test" style="display:inline"><button class="btn">${esc(t(locale, 'channel.action.test'))}</button></form>
       <form method="post" action="/app/channels/whatsapp/disconnect" style="display:inline"><button class="btn danger">${esc(t(locale, 'channel.action.disconnect'))}</button></form>`
    : w.status === 'disconnected'
      ? `<form method="post" action="/app/channels/whatsapp/reconnect" style="display:inline"><button class="btn send">${esc(t(locale, 'channel.action.reconnect'))}</button></form>`
      : `<a class="btn send" href="/app/channels/whatsapp/connect">${esc(t(locale, 'channel.action.connect'))}</a>`;

  const pill = w.connected ? `${esc(t(locale, 'channel.status.connected'))} ✓` : esc(t(locale, `channel.status.${w.status}` as MessageKey));

  const whatsappCard = `
    <div class="card ch">
      <div class="ch-h"><span class="ch-name">📱 WhatsApp</span>
        <span class="pill ${w.connected ? 'ok' : 'warn'}">${pill}</span></div>
      <div class="muted ch-desc">${esc(t(locale, 'channel.whatsapp.desc'))}</div>
      ${w.connected ? `<div class="ch-info">
        ${w.displayId ? `<div><span class="muted">${esc(t(locale, 'channel.field.number'))}</span> ${esc(w.displayId)}</div>` : ''}
        ${w.lastActivityAt ? `<div><span class="muted">${esc(t(locale, 'channel.field.lastMessage'))}</span> ${esc(formatRelative(locale, w.lastActivityAt, new Date()))}</div>` : ''}
        <div><span class="muted">${esc(t(locale, 'channel.field.health'))}</span> ${esc(w.healthOk ? t(locale, 'channel.health.ok') : t(locale, 'channel.health.attention'))}</div>
      </div>` : ''}
      ${w.problem ? problemBlock(locale, w.problem) : ''}
      <div class="ch-acts">${actions}</div>
    </div>`;

  const alertsCard = `<div class="card">
    <h2>${esc(t(locale, 'settings.alerts.title'))}</h2>
    <p class="muted ch-desc">${esc(t(locale, 'settings.alerts.desc', { name: EMPLOYEE_NAME[locale] }))}</p>
    <form method="post" action="/app/settings/owner-phone" class="ownerform">
      <label class="muted" for="ownerphone">${esc(t(locale, 'settings.alerts.label'))}</label>
      <input id="ownerphone" name="phone" type="tel" inputmode="tel" value="${esc(data.ownerPhone ?? '')}" placeholder="${esc(t(locale, 'settings.alerts.placeholder'))}" />
      <button class="btn send">${esc(t(locale, 'settings.alerts.save'))}</button>
    </form>
    <p class="muted" style="font-size:var(--font-size-micro)">${data.ownerPhone ? esc(t(locale, 'settings.alerts.current', { phone: data.ownerPhone })) : esc(t(locale, 'settings.alerts.none'))}</p>
  </div>`;

  const soon = `<div class="card">
    <h2>${esc(t(locale, 'channel.soon.title'))}</h2>
    <div class="soon">${COMING_SOON.map((c) => `<span class="soon-chip">${esc('literal' in c ? c.literal : t(locale, c.key))}</span>`).join('')}</div>
    <p class="muted">${esc(t(locale, 'channel.soon.note'))}</p>
  </div>`;

  return `<h1 class="page">${esc(t(locale, 'nav.channels'))}</h1>
    ${flash ? `<div class="flash" role="status">${esc(flash)}</div>` : ''}
    ${whatsappCard}
    ${alertsCard}
    ${soon}
    <p class="muted" style="font-size:var(--font-size-micro)">${esc(t(locale, 'channel.footer'))}</p>
    ${CHANNELS_STYLE}`;
}

export function renderConnectGuide(locale: Locale): string {
  const name = EMPLOYEE_NAME[locale];
  return `<h1 class="page">${esc(t(locale, 'channel.connect.title'))}</h1>
    <div class="card">
      <p>${esc(t(locale, 'channel.connect.intro', { name }))}</p>
      <ol class="guide">
        <li>${esc(t(locale, 'channel.connect.step1'))}</li>
        <li>${esc(t(locale, 'channel.connect.step2'))}</li>
        <li>${esc(t(locale, 'channel.connect.step3'))}</li>
      </ol>
      <p class="muted">${esc(t(locale, 'channel.connect.note'))}</p>
      <a class="btn send" href="/app/channels">${esc(t(locale, 'channel.connect.back'))}</a>
    </div>${CHANNELS_STYLE}`;
}

const CHANNELS_STYLE = `<style>
  .ch-h { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .ch-name { font-size:var(--font-size-small); font-weight:700; }
  .ch-desc { font-size:var(--font-size-caption); margin:6px 0 12px; }
  .ch-info { display:flex; flex-direction:column; gap:6px; background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px; padding:12px; font-size:var(--font-size-note); margin-bottom:12px; }
  .ch-acts { display:flex; gap:8px; flex-wrap:wrap; }
  .prob { background:var(--color-waiting-wash); color:var(--color-waiting); border-radius:10px; padding:12px; font-size:var(--font-size-note); margin-bottom:12px; line-height:1.6; }
  .ownerform { display:flex; flex-direction:column; gap:6px; margin-bottom:8px; }
  .ownerform input { background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px; color:var(--color-ink); padding:10px 14px; font:inherit; }
  .soon { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px; }
  .soon-chip { background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:999px; padding:6px 14px; color:var(--color-ink-secondary); font-size:var(--font-size-caption); }
  .guide { padding-inline-start:20px; line-height:2; } .guide li { margin-bottom:4px; }
</style>`;
