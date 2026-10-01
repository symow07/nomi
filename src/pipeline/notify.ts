import { sql } from 'kysely';
import { withTenantTx, type Db } from '../db/client.js';
import { parseBusinessId } from '../core/types/ids.js';
import { type Locale, parseLocale } from '../core/owner/i18n/locale.js';
import { t, type MessageKey } from '../core/owner/i18n/messages.js';
import type { AppErrorAlertJob, NotifyJob } from '../queue/boss.js';
import type { SendResult } from '../channels/contract.js';
import { assistantNameOfConversation, mainAssistantName } from '../db/assistants.js';
import { ownerLoginEmail, channelIsLive } from '../db/backups.js';
import { formatDate } from '../core/owner/i18n/format.js';
import type { BusinessId } from '../core/types/ids.js';
import { deletionDueBy } from '../core/ops/deletions.js';
import { isPracticeCopy } from '../db/practice.js';
import { zoneOf } from '../db/zone.js';
import { conversationUrl } from '../core/owner/addresses.js';
import { sendPush, type VapidKeys, type PushFetch } from '../net/webPush.js';
import { livePhones, archivePhone, markPhoneSent } from '../db/pushSubscriptions.js';

/**
 * The installation's own sender, as this module needs it — the shape of
 * `SystemMail` (src/channels/email/systemMail.ts), declared here rather than
 * imported, so the conversation path does not reach into the mail transport
 * modules even by a type (tests/parity/c5-prospects.test.ts walks imports).
 */
export type OwnerMailer = {
  send(message: { readonly to: string; readonly subject: string; readonly text: string }): Promise<{ ok: true } | { ok: false; error: string }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * P3 — Owner WhatsApp alerts. The QUEUES.notify consumer: a NotifyJob carries a
 * language-NEUTRAL `kind` (the event code); this resolves the business's persisted
 * owner locale + destination and renders the owner-facing text via the existing
 * t() catalog. No translated strings live in the pipeline or the job — only codes.
 */

export type AlertKind = NotifyJob['kind'];
export type AlertOutcome = 'sent' | 'skipped_no_destination' | 'skipped_practice' | 'failed_permanent';

/**
 * OPERATOR alerts — about the installation, not about a buyer: its backups
 * (and, as they are added, the other things only whoever runs Nomi can fix).
 * Each is delivered as `backup_stale` always was: by E-MAIL to the sign-in
 * address of the business the job names (the pilot's — whoever runs this
 * installation), always; and by WhatsApp as well where a channel is live and a
 * number is set. None of them may depend on WhatsApp, because the thing being
 * reported can be the reason WhatsApp is not working.
 *
 * A kind listed here needs `notify.<kind>` and `notify.<kind>.subject` in every
 * locale, and its words in `renderOwnerAlert`.
 */
export const OPERATOR_ALERT_KINDS = ['backup_stale', 'deletion_due', 'app_error', 'meta_errors', 'signup_digest'] as const satisfies readonly AlertKind[];
export const isOperatorAlert = (kind: AlertKind): boolean =>
  (OPERATOR_ALERT_KINDS as readonly AlertKind[]).includes(kind);

/**
 * 0076 — the alerts that may not depend on WhatsApp: every operator alert, and
 * one about a buyer — `deletion_requested`. A buyer asking for their data to be
 * deleted starts a clock the owner answers to, and the ordinary hand-off alert
 * goes nowhere at all when no alert number is set. So it travels the operator
 * alerts' way: by e-mail to the owner's sign-in address, always, and by
 * WhatsApp too where a channel is live and a number is set. Each needs
 * `notify.<kind>.subject` in every locale.
 */
export const goesByMail = (kind: AlertKind): boolean =>
  isOperatorAlert(kind) || kind === 'deletion_requested' || kind === 'order_proposed';

/**
 * G5 — the alerts about a customer that a stranger running Nomi must hear of:
 * a hand-off, a customer who looks ready to buy, and a reply waiting for the
 * owner (which had no alert at all). Each goes by E-MAIL to the owner's
 * sign-in address, and by WhatsApp to the alert number where one is set — as
 * these two always went. Most owners who sign up have no number set, and
 * until now heard of nothing. Each needs `notify.<kind>.subject`.
 */
export const CUSTOMER_ALERT_KINDS = ['handoff', 'hot_lead', 'draft_waiting'] as const satisfies readonly AlertKind[];
export const mailsToo = (kind: AlertKind): boolean => (CUSTOMER_ALERT_KINDS as readonly AlertKind[]).includes(kind);

/**
 * G5 — a reply waiting for the owner is told at most once an hour for a
 * conversation: a customer who writes five lines makes five drafts, and the
 * owner needs one e-mail to open it, not five.
 */
export const DRAFT_ALERT_EVERY_SECONDS = 3600;

/** Where the alert's link opens: the conversation, at its newest message — the one address (CC-25). */
export const alertLink = (base: string, conversationId: string): string =>
  `${base.replace(/\/$/, '')}${conversationUrl(conversationId)}`;

/** One open deletion request the operator must carry out soon, as the alert names it. */
export type DeletionDueLine = {
  readonly business: string;
  readonly scope: 'workspace' | 'buyer';
  readonly askedAt: Date;
  readonly overdue: boolean;
};

/** What an operator alert says beyond its kind. Each kind reads its own fields. */
export type OperatorAlertDetail = {
  readonly lastBackupAt?: Date | null;
  /** `deletion_due`: the requests, oldest first. */
  readonly deletionsDue?: readonly DeletionDueLine[];
  /** `app_error` (CC-10): the error as recorded — already redacted and cut. */
  readonly appError?: AppErrorAlertJob | null;
  /** `meta_errors` (CEIL): the workspaces over the line, the worst first. */
  readonly metaErrors?: readonly { readonly business: string; readonly attempted: number; readonly failed: number; readonly errors: readonly string[] }[];
  /** TZ — the zone the reader's dates are said in: the receiving workspace's. UTC when not given. */
  readonly zone?: string;
  /** `signup_digest` (G1): who signed up in the last day. */
  readonly signups?: readonly { readonly business: string; readonly kind: string | null; readonly country: string | null }[];
};

/** A long list is cut here and counted, so the alert stays readable on a phone. */
const DELETION_ALERT_LINES = 10;
/** G1 — the daily sign-up list names this many; past it, how many more. */
export const SIGNUP_DIGEST_LINES = 25;

/**
 * Event → neutral alert code (business logic stays locale-free). A deletion
 * request is its own alert, never the generic hand-off's "wants a person".
 *
 * 0080 — so is an order a customer said yes to: it waits for the owner's tap,
 * and nothing happens until they decide, so the owner is told by e-mail as
 * well as WhatsApp (`goesByMail`). Once per proposal: a second "yes" while it
 * waits is the same proposal, and says nothing new.
 */
export function alertKindFor(effects: {
  readonly hotLeadAlert: boolean; readonly handoffAlert: boolean; readonly deletionAlert?: boolean;
  readonly orderProposed?: { readonly fresh: boolean } | null;
  /** G5 — a reply now waits for the owner. The least of the alerts: any other one says it too. */
  readonly draftCreated?: unknown;
}): AlertKind | null {
  if (effects.deletionAlert) return 'deletion_requested';
  if (effects.orderProposed?.fresh) return 'order_proposed';
  if (effects.handoffAlert) return 'handoff';
  if (effects.hotLeadAlert) return 'hot_lead';
  if (effects.draftCreated) return 'draft_waiting';
  return null;
}

/** Pure: localized owner-facing alert text. delivery_failed reuses dead_letter. */
export function renderOwnerAlert(
  locale: Locale, kind: AlertKind, name: string | null = null,
  detail: OperatorAlertDetail = {},
): string {
  // The backup alert says WHEN the last good copy is from, or that there has
  // never been one — the two are different news, so they are two sentences.
  if (kind === 'backup_stale') {
    return detail.lastBackupAt
      ? t(locale, 'notify.backup_stale', { when: formatDate(locale, detail.lastBackupAt, detail.zone ?? 'UTC') })
      : t(locale, 'notify.backup_stale.never');
  }
  // CC-02a — which requests, whose, asked when and due by when; a late one
  // says so. The words for the kind of request are the owner's page's own.
  if (kind === 'deletion_due') {
    const due = detail.deletionsDue ?? [];
    const shown = due.slice(0, DELETION_ALERT_LINES);
    const lines = shown.map((d) => t(locale, d.overdue ? 'notify.deletion_due.late' : 'notify.deletion_due.soon', {
      business: d.business,
      what: t(locale, d.scope === 'workspace' ? 'data.deletion.scope.workspace' : 'data.deletion.scope.buyer'),
      asked: formatDate(locale, d.askedAt, detail.zone ?? 'UTC'),
      due: formatDate(locale, deletionDueBy(d.askedAt), detail.zone ?? 'UTC'),
    }));
    const more = due.length > shown.length
      ? [t(locale, 'notify.deletion_due.more', { n: due.length - shown.length })] : [];
    return [t(locale, 'notify.deletion_due', { n: due.length }), ...lines, ...more,
      t(locale, 'notify.deletion_due.how')].join('\n');
  }
  if (kind === 'app_error') return appErrorText(locale, detail.appError ?? null);
  // G1 — the day's sign-ups: how many, then each by name, kind and country.
  if (kind === 'signup_digest') {
    const list = detail.signups ?? [];
    const shown = list.slice(0, SIGNUP_DIGEST_LINES);
    const more = list.length > shown.length ? [t(locale, 'notify.signup_digest.more', { n: list.length - shown.length })] : [];
    return [t(locale, 'notify.signup_digest', { n: list.length }),
      ...shown.map((s) => `${s.business} (${s.kind ? t(locale, `business.kind.${s.kind}` as MessageKey) : '—'}, ${s.country ?? '—'})`), ...more].join('\n');
  }
  // CEIL — which workspaces, how many of the day's messages Meta refused or
  // lost, in the provider's own words; then what the operator can do.
  if (kind === 'meta_errors') {
    const over = detail.metaErrors ?? [];
    const shown = over.slice(0, DELETION_ALERT_LINES);
    const lines = shown.map((m) => t(locale, 'notify.meta_errors.line', {
      business: m.business, failed: m.failed, attempted: m.attempted, errors: m.errors.join('; ') || '—',
    }));
    const more = over.length > shown.length ? [t(locale, 'notify.meta_errors.more', { n: over.length - shown.length })] : [];
    return [t(locale, 'notify.meta_errors', { n: over.length }), ...lines, ...more, t(locale, 'notify.meta_errors.how')].join('\n');
  }
  const key = (kind === 'delivery_failed' ? 'dead_letter' : kind);
  // A5.2 — the assistant this alert is about, when the owner has named one;
  // otherwise the catalogue says "your assistant".
  return t(locale, `notify.${key}` as MessageKey, name ? { name } : undefined);
}

/** Owner alert destination input: '' clears it; a valid E.164-ish number, else invalid. */
export function validateOwnerPhone(raw: string): { ok: true; value: string | null } | { ok: false } {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: null };            // clear
  const cleaned = trimmed.replace(/[\s().\-]/g, '');
  return /^\+\d{8,15}$/.test(cleaned) ? { ok: true, value: cleaned } : { ok: false };
}

export type NotifyDeps = {
  readonly db: Db;
  readonly adapter: { sendText(to: string, body: string): Promise<SendResult> };
  /** The installation's own sender (A3). Null: no e-mail leaves this installation. */
  readonly mail?: OwnerMailer | null;
  /** G5 — where the app is served (`PUBLIC_BASE_URL`): an alert links to its conversation. */
  readonly publicBaseUrl?: string | null;
  /** G5b — the installation's push keys and the way out to a push service; null: no phone alerts. */
  readonly push?: { readonly keys: VapidKeys; readonly fetch: PushFetch } | null;
};

/**
 * Deliver one owner alert through the EXISTING adapter send path. Returns an
 * outcome; throws only on a RETRYABLE provider failure so pg-boss retries (a
 * permanent failure is swallowed to avoid a dead-letter loop). No owner phone =
 * honestly skipped, never a fake send.
 *
 * The OPERATOR alerts (`OPERATOR_ALERT_KINDS`, `backup_stale` first) are the
 * exception, on purpose: they must not depend on WhatsApp, because the channel
 * they would travel on is itself something that can be down, unverified, or
 * never connected. They go by E-MAIL to the address the owner signs in with,
 * always; and by WhatsApp as well when a channel is live and a number is set.
 * See `deliverOperatorAlert`.
 */
export async function deliverOwnerAlert(deps: NotifyDeps, job: NotifyJob): Promise<AlertOutcome> {
  const bid = parseBusinessId(job.businessId);
  if (!bid.ok) return 'skipped_no_destination';
  // P3 — Practice alerts nobody. A practice copy (0086) hands conversations to
  // a person and asks for approvals like the workspace does, and every one of
  // those queues an alert: this one check refuses them all, whichever path
  // queued it. The owner is on the Practice page, watching it happen.
  if (await withTenantTx(deps.db, bid.value, (tx) => isPracticeCopy(tx, bid.value))) return 'skipped_practice';
  if (goesByMail(job.kind)) return deliverOperatorAlert(deps, bid.value, job);
  if (mailsToo(job.kind)) return deliverCustomerAlert(deps, bid.value, job);

  const found = await withTenantTx(deps.db, bid.value, async (tx) => {
    const row = (await sql<{ owner_locale: string; owner_phone: string | null }>`
      select owner_locale, owner_phone from businesses where id = ${bid.value}`.execute(tx)).rows[0] ?? null;
    // Looked up only when there is somewhere to send it.
    const name = row?.owner_phone
      ? (job.conversationId && UUID.test(job.conversationId)
          ? await assistantNameOfConversation(tx, bid.value, job.conversationId)
          : await mainAssistantName(tx, bid.value))
      : null;
    return { row, name };
  });
  const dest = found.row;

  if (!dest || !dest.owner_phone) return 'skipped_no_destination';

  const locale: Locale = parseLocale(dest.owner_locale) ?? 'en';
  const body = renderOwnerAlert(locale, job.kind, found.name);
  const res = await deps.adapter.sendText(dest.owner_phone, body);
  if (res.ok) return 'sent';
  if (res.retryable) throw new Error(`owner alert send failed (retryable): ${res.error}`);
  return 'failed_permanent';
}

/**
 * An operator alert (the backup alert first) — or a buyer's deletion request
 * (`MAIL_ALWAYS_KINDS`): e-mail first, WhatsApp too where it can actually arrive.
 *
 * Outcome is `sent` when at least one way delivered; `failed_permanent` when
 * every way that existed failed; `skipped_no_destination` when there was no
 * way at all (no login e-mail, no sender, and no live number) — which the log
 * line makes visible, since an alert about missing backups that has nowhere
 * to go is itself something the operator needs to know.
 */
async function deliverOperatorAlert(deps: NotifyDeps, bid: BusinessId, job: NotifyJob): Promise<AlertOutcome> {
  const found = await withTenantTx(deps.db, bid, async (tx) => {
    const row = (await sql<{ owner_locale: string; owner_phone: string | null }>`
      select owner_locale, owner_phone from businesses where id = ${bid}`.execute(tx)).rows[0] ?? null;
    return {
      row,
      zone: await zoneOf(tx, bid),
      email: await ownerLoginEmail(tx, bid),
      live: row?.owner_phone ? await channelIsLive(tx, bid) : false,
    };
  });
  if (!found.row) return 'skipped_no_destination';
  const locale: Locale = parseLocale(found.row.owner_locale) ?? 'en';
  const body = renderOwnerAlert(locale, job.kind, null, { ...operatorDetailOf(job), zone: found.zone });

  let tried = 0; let sent = 0;
  if (deps.mail && found.email) {
    tried++;
    const r = await deps.mail.send({ to: found.email, subject: t(locale, `notify.${job.kind}.subject` as MessageKey), text: body });
    if (r.ok) sent++; else console.warn(`[notify] ${job.kind} alert e-mail failed: ${r.error}`);
  }
  if (found.live && found.row.owner_phone) {
    tried++;
    const r = await deps.adapter.sendText(found.row.owner_phone, body);
    if (r.ok) sent++;
    else if (r.retryable && sent === 0) throw new Error(`owner alert send failed (retryable): ${r.error}`);
  }
  if (tried === 0) { console.warn(`[notify] ${job.kind} alert has nowhere to go: no login e-mail or sender, and no live number`); return 'skipped_no_destination'; }
  return sent > 0 ? 'sent' : 'failed_permanent';
}

/**
 * G5 — an alert about a customer: by e-mail to the owner's sign-in address,
 * and by WhatsApp to the alert number where one is set (as hand-offs and hot
 * leads always went). The words name the assistant this conversation is with,
 * and end with a link to it when the installation knows its own address.
 *
 * `sent` when one way delivered; a retryable WhatsApp failure throws for
 * pg-boss to retry only when nothing was delivered — a retry after the e-mail
 * left would send the e-mail twice.
 */
async function deliverCustomerAlert(deps: NotifyDeps, bid: BusinessId, job: NotifyJob): Promise<AlertOutcome> {
  const conversationId = job.conversationId && UUID.test(job.conversationId) ? job.conversationId : null;
  const found = await withTenantTx(deps.db, bid, async (tx) => {
    const row = (await sql<{ owner_locale: string; owner_phone: string | null }>`
      select owner_locale, owner_phone from businesses where id = ${bid}`.execute(tx)).rows[0] ?? null;
    const email = deps.mail ? await ownerLoginEmail(tx, bid) : null;
    const name = row
      ? (conversationId ? await assistantNameOfConversation(tx, bid, conversationId) : await mainAssistantName(tx, bid))
      : null;
    return { row, email, name };
  });
  if (!found.row) return 'skipped_no_destination';
  const locale: Locale = parseLocale(found.row.owner_locale) ?? 'en';
  const words = renderOwnerAlert(locale, job.kind, found.name);
  const body = deps.publicBaseUrl && conversationId
    ? `${words}\n\n${t(locale, 'notify.open', { url: alertLink(deps.publicBaseUrl, conversationId) })}` : words;

  let tried = 0; let sent = 0;
  if (deps.mail && found.email) {
    tried++;
    const r = await deps.mail.send({ to: found.email, subject: t(locale, `notify.${job.kind}.subject` as MessageKey), text: body });
    if (r.ok) sent++; else console.warn(`[notify] ${job.kind} alert e-mail failed: ${r.error}`);
  }
  // G5b — every phone that turned alerts on: the words, and the conversation it opens.
  if (deps.push) {
    const phones = await withTenantTx(deps.db, bid, (tx) => livePhones(tx, bid));
    const message = {
      title: t(locale, `notify.${job.kind}.subject` as MessageKey), body: words,
      url: deps.publicBaseUrl && conversationId ? alertLink(deps.publicBaseUrl, conversationId) : null,
    };
    for (const phone of phones) {
      tried++;
      const r = await sendPush(phone, message, deps.push.keys, deps.push.fetch);
      if (r.kind === 'sent') { sent++; await withTenantTx(deps.db, bid, (tx) => markPhoneSent(tx, phone.id)); }
      else if (r.kind === 'gone') await withTenantTx(deps.db, bid, (tx) => archivePhone(tx, bid, phone.id, 'gone'));
      else console.warn(`[notify] ${job.kind} phone alert failed (${r.status ?? 'no answer'})`);
    }
  }
  if (found.row.owner_phone) {
    tried++;
    const r = await deps.adapter.sendText(found.row.owner_phone, body);
    if (r.ok) sent++;
    else if (r.retryable && sent === 0) throw new Error(`owner alert send failed (retryable): ${r.error}`);
  }
  if (tried === 0) return 'skipped_no_destination';
  return sent > 0 ? 'sent' : 'failed_permanent';
}

/** The job's own fields, as the words for its kind need them. Dates travel as ISO strings. */
function operatorDetailOf(job: NotifyJob): OperatorAlertDetail {
  return {
    lastBackupAt: job.lastBackupAt ? new Date(job.lastBackupAt) : null,
    deletionsDue: (job.deletionsDue ?? []).map((d) => ({
      business: d.business, scope: d.scope, askedAt: new Date(d.askedAt), overdue: d.overdue,
    })),
    appError: job.appError ?? null,
    metaErrors: job.metaErrors ?? [],
    signups: (job.signups ?? []).map((s) => ({ business: s.business, kind: s.kind, country: s.country })),
  };
}

/**
 * G1 — the operator hears of each sign-up as it happens: the new workspace's
 * name, kind and country, by e-mail to the operator's own sign-in address (the
 * installation's business), in the operator's language. Nothing a customer
 * said; never the new owner's password or code.
 */
export async function notifyOperatorOfSignup(
  deps: { readonly db: Db; readonly mail: OwnerMailer }, operatorBusinessIdRaw: string, newBusinessIdRaw: string,
): Promise<'sent' | 'skipped' | 'failed'> {
  const op = parseBusinessId(operatorBusinessIdRaw);
  const made = parseBusinessId(newBusinessIdRaw);
  if (!op.ok || !made.ok || op.value === made.value) return 'skipped';
  const b = await withTenantTx(deps.db, made.value, (tx) => sql<{
    name: string; kind: string | null; country: string | null; sells: string | null; website: string | null;
  }>`select name, kind, country, description as sells, website from businesses where id = ${made.value}`.execute(tx).then((r) => r.rows[0]));
  const to = await withTenantTx(deps.db, op.value, async (tx) => ({
    locale: (await sql<{ owner_locale: string }>`select owner_locale from businesses where id = ${op.value}`.execute(tx)).rows[0]?.owner_locale ?? 'en',
    email: await ownerLoginEmail(tx, op.value),
  }));
  if (!b || !to.email) return 'skipped';
  const locale: Locale = parseLocale(to.locale) ?? 'en';
  const r = await deps.mail.send({
    to: to.email, subject: t(locale, 'notify.signup_new.subject'),
    text: [
      t(locale, 'notify.signup_new', {
        business: b.name, kind: b.kind ? t(locale, `business.kind.${b.kind}` as MessageKey) : '—', country: b.country ?? '—',
      }),
      t(locale, 'notify.signup_new.sells', { sells: b.sells ?? '—' }),
      t(locale, 'notify.signup_new.website', { website: b.website ?? '—' }),
    ].join('\n'),
  });
  return r.ok ? 'sent' : 'failed';
}

/**
 * CC-10 — an error in the app, for whoever looks after the installation.
 *
 * The owner's words frame it (one sentence, then the count, then where the full
 * list is); between them stands what the program said, word for word — the
 * where, the error, the line — because that is what whoever fixes it needs, and
 * no translation of it would be more useful. It was redacted before it was
 * written down (src/worker/appErrors.ts). `#<ref>` is what `tools/errors.mjs
 * --ref` finds it by, and the time is in UTC, as that tool and the host's logs
 * say it — one clock for whoever lines the three up.
 */
function appErrorText(locale: Locale, e: AppErrorAlertJob | null): string {
  const opening = t(locale, 'notify.app_error');
  if (!e) return opening;
  const first = new Date(e.firstSeen);
  const lines = [
    opening,
    '',
    [e.where, e.route].filter(Boolean).join(' · '),
    `${e.name}: ${e.message}`,
    [e.frame, `#${e.fingerprint.slice(0, 12)}`].filter(Boolean).join(' · '),
    '',
    t(locale, 'notify.app_error.seen', {
      count: e.count,
      when: Number.isNaN(first.getTime()) ? e.firstSeen : `${first.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    }),
  ];
  if (e.more > 0) lines.push(t(locale, 'notify.app_error.more', { count: e.more }));
  lines.push('', t(locale, 'notify.app_error.list'));
  return lines.join('\n');
}
