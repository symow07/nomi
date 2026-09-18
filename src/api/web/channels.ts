import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { maskPhone } from '../../core/channel/phone.js';
import { deriveHealth, type ChannelStatus } from '../../core/channel/health.js';
import {
  CHANNEL_REGISTRY, OUTREACH_CHANNELS, mayInitiate,
  type OutreachChannel, type Requirement,
} from '../../core/channel/registry.js';
import type { TemplateState } from '../../core/channel/window.js';
import { satisfiedRequirements } from '../../core/channel/requirements.js';
import { canBeEnabled, outreachSettings, setOutreach } from '../../db/outreach.js';
import { DAILY_OUTREACH_CEILING } from '../../core/channel/limits.js';
import { sendingDomain, type SendingDomain } from '../../db/sendingDomain.js';
import {
  DNS_RECORDS, mayUseDomain, recordHost, type DnsRecordKind,
} from '../../core/outreach/domain.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
import { formatRelative } from '../../core/owner/i18n/format.js';
import { validateOwnerPhone } from '../../pipeline/notify.js';
import { META_SHAPE } from '../../core/channel/metaReadiness.js';
import { esc } from './layout.js';
import { OWNER_VIEW, type Viewer } from '../../core/conversation/people.js';

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
  /** M34.10 — masked at RENDER by `maskPhone`, not trusted to have been
   *  masked at write. Never a full number, whatever the column holds. */
  readonly displayId: string | null;
  readonly lastActivityAt: Date | null;
  readonly problem: ChannelProblem;
};

export type ChannelsData = {
  readonly whatsapp: ChannelView;
  readonly ownerPhone: string | null;
  /** M39 — resolved at boot from the provider and the approved-template list. */
  readonly templateState: TemplateState;
  /** M42 — her decision to write first, per channel. Absent means NOT enabled. */
  readonly outreach: ReadonlyMap<OutreachChannel, boolean>;
  /** C4.a — the most first messages a day she has said, per channel. Null or
   *  absent means she has stated none and the default applies. */
  readonly outreachCaps?: ReadonlyMap<OutreachChannel, number | null>;
  /** M40.1 — the domain her mail leaves as, and the last look at its records. */
  readonly domain: SendingDomain | null;
  /**
   * G3 — this installation has a WhatsApp number configured and this factory
   * has never been connected to one, so "Connect this number" can do it here
   * instead of pointing at a guide. Absent reads as false: the guide.
   */
  readonly canConnect?: boolean;
};

const NO_OUTREACH: ReadonlyMap<OutreachChannel, boolean> = new Map();

export async function loadChannels(
  db: Db, businessIdRaw: string, messagingEnabled: boolean,
  // M39 — resolved at boot, not here: `templateState()` reads the provider and
  // the approved-template list, and asking it twice is how two answers start.
  templateState: TemplateState = 'none',
  /** G3 — the number this installation is configured with, when it has one. */
  connectableNumber: string | null = null,
): Promise<ChannelsData> {
  const bid = parseBusinessId(businessIdRaw);
  const notConnected: ChannelView = {
    kind: KIND, connected: false, status: 'not_connected', healthOk: false,
    displayId: null, lastActivityAt: null, problem: null,
  };
  if (!bid.ok) return { whatsapp: notConnected, ownerPhone: null, templateState, outreach: NO_OUTREACH, domain: null, canConnect: false };

  return withTenantTx(db, bid.value, async (tx) => {
    const settings = await outreachSettings(tx, bid.value);
    const outreach = new Map([...settings].map(([k, v]) => [k, v.enabled] as const));
    const outreachCaps = new Map([...settings].map(([k, v]) => [k, v.dailyCap] as const));
    const domain = await sendingDomain(tx, bid.value);
    // G3 — Connect creates the credential; Reconnect reactivates one. Any row
    // at all, active or not, means this factory has been connected before.
    const hasCredential = (await sql<{ n: number }>`
      select count(*)::int as n from channel_credentials
       where business_id = ${bid.value} and channel = ${KIND}
    `.execute(tx)).rows[0]!.n > 0;
    const canConnect = messagingEnabled && connectableNumber !== null && !hasCredential;
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
      if (row?.status !== 'disconnected') return { whatsapp: notConnected, ownerPhone, templateState, outreach, outreachCaps, domain, canConnect };
      const health = deriveHealth({
        credentialActive: false, connecting: false, disconnectedByOwner: true,
        lastInboundAt: row.last_inbound_at, lastDeliveredAt: row.last_delivered_at,
        lastWebhookAt: row.last_webhook_at, consecutiveSendFailures: row.consecutive_send_failures,
        lastError: row.last_error,
      }, '');
      return {
        whatsapp: {
          kind: KIND, connected: false, status: health.status, healthOk: false,
          displayId: maskPhone(row.display_phone), lastActivityAt: null, problem: problemFor(health.status),
        },
        ownerPhone, templateState, outreach, outreachCaps, domain, canConnect,
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
        displayId: maskPhone(row.display_phone),
        lastActivityAt: lastAt,
        problem: problemFor(health.status),
      },
      ownerPhone, templateState, outreach, outreachCaps, domain, canConnect,
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
  | 'disconnected' | 'reconnected' | 'test_ok' | 'test_degraded' | 'test_not_connected' | 'failed'
  // G3 — connecting the configured number.
  | 'connected' | 'already_connected' | 'number_taken' | 'not_configured';
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

/**
 * G3 — connect the WhatsApp number this installation is configured with.
 *
 * ── WHY THIS DID NOT EXIST, AND WHAT IT COST ──────────────────────────────
 *
 * An inbound message is matched to a factory by `resolve_tenant`, which reads
 * `channel_credentials`. Nothing in the product ever wrote that table: only the
 * demo seed did. So on the day a real factory went live, every buyer message
 * would have been acknowledged to Meta and dropped (src/main.ts, "unknown
 * credential: ack, never process"), and the Connect button led to a page of
 * steps with no action on it. Activation could not work either: it updates a
 * `channels` row that nothing had created.
 *
 * ── WHAT IT WRITES, AND WHAT IT DOES NOT ─────────────────────────────────
 *
 * The number comes from the HOST's configuration, validated at boot, never
 * from the form — so this route can only ever connect the number the operator
 * set up, and a crafted post cannot claim someone else's. The secret stays in
 * the host environment; `secret_ref` names where it lives rather than holding
 * it (ADR-0005 §4–5: a database backup must never be a credential dump).
 *
 * One tenant transaction: the credential, the channel, the audit row. The
 * credential's key is unique across ALL businesses, and another factory's row
 * is invisible here under RLS — so a number held elsewhere surfaces as
 * `number_taken` from ON CONFLICT, not as an error page.
 *
 * Connecting is not activating. Messages start arriving; she still sends
 * nothing until the owner activates the channel, as before.
 */
export async function connectConfiguredNumber(
  db: Db, businessIdRaw: string, actor: string, phoneNumberId: string | null,
): Promise<ChannelActionResult> {
  if (phoneNumberId === null || !META_SHAPE.phoneNumberId(phoneNumberId)) return { code: 'not_configured' };
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'failed' };
  return withTenantTx(db, bid.value, async (tx) => {
    const existing = (await sql<{ n: number }>`
      select count(*)::int as n from channel_credentials
       where business_id = ${bid.value} and channel = ${KIND}
    `.execute(tx)).rows[0]!.n;
    // Connected before: that is Reconnect's job, which reactivates what exists.
    if (existing > 0) return { code: 'already_connected' as const };

    const cred = (await sql<{ id: string }>`
      insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
      values (${bid.value}, ${KIND}, ${phoneNumberId}, 'env:META_WHATSAPP_ACCESS_TOKEN', 'service')
      on conflict (channel, external_ref) do nothing
      returning id
    `.execute(tx)).rows[0];
    if (!cred) return { code: 'number_taken' as const };

    await sql`
      insert into channels (business_id, kind, status, credential_id, connected_at, disconnected_at, updated_at)
      values (${bid.value}, ${KIND}, 'connected', ${cred.id}::uuid, now(), null, now())
      on conflict (business_id, kind) do update
        set status = 'connected', credential_id = excluded.credential_id,
            connected_at = now(), disconnected_at = null, updated_at = now()
    `.execute(tx);
    await audit(tx, bid.value, 'connect', actor);
    return { code: 'connected' as const };
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

/**
 * M39 — Instagram and Messenger are NO LONGER HERE, and that is a correction.
 *
 * "Coming soon" sat eight lines under a section stating that neither can be
 * written to first, ever. For those two the missing part is not time, and a
 * chip promising otherwise is exactly the dishonesty this milestone exists to
 * remove — sitting on the same page as the fix. What is genuinely coming for
 * them is the inbound story, which the reach section states in full.
 *
 * The rest stay: for Telegram, WeCom and RED the missing part really is time.
 */
const COMING_SOON: readonly ({ literal: string } | { key: MessageKey })[] = [
  { literal: 'Telegram' },
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

/**
 * M39 — the truth about each channel, BEFORE she connects one.
 *
 * Every row is derived by asking `mayInitiate`, never by reading the table
 * beside it. That is what keeps the page and the gate the same answer: when
 * M42 refuses a send it refuses for the reason printed here, because it is the
 * same call.
 */
/**
 * M40.1 — the exact records to add, and what we last saw at each host.
 *
 * The host is DERIVED from her domain and selector by the same `recordHost` the
 * lookup uses, so what she is told to create and what we go looking for cannot
 * be two different names.
 */
export function renderDomain(
  locale: Locale, domain: SendingDomain | null, now: Date = new Date(), viewer: Viewer = OWNER_VIEW,
): string {
  // G9a — the domain is hers to set and to check (the routes are owner-only).
  const form = (d: SendingDomain | null) => viewer.isOwner
    ? domainForm(locale, d) : `<p class="muted">${esc(t(locale, 'staff.ownerDecides'))}</p>`;
  if (!domain) {
    return `<div class="dom">
      <p class="muted">${esc(t(locale, 'domain.none'))}</p>
      ${form(null)}
    </div>`;
  }
  const verdict = mayUseDomain({ check: domain.check, checkedAt: domain.checkedAt }, now);
  const rows = DNS_RECORDS.map((kind: DnsRecordKind) => {
    const state = domain.check?.[kind] ?? null;
    const done = state === 'ok';
    return `<li>
      <span class="pill ${done ? 'ok' : 'warn'}">${esc(t(locale,
        done ? 'reach.req.ready' : 'reach.req.waiting'))}</span>
      <span class="k">${esc(t(locale, `domain.record.${kind}` as MessageKey))}</span>
      <code class="host">${esc(recordHost(kind, domain.domain, domain.dkimSelector))}</code>
      ${state && !done ? `<span class="muted">·&nbsp;${esc(t(locale, `domain.state.${state}` as MessageKey))}</span>` : ''}
    </li>`;
  }).join('');

  const said = verdict.ok
    ? t(locale, 'domain.ready')
    : verdict.error.kind === 'never_checked' ? t(locale, 'domain.neverChecked')
      : verdict.error.kind === 'stale' ? t(locale, 'domain.stale',
        { date: formatRelative(locale, verdict.error.checkedAt, now) })
        : t(locale, 'domain.incomplete');

  return `<div class="dom">
    <div class="dom-h"><code class="who"><bdi>${esc(domain.domain)}</bdi></code>
      <span class="pill ${verdict.ok ? 'ok' : 'warn'}">${esc(said)}</span></div>
    <p class="muted">${esc(t(locale, 'domain.intro'))}</p>
    <ul class="dns">${rows}</ul>
    ${viewer.isOwner ? `<form method="post" action="/app/channels/domain/check" class="inline">
      <button class="btn" type="submit">${esc(t(locale, 'domain.check'))}</button>
    </form>` : ''}
    ${form(domain)}
  </div>`;
}

function domainForm(locale: Locale, domain: SendingDomain | null): string {
  return `<form method="post" action="/app/channels/domain" class="domform">
    <label class="fld"><span class="muted">${esc(t(locale, 'domain.field.domain'))}</span>
      <input name="domain" required maxlength="253" value="${esc(domain?.domain ?? '')}"
        placeholder="${esc(t(locale, 'domain.field.placeholder'))}" /></label>
    <label class="fld"><span class="muted">${esc(t(locale, 'domain.field.selector'))}</span>
      <input name="selector" maxlength="63" value="${esc(domain?.dkimSelector ?? '')}" /></label>
    <button class="btn send" type="submit">${esc(t(locale, 'domain.save'))}</button>
  </form>`;
}

/**
 * C4.a — HER CEILING, on the card that holds the switch.
 *
 * `outreach_settings.daily_cap` is read by the send path the moment e-mail can
 * leave; a column the send path obeys and nothing lets her set would be her
 * rule written by someone else. Empty means "the default", said on the form
 * with the number, so she is never capped by a figure she cannot see.
 *
 * Its own small form, not a field inside the switch's: pressing "stop writing
 * first" must not also submit whatever half-typed number sits beside it.
 *
 * Shown only where a first message can actually go. The first screenshot put a
 * "most a day" box on the WhatsApp card, whose requirements are not met, and a
 * limit on something that cannot happen is a control connected to nothing.
 */
function capForm(locale: Locale, channel: OutreachChannel, cap: number | null): string {
  return `<form method="post" action="/app/channels/outreach/cap" class="inline capform">
    <input type="hidden" name="channel" value="${esc(channel)}" />
    <label class="fld"><span class="muted">${esc(t(locale, 'outreach.cap.label'))}</span>
      <input name="cap" type="number" inputmode="numeric" min="1" max="10000" step="1"
        value="${cap === null ? '' : String(cap)}" placeholder="${String(DAILY_OUTREACH_CEILING)}" /></label>
    <span class="muted cap-hint">${esc(t(locale, 'outreach.cap.hint', { n: String(DAILY_OUTREACH_CEILING) }))}</span>
    <button class="btn" type="submit">${esc(t(locale, 'outreach.cap.save'))}</button>
  </form>`;
}

export function renderReach(
  locale: Locale, satisfied: ReadonlySet<Requirement>,
  enabled: ReadonlyMap<OutreachChannel, boolean> = new Map(),
  domain: SendingDomain | null = null,
  viewer: Viewer = OWNER_VIEW,
  caps: ReadonlyMap<OutreachChannel, number | null> = new Map(),
  /**
   * C9 — the channels a buyer STARTS: whether the host has an account for one,
   * and whether this business has connected it. Only these two states exist
   * here; there is no activation switch, because there is no cold message to
   * hold back on a channel that can only answer.
   */
  inbound: ReadonlyMap<OutreachChannel, InboundLink> = new Map(),
): string {
  const rows = OUTREACH_CHANNELS.map((channel: OutreachChannel) => {
    const cap = CHANNEL_REGISTRY[channel];
    const decision = mayInitiate(channel, satisfied);
    const tone = decision.ok ? 'ok' : decision.error.kind === 'never' ? 'stop' : 'warn';
    const headline = decision.ok
      ? t(locale, 'reach.cold.open')
      : decision.error.kind === 'never'
        ? t(locale, 'reach.cold.never')
        : t(locale, 'reach.cold.conditional');

    // What is still outstanding, and what is already done — both, because a
    // list of only the gaps reads as a wall and hides the progress she made.
    const reqs = cap.requires.length === 0 ? '' : `<ul class="reqs">${cap.requires.map((r) => {
      const done = satisfied.has(r);
      return `<li><span class="pill ${done ? 'ok' : 'warn'}">${esc(t(locale,
        done ? 'reach.req.ready' : 'reach.req.waiting'))}</span> ${esc(t(locale, `reach.req.${r}` as MessageKey))}</li>`;
    }).join('')}</ul>`;

    const instead = cap.instead.length === 0 ? '' : `
      <div class="instead"><span class="muted">${esc(t(locale, 'reach.instead.title'))}</span>
        <ul>${cap.instead.map((i) =>
          `<li>${esc(t(locale, `reach.instead.${i}` as MessageKey))}</li>`).join('')}</ul></div>`;

    // What the channel allows is not what this product can do yet.
    const notHere = cap.availableHere ? '' :
      `<div class="muted win">${esc(t(locale, 'reach.notHere'))}</div>`;

    /**
     * C9 — connecting the account buyers write to. Shown only where answering
     * is the whole story (`coldInitiate: 'never'`), so it can never be mistaken
     * for a way to start a conversation. Without an account in the host's
     * settings there is no button, for the reason there is no Connect button
     * for a mail app this installation has no client for.
     */
    const link = inbound.get(channel);
    /**
     * C10 — connected through Meta's login, it says AS WHOM, and the owner can
     * disconnect it here; a token Meta refused says so and offers the login
     * again. Connecting goes to the login when this installation offers one,
     * else (C9) posts the host's own account.
     */
    const loginButton = (key: 'reach.inbound.connectMeta' | 'reach.inbound.connect') => viewer.isOwner
      ? (link?.connectHref
        ? `<a class="btn send" href="${esc(link.connectHref)}">${esc(t(locale, key))}</a>`
        : `<form method="post" action="/app/channels/${esc(channel)}/connect" class="inline">
            <button class="btn send" type="submit">${esc(t(locale, 'reach.inbound.connect'))}</button></form>`)
      : `<div class="muted win">${esc(t(locale, 'staff.ownerDecides'))}</div>`;
    const connect = cap.coldInitiate !== 'never' || !cap.availableHere || !link?.configured ? ''
      : link.connected
        ? `<div class="muted win">${esc(t(locale, 'reach.inbound.connected', { name: EMPLOYEE_NAME[locale] }))}</div>
          ${link.connectedAs ? `<div class="muted win">${esc(t(locale, 'reach.inbound.connectedAs', { page: link.connectedAs }))}</div>` : ''}
          ${link.needsAttention ? `<div class="warn-line">${esc(t(locale, 'reach.inbound.attention'))}</div>${loginButton('reach.inbound.connectMeta')}` : ''}
          ${!link.connectedAs && !link.needsAttention && link.connectHref && viewer.isOwner
            // Connected through the HOST's account (C9), with the login now
            // offered: she may still connect her own Page here, and the row
            // moves from the environment's account to hers.
            ? loginButton('reach.inbound.connectMeta') : ''}
          ${link.connectedAs && viewer.isOwner && !link.needsAttention
            ? `<form method="post" action="/app/connect/meta/disconnect" class="inline">
                <button class="btn" type="submit">${esc(t(locale, 'reach.inbound.disconnect'))}</button></form>` : ''}`
        : `${link.noInstagram ? `<div class="muted win">${esc(t(locale, 'reach.inbound.noInstagram'))}</div>` : ''}
          ${loginButton(link.connectHref ? 'reach.inbound.connectMeta' : 'reach.inbound.connect')}`;

    const window = cap.replyWindowHours === null ? '' :
      `<div class="muted win">${esc(t(locale, 'reach.window', { hours: String(cap.replyWindowHours) }))}</div>`;

    /**
     * M42 — her decision, on the card that just told her what the channel
     * allows. Offered ONLY where an uninvited message is possible at all: a
     * switch that changes nothing is worse than no switch, and Instagram is
     * exactly where an owner would expect one to work.
     *
     * The warning is not fine print and is not conditional on her clicking
     * anything. She is about to accept that a first message to someone who
     * never asked can cost her the number permanently, and that sentence
     * belongs on the screen where the decision is made.
     */
    const on = enabled.get(channel) === true;
    // G9a — the switch is hers; a sales assistant sees the state, not the switch.
    const toggle = !canBeEnabled(channel) ? '' : !viewer.isOwner
      ? `<div class="outreach"><span class="${on ? 'on' : 'muted'}">${esc(t(locale, on ? 'outreach.on' : 'outreach.off'))}</span></div>`
      : `
      <div class="outreach">
        <span class="${on ? 'on' : 'muted'}">${esc(t(locale, on ? 'outreach.on' : 'outreach.off'))}</span>
        ${channel === 'whatsapp' && !on
          ? `<p class="muted warn-line">${esc(t(locale, 'outreach.warn.whatsapp'))}</p>` : ''}
        <form method="post" action="/app/channels/outreach" class="inline">
          <input type="hidden" name="channel" value="${esc(channel)}" />
          <input type="hidden" name="enabled" value="${on ? 'false' : 'true'}" />
          <button class="btn ${on ? 'stop' : 'send'}" type="submit"
            >${esc(t(locale, on ? 'outreach.turnOff' : 'outreach.turnOn'))}</button>
        </form>
        ${decision.ok ? capForm(locale, channel, caps.get(channel) ?? null) : ''}
      </div>`;

    // M40.1 — the domain block sits under e-mail's requirement list, because
    // that requirement is the only thing she can do anything about here.
    const dom = channel === 'email' ? renderDomain(locale, domain, new Date(), viewer) : '';

    return `<div class="card reach">
      <div class="ch-h"><span class="ch-name">${esc(t(locale, `reach.channel.${channel}` as MessageKey))}</span>
        <span class="pill ${tone}">${esc(headline)}</span></div>
      <!-- What this product can do comes FIRST. The e-mail card put it after
           the whole DNS form, so a page of work read as available and the line
           saying it was not landed under the Save button. -->
      ${notHere}${reqs}${dom}${window}${instead}${connect}${toggle}
    </div>`;
  }).join('');

  return `<div class="block">
    <h2>${esc(t(locale, 'reach.title'))}</h2>
    <p class="muted ch-desc">${esc(t(locale, 'reach.intro'))}</p>
    ${rows}
    <style>
      .reach .reqs, .reach .instead ul { list-style:none; margin:var(--space-8) 0 0; padding:0; }
      .reach .reqs li, .reach .instead li { padding:var(--space-4) 0;
        font-size:var(--font-size-note); color:var(--color-ink-secondary); }
      .reach .win { font-size:var(--font-size-note); margin-top:var(--space-8); }
      .reach .instead { margin-top:var(--space-12); padding-top:var(--space-8);
        border-top:1px solid var(--color-border); }
      .reach .pill.stop { background:var(--color-paper-sunk); color:var(--color-ink-secondary); }
      .reach .outreach { margin-top:var(--space-12); padding-top:var(--space-12);
        border-top:1px solid var(--color-border); display:flex; flex-wrap:wrap;
        align-items:center; gap:var(--space-12); }
      .reach .outreach .on { color:var(--color-ink); font-weight:600; }
      .reach .warn-line { flex-basis:100%; font-size:var(--font-size-note); margin:0; }
      .reach .capform { display:flex; flex-wrap:wrap; align-items:flex-end; gap:var(--space-8);
        flex-basis:100%; }
      .reach .capform input[type=number] { width:8ch; }
      .reach .cap-hint { font-size:var(--font-size-note); }
      .dom { margin-top:var(--space-12); }
      .dom-h { display:flex; align-items:center; gap:var(--space-12); flex-wrap:wrap; }
      .dom .who { font-weight:600; }
      .dns { list-style:none; margin:var(--space-8) 0; padding:0; }
      .dns li { display:flex; align-items:center; gap:var(--space-8); flex-wrap:wrap;
        padding:var(--space-4) 0; font-size:var(--font-size-note); }
      .dns .host { color:var(--color-ink-secondary); overflow-wrap:anywhere; }
      .domform { display:grid; gap:var(--space-8); margin-top:var(--space-12); }
    </style>
  </div>`;
}

/**
 * C9 / C10 — one of the channels a buyer starts, as the page sees it.
 * `configured`: something here can connect it — the host's account (C9) or
 * Meta's login (C10). `connectHref`: the login, when this installation offers
 * it; absent, the C9 button posts the host's account. `connectedAs`: the Page
 * or handle she connected herself, which is also what makes it hers to
 * disconnect here.
 */
export type InboundLink = {
  readonly configured: boolean;
  readonly connected: boolean;
  readonly connectHref?: string;
  readonly connectedAs?: string;
  /** Meta refused the token: connect again. */
  readonly needsAttention?: boolean;
  /** Her Page is connected but has no Instagram account linked. */
  readonly noInstagram?: boolean;
};

export function renderChannels(
  data: ChannelsData, locale: Locale, flash: string | null, viewer: Viewer = OWNER_VIEW,
  /** C6 — the other accounts she links (`./connect.ts`), already rendered. */
  accountsHtml = '',
  /** C9 — the channels a buyer starts: configured by the host, connected by her. */
  inbound: ReadonlyMap<OutreachChannel, InboundLink> = new Map(),
): string {
  const w = data.whatsapp;
  const actions = w.connected
    ? `<form method="post" action="/app/channels/whatsapp/test" style="display:inline"><button class="btn">${esc(t(locale, 'channel.action.test'))}</button></form>
       <form method="post" action="/app/channels/whatsapp/disconnect" style="display:inline"><button class="btn danger">${esc(t(locale, 'channel.action.disconnect'))}</button></form>`
    : w.status === 'disconnected'
      ? `<form method="post" action="/app/channels/whatsapp/reconnect" style="display:inline"><button class="btn send">${esc(t(locale, 'channel.action.reconnect'))}</button></form>`
      // G3 — with a number configured, Connect DOES it; the guide is only for
      // an installation that has no number yet.
      : data.canConnect && !viewer.isOwner
        ? `<div class="muted ch-desc">${esc(t(locale, 'staff.ownerDecides'))}</div>`
      : data.canConnect
        ? `<form method="post" action="/app/channels/whatsapp/connect" style="display:inline"><button class="btn send">${esc(t(locale, 'channel.action.connectNumber'))}</button></form>
           <div class="muted ch-desc">${esc(t(locale, 'channel.connect.configured', { name: EMPLOYEE_NAME[locale] }))}</div>`
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

  // M39 — what each channel allows, before she connects one.
  const reach = renderReach(locale, satisfiedRequirements(data.templateState, data.domain, new Date()),
    data.outreach, data.domain, viewer, data.outreachCaps, inbound);

  const alertsCard = `<div class="block">
    <h2>${esc(t(locale, 'settings.alerts.title'))}</h2>
    <p class="muted ch-desc">${esc(t(locale, 'settings.alerts.desc', { name: EMPLOYEE_NAME[locale] }))}</p>
    <form method="post" action="/app/settings/owner-phone" class="ownerform">
      <label class="muted" for="ownerphone">${esc(t(locale, 'settings.alerts.label'))}</label>
      <input id="ownerphone" name="phone" type="tel" inputmode="tel" value="${esc(data.ownerPhone ?? '')}" placeholder="${esc(t(locale, 'settings.alerts.placeholder'))}" />
      <button class="btn send">${esc(t(locale, 'settings.alerts.save'))}</button>
    </form>
    <p class="muted" style="font-size:var(--font-size-micro)">${data.ownerPhone ? esc(t(locale, 'settings.alerts.current', { phone: data.ownerPhone })) : esc(t(locale, 'settings.alerts.none'))}</p>
  </div>`;

  const soon = `<div class="block">
    <h2>${esc(t(locale, 'channel.soon.title'))}</h2>
    <div class="soon">${COMING_SOON.map((c) => `<span class="soon-chip">${esc('literal' in c ? c.literal : t(locale, c.key))}</span>`).join('')}</div>
    <p class="muted">${esc(t(locale, 'channel.soon.note'))}</p>
  </div>`;

  return `<h1 class="page">${esc(t(locale, 'nav.channels'))}</h1>
    ${flash ? `<div class="flash" role="status">${esc(flash)}</div>` : ''}
    ${whatsappCard}
    ${accountsHtml}
    ${reach}
    ${alertsCard}
    ${soon}
    <p class="muted" style="font-size:var(--font-size-micro)">${esc(t(locale, 'channel.footer'))}</p>
    ${CHANNELS_STYLE}`;
}

export function renderConnectGuide(locale: Locale): string {
  const name = EMPLOYEE_NAME[locale];
  return `<h1 class="page">${esc(t(locale, 'channel.connect.title'))}</h1>
    <div class="block">
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
  .ch-h { display:flex; align-items:center; justify-content:space-between; gap:var(--space-8); }
  .ch-name { font-size:var(--font-size-small); font-weight:700; }
  .ch-desc { font-size:var(--font-size-caption); margin:var(--space-8) 0 var(--space-12); }
  .ch-info { display:flex; flex-direction:column; gap:var(--space-4); background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px; padding:12px; font-size:var(--font-size-note); margin-bottom:var(--space-12); }
  .ch-acts { display:flex; gap:var(--space-8); flex-wrap:wrap; }
  .prob { background:var(--color-waiting-wash); color:var(--color-waiting); border-radius:10px; padding:12px; font-size:var(--font-size-note); margin-bottom:var(--space-12); line-height:1.6; }
  .ownerform { display:flex; flex-direction:column; gap:var(--space-4); margin-bottom:var(--space-8); }
  .ownerform input { background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px; color:var(--color-ink); padding:10px 14px; font:inherit; }
  .soon { display:flex; flex-wrap:wrap; gap:var(--space-8); margin-bottom:var(--space-12); }
  .soon-chip { background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:999px; padding:6px 14px; color:var(--color-ink-secondary); font-size:var(--font-size-caption); }
  .guide { padding-inline-start:20px; line-height:2; } .guide li { margin-bottom:var(--space-4); }
</style>`;

/** C4.a — the predicate moved to core; re-exported so every caller is unchanged. */
export { satisfiedRequirements };
