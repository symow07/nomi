import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { deriveHealth, CHANNEL_STATUS_ZH, type OwnerProblem } from '../../core/channel/health.js';
import { formatWhenZh } from '../../core/owner/format.js';
import { esc } from './layout.js';

/**
 * M9.4 — Channel Center. A VIEW + connection-STATE management over the
 * EXISTING channel layer (channels / channel_credentials / channel_audit,
 * migration 0011) reusing M3's deriveHealth and owner-facing status words.
 * No new channel model, no channel-specific business logic, no duplicated
 * webhook/normalization/outbound logic, and NEVER a secret on screen.
 *
 * The provider-neutral connection concept is the existing `channels` row;
 * "connect" for a real Meta channel is env-provisioned for the pilot, so the
 * owner-facing controls here are the state ones (test / disconnect /
 * reconnect) — real effects (credential is_active) recorded in channel_audit.
 */

const KIND = 'whatsapp';

export type ChannelView = {
  readonly kind: string;
  readonly nameZh: string;
  readonly descZh: string;
  readonly connected: boolean;
  readonly statusZh: string;
  readonly healthOk: boolean;
  readonly displayId: string | null;      // masked phone only — never a secret
  readonly lastActivityZh: string | null;
  readonly problem: OwnerProblem | null;   // owner language, three parts
};

export type ChannelsData = {
  readonly whatsapp: ChannelView;
  /** Honest: not wired yet. No fake connect, no pretend-connected. */
  readonly comingSoon: readonly string[];
};

export async function loadChannels(
  db: Db, businessIdRaw: string, employeeName: string, messagingEnabled: boolean,
): Promise<ChannelsData> {
  const comingSoon = ['Instagram', 'Messenger', 'Telegram', '企业微信', '小红书'];
  const bid = parseBusinessId(businessIdRaw);
  const notConnected: ChannelView = {
    kind: KIND, nameZh: 'WhatsApp', descZh: '接收客户消息并自动回复',
    connected: false, statusZh: '未连接', healthOk: false,
    displayId: null, lastActivityZh: null, problem: null,
  };
  if (!bid.ok) return { whatsapp: notConnected, comingSoon };

  return withTenantTx(db, bid.value, async (tx) => {
    // Read connection state — no secret columns are selected.
    const row = (await sql<{
      status: string; display_phone: string | null;
      last_inbound_at: Date | null; last_delivered_at: Date | null; last_webhook_at: Date | null;
      consecutive_send_failures: number; last_error: string | null;
      cred_active: boolean | null;
    }>`
      select ch.status, ch.display_phone, ch.last_inbound_at, ch.last_delivered_at,
             ch.last_webhook_at, ch.consecutive_send_failures, ch.last_error,
             (select bool_or(is_active) from channel_credentials cc
                where cc.business_id = ch.business_id and cc.channel = ${KIND}) as cred_active
        from channels ch where ch.kind = ${KIND} limit 1
    `.execute(tx)).rows[0];

    // No row, no active credential, or messaging not enabled by the deployment
    // → honestly "未连接" (never pretend-connected).
    if (!row || !row.cred_active || !messagingEnabled || row.status === 'disconnected') {
      const disconnectedByOwner = row?.status === 'disconnected';
      if (!disconnectedByOwner) return { whatsapp: notConnected, comingSoon };
      const health = deriveHealth({
        credentialActive: false, connecting: false, disconnectedByOwner: true,
        lastInboundAt: row?.last_inbound_at ?? null, lastDeliveredAt: row?.last_delivered_at ?? null,
        lastWebhookAt: row?.last_webhook_at ?? null, consecutiveSendFailures: row?.consecutive_send_failures ?? 0,
        lastError: row?.last_error ?? null,
      }, employeeName);
      return {
        whatsapp: {
          kind: KIND, nameZh: 'WhatsApp', descZh: '接收客户消息并自动回复',
          connected: false, statusZh: CHANNEL_STATUS_ZH[health.status], healthOk: false,
          displayId: row?.display_phone ?? null, lastActivityZh: null, problem: health.problem,
        },
        comingSoon,
      };
    }

    const health = deriveHealth({
      credentialActive: true, connecting: false, disconnectedByOwner: false,
      lastInboundAt: row.last_inbound_at, lastDeliveredAt: row.last_delivered_at,
      lastWebhookAt: row.last_webhook_at, consecutiveSendFailures: row.consecutive_send_failures,
      lastError: row.last_error,
    }, employeeName);
    const lastAt = row.last_webhook_at ?? row.last_inbound_at ?? row.last_delivered_at;

    return {
      whatsapp: {
        kind: KIND, nameZh: 'WhatsApp', descZh: '接收客户消息并自动回复',
        connected: health.status === 'connected' || health.status === 'degraded',
        statusZh: CHANNEL_STATUS_ZH[health.status],
        healthOk: health.inboundOk && health.outboundOk,
        displayId: row.display_phone,                     // already masked at write time
        lastActivityZh: lastAt ? formatWhenZh(lastAt, new Date()) : null,
        problem: health.problem,
      },
      comingSoon,
    };
  });
}

/** ── State actions — real effects on channel_credentials, audited ───────── */

export type ChannelActionResult = { readonly messageZh: string };

async function audit(tx: import('../../db/client.js').Tx, businessId: string, action: string, actor: string) {
  await sql`
    insert into channel_audit (business_id, channel_id, action, actor, detail)
    select ${businessId}, id, ${action}, ${actor}, '{}'::jsonb
      from channels where business_id = ${businessId} and kind = ${KIND}
  `.execute(tx);
}

export async function disconnectChannel(db: Db, businessIdRaw: string, actor: string): Promise<ChannelActionResult> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { messageZh: '操作失败。' };
  await withTenantTx(db, bid.value, async (tx) => {
    // Real effect: resolve_tenant filters is_active, so inbound stops.
    await sql`update channel_credentials set is_active = false where business_id = ${bid.value} and channel = ${KIND}`.execute(tx);
    await sql`update channels set status = 'disconnected', disconnected_at = now(), updated_at = now() where business_id = ${bid.value} and kind = ${KIND}`.execute(tx);
    await audit(tx, bid.value, 'disconnect', actor);
  });
  return { messageZh: '已断开。小雅暂时不再接收新消息，想恢复点「重新连接」。' };
}

export async function reconnectChannel(db: Db, businessIdRaw: string, actor: string): Promise<ChannelActionResult> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { messageZh: '操作失败。' };
  await withTenantTx(db, bid.value, async (tx) => {
    await sql`update channel_credentials set is_active = true where business_id = ${bid.value} and channel = ${KIND}`.execute(tx);
    await sql`update channels set status = 'connected', connected_at = now(), disconnected_at = null, updated_at = now() where business_id = ${bid.value} and kind = ${KIND}`.execute(tx);
    await audit(tx, bid.value, 'reconnect', actor);
  });
  return { messageZh: '已重新连接。小雅又开始接待了。' };
}

export async function testChannel(db: Db, businessIdRaw: string, actor: string, messagingEnabled: boolean): Promise<ChannelActionResult> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { messageZh: '操作失败。' };
  const data = await loadChannels(db, businessIdRaw, '小雅', messagingEnabled);
  await withTenantTx(db, bid.value, (tx) => audit(tx, bid.value, 'test', actor));
  return {
    messageZh: data.whatsapp.connected
      ? (data.whatsapp.healthOk ? '连接正常，可以开始接待客户。' : '能连上，但最近发送不太顺，正在自动修复。')
      : '还没连上，点「连接」按引导开通。',
  };
}

/** ── Renderers (pure, mobile-first, owner language, no secrets) ──────────── */

const problemBlock = (p: OwnerProblem): string =>
  `<div class="prob">${esc(p.whatHappened)}<br>${esc(p.beingDone)}${p.whatYouDo ? `<br><b>${esc(p.whatYouDo)}</b>` : ''}</div>`;

export function renderChannels(data: ChannelsData, flash: string | null): string {
  const w = data.whatsapp;
  const actions = w.connected
    ? `<form method="post" action="/app/channels/whatsapp/test" style="display:inline"><button class="btn">测试连接</button></form>
       <form method="post" action="/app/channels/whatsapp/disconnect" style="display:inline"><button class="btn danger">断开</button></form>`
    : w.statusZh === '已断开'
      ? `<form method="post" action="/app/channels/whatsapp/reconnect" style="display:inline"><button class="btn send">重新连接</button></form>`
      : `<a class="btn send" href="/app/channels/whatsapp/connect">连接</a>`;

  const whatsappCard = `
    <div class="card ch">
      <div class="ch-h"><span class="ch-name">📱 WhatsApp</span>
        <span class="pill ${w.connected ? 'ok' : 'warn'}">${w.connected ? '已连接 ✓' : esc(w.statusZh)}</span></div>
      <div class="muted ch-desc">${esc(w.descZh)}</div>
      ${w.connected ? `<div class="ch-info">
        ${w.displayId ? `<div><span class="muted">号码</span> ${esc(w.displayId)}</div>` : ''}
        ${w.lastActivityZh ? `<div><span class="muted">最近消息</span> ${esc(w.lastActivityZh)}</div>` : ''}
        <div><span class="muted">健康</span> ${w.healthOk ? '正常' : '需要注意'}</div>
      </div>` : ''}
      ${w.problem ? problemBlock(w.problem) : ''}
      <div class="ch-acts">${actions}</div>
    </div>`;

  const soon = `<div class="card">
    <h2>即将支持</h2>
    <div class="soon">${data.comingSoon.map((c) => `<span class="soon-chip">${esc(c)}</span>`).join('')}</div>
    <p class="muted">想先用哪个？回复告诉我们，我们优先开通。</p>
  </div>`;

  return `<h1 class="page">销售渠道</h1>
    ${flash ? `<div class="flash" role="status">${esc(flash)}</div>` : ''}
    ${whatsappCard}
    ${soon}
    <p class="muted" style="font-size:12px">连接只管接待客户，不会看你手机里的其他聊天，也不会不经审批动价格。</p>
    ${CHANNELS_STYLE}`;
}

export function renderConnectGuide(): string {
  return `<h1 class="page">连接 WhatsApp</h1>
    <div class="card">
      <p>连接后，买家发到你 WhatsApp 的消息，小雅就能看到并起草回复，发不发你说了算。</p>
      <ol class="guide">
        <li>把接待客户用的 WhatsApp 号码告诉我们</li>
        <li>我们帮你连一次，大约两分钟</li>
        <li>连好后自动发一条测试消息，你就能开始接待</li>
      </ol>
      <p class="muted">首次连接由我们协助完成，之后连接的开关、测试、断开都在这个页面，你自己管理。全程你看不到、也不用管任何密码或技术设置。</p>
      <a class="btn send" href="/app/channels">← 回渠道页</a>
    </div>${CHANNELS_STYLE}`;
}

const CHANNELS_STYLE = `<style>
  .ch-h { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .ch-name { font-size:16px; font-weight:700; }
  .ch-desc { font-size:13px; margin:6px 0 12px; }
  .ch-info { display:flex; flex-direction:column; gap:6px; background:#0f1216; border:1px solid #23272e; border-radius:10px; padding:12px; font-size:14px; margin-bottom:12px; }
  .ch-acts { display:flex; gap:8px; flex-wrap:wrap; }
  .prob { background:#2e2413; color:#fbbf24; border-radius:10px; padding:12px; font-size:14px; margin-bottom:12px; line-height:1.6; }
  .btn { padding:10px 18px; border:0; border-radius:9px; background:#2a313c; color:#fff; font-size:14px; font-weight:600; cursor:pointer; text-decoration:none; display:inline-block; }
  .btn.send { background:#2563eb; } .btn.send:hover { background:#1d4ed8; } .btn.danger { background:#3a2020; color:#f8b4b4; }
  .pill { display:inline-block; padding:4px 12px; border-radius:999px; font-size:13px; font-weight:600; white-space:nowrap; }
  .pill.ok { background:#0f2e1c; color:#4ade80; } .pill.warn { background:#2e2413; color:#fbbf24; }
  .soon { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px; }
  .soon-chip { background:#0f1216; border:1px solid #23272e; border-radius:999px; padding:6px 14px; color:#8b929c; font-size:13px; }
  .flash { background:#0f2e1c; color:#4ade80; border-radius:10px; padding:10px 14px; margin-bottom:14px; font-size:14px; }
  .guide { padding-left:20px; line-height:2; } .guide li { margin-bottom:4px; }
  button:focus-visible, a:focus-visible { outline:2px solid #60a5fa; outline-offset:2px; }
</style>`;
