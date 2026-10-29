import { sql } from 'kysely';
import { withTenantTx, type Db, type Tx } from '../db/client.js';
import { parseBusinessId } from '../core/types/ids.js';
import { type Locale, parseLocale } from '../core/owner/i18n/locale.js';
import { t, capabilityName, steppedName, type MessageKey } from '../core/owner/i18n/messages.js';
import { QUEUES, type AppErrorAlertJob, type NotifyJob } from '../queue/boss.js';
import type { PgBoss, SendOptions } from 'pg-boss';
import type { SendResult } from '../channels/contract.js';
import { assistantNameOfConversation, mainAssistantName } from '../db/assistants.js';
import { ownerLoginEmail, channelIsLive } from '../db/backups.js';
import { formatDate, formatTime, formatList } from '../core/owner/i18n/format.js';
import type { BusinessId } from '../core/types/ids.js';
import { deletionDueBy } from '../core/ops/deletions.js';
import { isPracticeCopy } from '../db/practice.js';
import { zoneOf } from '../db/zone.js';
import { conversationUrl } from '../core/owner/addresses.js';
import { sendPush, type VapidKeys, type PushFetch } from '../net/webPush.js';
import { archivePhone, livePhones, markPhoneSent, type PhoneSubscription } from '../db/pushSubscriptions.js';
import { alertChannelFor, ownerWhatsAppReachable, type AlertChannel } from '../core/owner/alertChannel.js';
import { interruptionPeople, ownerAlertFacts, type InterruptionPerson } from '../db/alertChannel.js';
import { morningFacts, morningSummaryDone } from '../db/morningSummary.js';
import { morningLines } from '../core/owner/morningSummary.js';
import { scrubSecrets } from '../core/ops/appErrors.js';
import { loggableMessage } from '../security/loggable.js';
import { backupTimes, mailboxState, markAlertDelivered, noteUndelivered, openUndeliveredAlerts, undeliveredJob } from '../db/alarms.js';
import { backupState } from '../core/ops/backups.js';

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
export type AlertOutcome = 'sent' | 'skipped_no_destination' | 'skipped_practice' | 'skipped_quiet' | 'failed_permanent';

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
export const OPERATOR_ALERT_KINDS = ['backup_stale', 'deletion_due', 'app_error', 'meta_errors', 'signup_digest', 'spend_breaker',
  // 0128 — the model provider refused for billing (escalating), answers again, or its balance runs low.
  'provider_refusing', 'provider_answering', 'provider_balance',
  // 0167 — production an hour behind main, and caught up again; 2026-10-29 — main out of sight for an hour, and seen again.
  'deploy_behind', 'deploy_caught_up', 'deploy_unseen', 'deploy_seen_again',
  // 0217 — a scheduled backup failed: told within five minutes, not 36 hours later.
  'backup_failed'] as const satisfies readonly AlertKind[];
/** 0217 — the steps backup/run.sh names (`backup_failures.step`), each with its words in `backup.failedStep.*`. */
export const BACKUP_STEPS = ['read', 'dump', 'drill', 'encrypt', 'upload', 'prune', 'record'] as const;
type BackupStep = typeof BACKUP_STEPS[number];
export const isOperatorAlert = (kind: AlertKind): boolean =>
  (OPERATOR_ALERT_KINDS as readonly AlertKind[]).includes(kind);

/**
 * The alerts that may not depend on WhatsApp and go by e-mail ALWAYS (and by
 * WhatsApp too where a channel is live and a number is set): every operator
 * alert, and the account's own letters — the operator's answer to a request to
 * connect, the warning before erasure, and money. Each needs
 * `notify.<kind>.subject` in every locale.
 *
 * THE WARMTH RUN (2026-10-03), phase 8 — the owner: "Only two things may
 * interrupt the owner outside the app: an order waiting for their tap, and a
 * conversation the assistant handed over because it could not handle it.
 * Everything else waits quietly in-app." So a deletion request (a hand-over,
 * 0076) and an order waiting (0080) left this list for `INTERRUPTION_KINDS`:
 * they travel the person's own way, and fall back to e-mail, so neither
 * depends on WhatsApp still. The allowance (G3) and the assistant stepping
 * back (R5) left it for `QUIET_KINDS`. The account's letters stay: they are
 * not news about the business's customers, and what they warn of (a workspace
 * erased, a payment failed, a connection refused) cannot wait in an app the
 * owner may not be opening.
 */
export const goesByMail = (kind: AlertKind): boolean =>
  isOperatorAlert(kind)
  // KS6 — the operator decided on the first connection: the owner may have no channel at all yet.
  || kind === 'connection_approved' || kind === 'connection_refused'
  // 0217 — the workspace's mailbox can no longer send: its letters, and its owner's e-mail, wait on it.
  || kind === 'mailbox_disconnected'
  // BILL — money: the trial ending, a failed payment, the hold, a plan's month used.
  || isBillingAlert(kind);

/** BILL (0117) — the owner's billing e-mails; each opens Billing. */
export const BILLING_ALERT_KINDS = ['billing_trial_ending', 'billing_payment_failed', 'billing_lapsed', 'plan_limit'] as const satisfies readonly AlertKind[];
export const isBillingAlert = (kind: AlertKind): boolean => (BILLING_ALERT_KINDS as readonly AlertKind[]).includes(kind);
export const BILLING_PAGE = '/app/settings/billing';

/** KS6 — where the decision's e-mail opens: the Channels page, at the approval card. */
export const CONNECTION_APPROVAL_PAGE = '/app/channels';

/** R5 — the reasons a self-demotion can give (`DemotionReason`), each with its words in `notify.self_demoted.why.*`. */
export const SELF_DEMOTION_REASONS = ['policy_violation', 'hallucination', 'serious_spot_check', 'failed_spot_check',
  'repeated_corrections', 'channel_unstable', 'wrong_price'] as const;
/** Where the self-demotion alert opens: the level on the assistant's page — one level into Settings since the advisor run (2026-10-06; `ASSISTANT_HOME` in layout.ts; the old address redirects, so an alert already sent still arrives). */
export const SELF_DEMOTION_PAGE = '/app/settings/assistant#on-her-own';

/**
 * G3 — the day's allowance, at the soft-warn line and at 100%, each once a UTC
 * day (`claim_allowance_alerts()`, 0101). Phase 8 of the warmth run: they wait
 * in the app (`QUIET_KINDS`) — at 100% each new message is handed over, and
 * that hand-over is what reaches the owner.
 */
export const ALLOWANCE_ALERT_KINDS = ['allowance_warn', 'allowance_reached'] as const satisfies readonly AlertKind[];

/**
 * THE WARMTH RUN (2026-10-03), phase 8 — THE TWO INTERRUPTIONS, the only news
 * about the business's customers that reaches anyone outside Nomi (the owner:
 * "Only two things may interrupt the owner outside the app: an order waiting
 * for their tap, and a conversation the assistant handed over because it could
 * not handle it."):
 *
 *   · `order_proposed` — a customer said yes, and the order waits for the tap (0080);
 *   · `handoff` — any hand-over: asked for a person, not answered, an unlisted
 *     number, the assistant stopped or held, …; and `deletion_requested`, the
 *     hand-over a deletion request is (0076), which keeps its own words.
 *
 * Each goes the way its reader chose on Notifications (`deliverOwnerInterruption`).
 * Each needs `notify.<kind>` and `notify.<kind>.subject` in every locale.
 */
export const INTERRUPTION_KINDS = ['order_proposed', 'handoff', 'deletion_requested', 'deletion_reminder'] as const satisfies readonly AlertKind[];
export const interrupts = (kind: AlertKind): boolean => (INTERRUPTION_KINDS as readonly AlertKind[]).includes(kind);

/**
 * Phase 2a (the owner's roadmap and word, 2026-10-13) — THE FOURTH CLASS: a daily letter to the owner, once a
 * morning, that the owner can stop (Notifications). Not an interruption (it is not urgent and waits for 08:00 and
 * the owner's quiet hours), not quiet in the app (it leaves). `deliverMorningSummary`.
 */
export const DAILY_KINDS = ['morning_summary'] as const satisfies readonly AlertKind[];
export const isDaily = (kind: AlertKind): boolean => (DAILY_KINDS as readonly AlertKind[]).includes(kind);

/**
 * THE DAILY LETTER WAITS ITS TURN (found 2026-10-13, by the integration suite). The sweep claims every owner whose
 * clock reached 08:00 at once, and the alert queue is one: its worker takes a job a poll (about two seconds), oldest
 * first among equals. Fifty summaries queued at 08:00 put a customer's hand-over, queued a second later, behind all
 * of them — a hundred seconds late. pg-boss takes the higher priority first; every other alert is sent at 0, so a
 * summary goes below them: an interruption queued after fifty summaries is the next one out.
 */
export const DAILY_PRIORITY = -1;

/**
 * THE ALERTS A CUSTOMER IS WAITING ON, NOW (the owner's word after the 106 seconds, 2026-10-13): a hand-over, an order
 * waiting for the owner's tap, a deletion request — each the moment it happens. They go out before anything else in
 * the queue, whatever floods it: a batch at the default priority (a sweep's quiet alerts, the operator's lists, the
 * daily deletion chase) cannot hold one back again. `deletion_reminder` interrupts too, but it is the daily chase of a
 * request already waiting, sent in a batch: put at the top it would be the next flood.
 */
export const URGENT_KINDS = ['handoff', 'order_proposed', 'deletion_requested'] as const satisfies readonly (typeof INTERRUPTION_KINDS[number])[];
export const isUrgent = (kind: AlertKind): boolean => (URGENT_KINDS as readonly AlertKind[]).includes(kind);
export const URGENT_PRIORITY = 1;

/** The queue priority of an alert, by its class: urgent first, every other alert, the daily letter last. */
export const alertPriority = (kind: AlertKind): number =>
  isUrgent(kind) ? URGENT_PRIORITY : isDaily(kind) ? DAILY_PRIORITY : 0;

/**
 * THE ONE WAY AN ALERT IS QUEUED: with its class's priority. `tests/parity/alert-priority.test.ts` refuses any other
 * `send` to the alert queue anywhere in src/.
 */
export function sendAlert(boss: Pick<PgBoss, 'send'>, job: NotifyJob, options: SendOptions = {}): Promise<string | null> {
  return boss.send(QUEUES.notify, job, { ...options, priority: alertPriority(job.kind) });
}

/**
 * THE ALARM ON TIME-TO-SEND: an urgent alert that waited longer than this in the queue is reported as an error (the
 * operator's e-mail, rate-limited, like every other) — so whatever delays the next one is named the day it happens,
 * not found in a test run weeks later.
 */
export const URGENT_LATE_MS = 60_000;
export function lateUrgentAlert(kind: AlertKind, queuedAt: Date | null | undefined, now: Date): number | null {
  if (!isUrgent(kind) || !queuedAt) return null;
  const waited = now.getTime() - queuedAt.getTime();
  return waited > URGENT_LATE_MS ? waited : null;
}

/**
 * …and what used to reach the owner outside Nomi and now waits in it, by the
 * same rule ("Everything else waits quietly in-app"). Where each waits:
 *
 *   · `hot_lead` — a customer who looks ready to buy: the assistant is still
 *     answering them; their conversation is in the Inbox;
 *   · `draft_waiting` — a reply waiting for the owner: Needs you, the rail's
 *     count and the toast (a plain draft is not an order waiting for a tap);
 *   · `self_demoted` — the assistant stepped back: its replies wait under
 *     Needs you, and its page says why;
 *   · `allowance_warn`, `allowance_reached` — at 100% each new message is
 *     handed over, and each of those hand-overs is an interruption itself;
 *   · `dead_letter` (`delivery_failed` shares its words) — a job that gave up:
 *     the operator hears of it (`app_error`, CC-10), a message that did not go
 *     is on the Inbox's "Did not send" tab, and a turn that gave up hands its
 *     customer over (0077) — an interruption.
 *
 * Nothing is lost: the words stay in the catalogue, and a job of these kinds
 * already queued at a deploy is consumed and dropped (`skipped_quiet`).
 */
export const QUIET_KINDS = ['hot_lead', 'draft_waiting', 'self_demoted', ...ALLOWANCE_ALERT_KINDS,
  'dead_letter', 'delivery_failed'] as const satisfies readonly AlertKind[];
export const waitsInApp = (kind: AlertKind): boolean => (QUIET_KINDS as readonly AlertKind[]).includes(kind);

/** Where the alert's link opens: the conversation, at its newest message — the one address (CC-25). */
export const alertLink = (base: string, conversationId: string): string =>
  `${base.replace(/\/$/, '')}${conversationUrl(conversationId)}`;

/**
 * D4 (the owner, 2026-10-12) — A DELETION ALERT CARRIES NO CUSTOMER DATA: "a deletion request is
 * waiting, open Nomi", and nothing more. Not the date asked, not how long, not the conversation's
 * address: the link opens Your data, which lists every waiting request. The first alert and the
 * reminders alike, on every way (e-mail, phone, WhatsApp).
 */
export const DELETION_ALERT_KINDS = ['deletion_requested', 'deletion_reminder'] as const satisfies readonly AlertKind[];
export const isDeletionAlert = (kind: AlertKind): boolean => (DELETION_ALERT_KINDS as readonly AlertKind[]).includes(kind);
export const deletionAlertLink = (base: string): string => `${base.replace(/\/$/, '')}/app/settings/data#buyers`;

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
  /** 0217 — `backup_failed`: the run, when, its step and the job's words. */
  readonly backupFailure?: { readonly name: string; readonly at: Date; readonly step: string; readonly reason: string };
  /** 0217 — `mailbox_disconnected`: the mailbox, and since when it cannot send. */
  readonly mailbox?: { readonly address: string; readonly since: Date };
  /** 0167 — what production runs, main's head, how long it has waited, and its first line. */
  readonly deploy?: { readonly running: string; readonly main: string; readonly minutes: number; readonly title: string };
  /** 2026-10-29 — `deploy_unseen` / `deploy_seen_again`: production's commit, minutes out of sight, GitHub's reason. */
  readonly deployUnseen?: { readonly running: string; readonly minutes: number; readonly why?: 'not_found' | 'refused' | 'limited' | 'other' };
  /** TZ — the zone the reader's dates are said in: the receiving workspace's. UTC when not given. */
  readonly zone?: string;
  /** `signup_digest` (G1): who signed up in the last day. */
  readonly signups?: readonly { readonly business: string; readonly kind: string | null; readonly country: string | null }[];
  /** `signup_digest` (G7): the operator switches still on. */
  readonly flags?: readonly { readonly flag: string; readonly business: string | null; readonly since: Date }[];
  /** `signup_digest` (G9): the day's sign-up forms, and how many came back with their code. */
  readonly forms?: { readonly forms: number; readonly codesUsed: number };
  /** `signup_digest` (G9): where the cohort stands. */
  readonly cohort?: { readonly workspaces: number; readonly practised: number; readonly replied: number };
  /** `signup_digest` (MAIL): the last day's codes and alerts, and what the caps held back. */
  readonly mail?: { readonly codes: number; readonly alerts: number; readonly refused: number };
  /** `signup_digest` (KS6): how many workspaces wait for the operator's approval to connect. */
  readonly approvals?: number;
  /** `signup_digest` (Phase 1, 0149): the sign-up check's day — asked for a card first, refused, and why. */
  readonly check?: { readonly cards: number; readonly refused: number; readonly why: readonly { readonly outcome: 'card' | 'refused'; readonly reason: string; readonly n: number }[] };
  /** `billing_trial_ending` (BILL): when the trial ends, ISO. */
  readonly billingAt?: string;
  /** `allowance_warn` / `allowance_reached` (G3): how much is used, and when it renews. */
  readonly allowancePct?: number;
  readonly renewsAt?: Date;
  /** `spend_breaker` (KS5): the installation's day so far, against its ceiling. */
  readonly spend?: { readonly tokens: number; readonly calls: number; readonly maxTokens: number; readonly maxCalls: number };
  /** `self_demoted` (R5): which capabilities stepped back, and the reason codes. */
  readonly demoted?: {
    readonly capabilities: readonly string[]; readonly reasons: readonly string[];
    /** 0163 — each step back narrowed to one language, as 'capability:language'; and those in every language. */
    readonly narrowed?: readonly string[]; readonly everywhere?: readonly string[];
  };
  /** `provider_refusing` / `provider_answering` (0128): the refusal, its step, its words, and its end. */
  readonly providerRefusal?: { readonly provider: string; readonly since: Date; readonly step: number; readonly words: string; readonly until?: Date };
  /** `provider_balance` (0128): the step and the paying currency's figures. */
  readonly providerBalance?: {
    readonly provider: string; readonly step: string; readonly currency: string; readonly total: number;
    readonly floor: number | null; readonly daysLeft: number | null; readonly available: boolean;
  };
};

/** How long a refusal has lasted, in whole hours (at least one once it is past the first). */
const hoursBetween = (from: Date, to: Date): number => Math.max(0, Math.round((to.getTime() - from.getTime()) / 3_600_000));

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
  // 0128 — the model provider's account: the refusal (first, then still), its end, a low balance.
  if (kind === 'provider_refusing' || kind === 'provider_answering') {
    const r = detail.providerRefusal ?? { provider: '—', since: new Date(0), step: 0, words: '' };
    const zone = detail.zone ?? 'UTC';
    const when = (d: Date) => `${formatDate(locale, d, zone)} ${formatTime(locale, d, zone)}`;
    if (kind === 'provider_answering') {
      return t(locale, 'notify.provider_answering', { provider: r.provider, since: when(r.since), until: when(r.until ?? new Date()) });
    }
    const first = r.step === 0
      ? t(locale, 'notify.provider_refusing', { provider: r.provider, since: when(r.since) })
      : t(locale, 'notify.provider_refusing.still', { provider: r.provider, since: when(r.since), hours: hoursBetween(r.since, new Date()) });
    return [first, t(locale, 'notify.provider_refusing.words', { words: r.words || '—' }), t(locale, 'notify.provider_refusing.how')].join('\n');
  }
  if (kind === 'provider_balance') {
    const b = detail.providerBalance ?? { provider: '—', step: 'floor', currency: '', total: 0, floor: null, daysLeft: null, available: true };
    const n = (x: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar-u-nu-latn' : locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
    const step = (['floor', 'days3', 'days1', 'unavailable'] as const).find((x) => x === b.step) ?? 'floor';
    const head = t(locale, `notify.provider_balance.${step}` as MessageKey, {
      provider: b.provider, balance: `${b.currency} ${n(b.total)}`,
      floor: b.floor !== null ? `${b.currency} ${n(b.floor)}` : '—',
      days: b.daysLeft !== null ? new Intl.NumberFormat(locale === 'ar' ? 'ar-u-nu-latn' : locale, { maximumFractionDigits: 1 }).format(b.daysLeft) : '—',
    });
    return [head, t(locale, 'notify.provider_balance.how')].join('\n');
  }
  // KS5 — how much the installation used today, against what; the beta waits, the pilots run.
  if (kind === 'spend_breaker') {
    const s = detail.spend ?? { tokens: 0, calls: 0, maxTokens: 0, maxCalls: 0 };
    const n = (x: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar-u-nu-latn' : locale).format(x);
    return t(locale, 'notify.spend_breaker', { tokens: n(s.tokens), calls: n(s.calls), maxTokens: n(s.maxTokens), maxCalls: n(s.maxCalls) });
  }
  // KS6 — the operator's decision on the first connection.
  if (kind === 'connection_approved' || kind === 'connection_refused') return t(locale, `notify.${kind}`);
  // BILL — the trial's end in the workspace's own zone; the others say what happened and what to do.
  if (kind === 'billing_trial_ending') {
    return t(locale, 'notify.billing_trial_ending', { date: formatDate(locale, detail.billingAt ? new Date(detail.billingAt) : new Date(), detail.zone ?? 'UTC') });
  }
  if (kind === 'billing_payment_failed' || kind === 'billing_lapsed' || kind === 'plan_limit') return t(locale, `notify.${kind}`);
  // R5 — which replies wait for the owner again, and why; a reason with no words is left out.
  if (kind === 'self_demoted') {
    const d = detail.demoted ?? { capabilities: [], reasons: [] };
    const known = d.reasons.filter((r) => (SELF_DEMOTION_REASONS as readonly string[]).includes(r));
    const why = formatList(locale, (known.length ? known : ['repeated_corrections']).map((r) => t(locale, `notify.self_demoted.why.${r}` as MessageKey)));
    // 0163 — a step back narrowed to one language is named with it ("Quoting, in Arabic"), and when every step back
    // was narrowed the alert says the other languages go on as before. A job queued before 0163 has neither list.
    const narrowed = d.narrowed ?? [];
    const everywhere = d.narrowed === undefined ? d.capabilities : (d.everywhere ?? []);
    if (narrowed.length > 0) {
      return t(locale, everywhere.length === 0 ? 'notify.self_demoted.narrowed' : 'notify.self_demoted', {
        caps: formatList(locale, [...everywhere, ...narrowed].map((c) => steppedName(locale, c))),
        why,
      });
    }
    return t(locale, 'notify.self_demoted', {
      caps: formatList(locale, everywhere.map((c) => capabilityName(locale, c))),
      why,
    });
  }
  // G3 — how much of today's allowance, and when it renews, in the owner's zone.
  if (kind === 'allowance_warn' || kind === 'allowance_reached') {
    const time = formatTime(locale, detail.renewsAt ?? new Date(), detail.zone ?? 'UTC');
    return kind === 'allowance_warn'
      ? t(locale, 'notify.allowance_warn', { pct: detail.allowancePct ?? 80, time })
      : t(locale, 'notify.allowance_reached', { time });
  }
  // G1 — the day's sign-ups: how many, then each by name, kind and country.
  if (kind === 'signup_digest') {
    const list = detail.signups ?? [];
    const shown = list.slice(0, SIGNUP_DIGEST_LINES);
    const more = list.length > shown.length ? [t(locale, 'notify.signup_digest.more', { n: list.length - shown.length })] : [];
    // G7 (KS4) — every operator switch still on, so none is forgotten.
    const flags = (detail.flags ?? []).map((f) => t(locale, 'notify.signup_digest.flag', {
      flag: f.flag, who: f.business ?? t(locale, 'notify.signup_digest.everyone'), since: formatDate(locale, f.since, detail.zone ?? 'UTC'),
    }));
    // G9 — how many forms were sent, and how many came back with their code.
    const forms = detail.forms ? [t(locale, 'notify.signup_digest.forms', { forms: detail.forms.forms, used: detail.forms.codesUsed })] : [];
    const cohort = detail.cohort ? [t(locale, 'notify.signup_digest.cohort', detail.cohort)] : [];
    const mail = detail.mail ? [t(locale, detail.mail.refused ? 'notify.signup_digest.mail.capped' : 'notify.signup_digest.mail', detail.mail)] : [];
    // KS6 — asks to connect a first channel, waiting for the operator.
    const approvals = detail.approvals ? [t(locale, 'notify.signup_digest.approvals', { n: detail.approvals })] : [];
    // Phase 1 (0149) — what the sign-up check did: reasons by their codes, the operator's own words for them.
    const why = (o: 'card' | 'refused') => (detail.check?.why ?? []).filter((w) => w.outcome === o).map((w) => `${w.reason} ×${w.n}`).join(', ') || '—';
    const check = [
      ...(detail.check?.cards ? [t(locale, 'notify.signup_digest.check.cards', { n: detail.check.cards, why: why('card') })] : []),
      ...(detail.check?.refused ? [t(locale, 'notify.signup_digest.check.refused', { n: detail.check.refused, why: why('refused') })] : []),
    ];
    return [t(locale, 'notify.signup_digest', { n: list.length }),
      ...shown.map((s) => `${s.business} (${s.kind ? t(locale, `business.kind.${s.kind}` as MessageKey) : '—'}, ${s.country ?? '—'})`), ...more,
      ...forms, ...check, ...cohort, ...mail, ...approvals, ...flags].join('\n');
  }
  // 0217 — which run failed, when, at which step, in the job's own words; then what still stands.
  if (kind === 'backup_failed') {
    const f = detail.backupFailure;
    return t(locale, 'notify.backup_failed', {
      name: f?.name ?? '—', when: f ? `${formatDate(locale, f.at, detail.zone ?? 'UTC')} ${formatTime(locale, f.at, detail.zone ?? 'UTC')}` : '—',
      step: t(locale, `backup.failedStep.${BACKUP_STEPS.includes(f?.step as BackupStep) ? f!.step : 'other'}` as MessageKey),
      reason: f?.reason ?? '—',
    });
  }
  if (kind === 'mailbox_disconnected') {
    const m = detail.mailbox;
    return t(locale, 'notify.mailbox_disconnected', {
      address: m?.address ?? '—', when: m ? formatDate(locale, m.since, detail.zone ?? 'UTC') : '—',
    });
  }
  // 0167 — production behind main: what runs, what waits, since when; then caught up.
  if (kind === 'deploy_behind' || kind === 'deploy_caught_up') {
    const d = detail.deploy ?? { running: '—', main: '—', minutes: 0, title: '' };
    return t(locale, `notify.${kind}`, { running: d.running, main: d.main, minutes: d.minutes, title: d.title || '—' });
  }
  // 2026-10-29 — main out of sight: for how long, GitHub's reason and what to do about it; then seen again.
  if (kind === 'deploy_unseen' || kind === 'deploy_seen_again') {
    const u = detail.deployUnseen ?? { running: '—', minutes: 0 };
    const text = t(locale, `notify.${kind}`, { running: u.running, minutes: u.minutes });
    return kind === 'deploy_unseen' ? `${text}\n${t(locale, `notify.deploy_unseen.why.${u.why ?? 'other'}`)}` : text;
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
  /**
   * MAIL (decision 36) — where the operator's alerts go when owner alerts have a
   * dedicated sender: the operator's own mailbox. Absent, `mail` carries both.
   */
  readonly operatorMail?: OwnerMailer | null;
  /** G5 — where the app is served (`PUBLIC_BASE_URL`): an alert links to its conversation. */
  readonly publicBaseUrl?: string | null;
  /** G5b — the installation's push keys and the way out to a push service; null: no phone alerts. */
  readonly push?: { readonly keys: VapidKeys; readonly fetch: PushFetch } | null;
  /**
   * Phase 8 of the warmth run — Meta approved Nomi (`META_APP_REVIEW=approved:<date>`,
   * `metaReviewFrom`). Until it says so, WhatsApp is not the default way out of
   * Nomi; an owner may still choose it where their alert number is on a live channel.
   */
  readonly whatsappApproved?: boolean;
};

/**
 * Deliver one alert. Returns an outcome; throws only when nothing was
 * delivered and a way that failed may work later (pg-boss retries; a permanent
 * failure is swallowed to avoid a dead-letter loop). Nowhere to send it is
 * said honestly (`skipped_no_destination`), never a fake send.
 *
 * Every kind is one of three, and the type below fails to compile when a new
 * kind is none of them:
 *
 *   · the operator's alerts and the account's letters (`goesByMail`): by
 *     E-MAIL always, WhatsApp too where a channel is live and a number is set
 *     — they must not depend on WhatsApp, which can itself be what is down
 *     (`deliverOperatorAlert`). Left exactly as they were;
 *   · the two interruptions (`INTERRUPTION_KINDS`): the way each person chose
 *     (`deliverOwnerInterruption`);
 *   · everything else (`QUIET_KINDS`): it waits in the app, and nothing leaves.
 */
export async function deliverOwnerAlert(deps: NotifyDeps, job: NotifyJob): Promise<AlertOutcome> {
  const bid = parseBusinessId(job.businessId);
  if (!bid.ok) return 'skipped_no_destination';
  // P3 — Practice alerts nobody. A practice copy (0086) hands conversations to
  // a person and asks for approvals like the workspace does, and every one of
  // those queues an alert: this one check refuses them all, whichever path
  // queued it. The owner is on the Practice page, watching it happen.
  if (await withTenantTx(deps.db, bid.value, (tx) => isPracticeCopy(tx, bid.value))) return 'skipped_practice';
  if (waitsInApp(job.kind)) return 'skipped_quiet';
  if (goesByMail(job.kind)) return deliverOperatorAlert(deps, bid.value, job);
  // Phase 2a — the owner's morning summary: a daily letter, its own class.
  if (isDaily(job.kind)) return deliverMorningSummary(deps, bid.value, job);
  // What is left is an interruption: `Unclassified` below proves there is nothing else.
  return deliverOwnerInterruption(deps, bid.value, job);
}

/** Every kind is classified: an operator alert or an account letter, an interruption, or quiet. */
type Unclassified = Exclude<AlertKind, typeof OPERATOR_ALERT_KINDS[number] | typeof BILLING_ALERT_KINDS[number]
  | 'connection_approved' | 'connection_refused' | 'mailbox_disconnected'
  | typeof INTERRUPTION_KINDS[number] | typeof QUIET_KINDS[number] | typeof DAILY_KINDS[number]>;
const everyKindClassified: [Unclassified] extends [never] ? true : false = true;
void everyKindClassified;

/**
 * An operator alert (the backup alert first), or one of the account's letters
 * (`goesByMail`): e-mail first, WhatsApp too where it can actually arrive, and
 * (0217) the owner's phones where phone alerts are on.
 *
 * Outcome is `sent` when at least one way delivered; `failed_permanent` when
 * every way that existed failed; `skipped_no_destination` when there was no
 * way at all (no login e-mail, no sender, no live number, no phone) — which the
 * log line makes visible, since an alert about missing backups that has nowhere
 * to go is itself something the operator needs to know.
 *
 * 0217 — AN ALERT THAT REACHED NOBODY IS KEPT (`undelivered_alerts`) and tried
 * again every hour for seven days (`retryUndelivered`); while one is open the
 * heartbeat pings its /fail, so the operator hears from outside Nomi. On
 * 2026-10-23 the backup alert's only way out was a mailbox Google had revoked,
 * and the refusal was one warning line. An operator alert with nowhere at all
 * to go is kept too; an account letter with nowhere to go is not (its owner set
 * up no way, and no hour will change that).
 */
async function deliverOperatorAlert(deps: NotifyDeps, bid: BusinessId, job: NotifyJob): Promise<AlertOutcome> {
  const push = deps.push ?? null;
  const found = await withTenantTx(deps.db, bid, async (tx) => {
    const row = (await sql<{ owner_locale: string; owner_phone: string | null }>`
      select owner_locale, owner_phone from businesses where id = ${bid}`.execute(tx)).rows[0] ?? null;
    return {
      row,
      zone: await zoneOf(tx, bid),
      email: await ownerLoginEmail(tx, bid),
      live: row?.owner_phone ? await channelIsLive(tx, bid) : false,
      phones: push ? await ownerPhones(tx, bid) : [],
    };
  });
  if (!found.row) return 'skipped_no_destination';
  const locale: Locale = parseLocale(found.row.owner_locale) ?? 'en';
  const words = renderOwnerAlert(locale, job.kind, null, { ...operatorDetailOf(job), zone: found.zone });
  // R5 — the self-demotion opens the level on the assistant's page, when the installation knows its address.
  // KS6 — an approval opens Channels, where the first channel can now connect.
  const opens = job.kind === 'self_demoted' ? SELF_DEMOTION_PAGE
    : job.kind === 'connection_approved' ? CONNECTION_APPROVAL_PAGE
    // 0217 — a dead mailbox opens the e-mail channel page, where it is connected again.
    : job.kind === 'mailbox_disconnected' ? '/app/channels/email'
    : isBillingAlert(job.kind) ? BILLING_PAGE : null;
  const body = opens && deps.publicBaseUrl
    ? `${words}\n\n${t(locale, 'notify.open', { url: `${deps.publicBaseUrl.replace(/\/$/, '')}${opens}` })}` : words;

  let tried = 0; let sent = 0;
  const why: string[] = [];
  let retryLater: string | null = null;
  const subject = t(locale, operatorSubjectKey(job));
  // MAIL — the operator's alerts by the operator's mailbox; an owner's by the sender strangers' mail uses.
  const mail = isOperatorAlert(job.kind) ? (deps.operatorMail ?? deps.mail) : deps.mail;
  if (mail && found.email) {
    tried++;
    const r = await mail.send({ to: found.email, subject, text: body });
    if (r.ok) sent++; else { console.warn(`[notify] ${job.kind} alert e-mail failed: ${r.error}`); why.push(`e-mail: ${r.error}`); }
  }
  if (found.live && found.row.owner_phone) {
    tried++;
    const r = await deps.adapter.sendText(found.row.owner_phone, body);
    if (r.ok) sent++;
    else {
      // 0217 — said, whichever kind of refusal: until then a refusal that would not change was silent.
      console.warn(`[notify] ${job.kind} WhatsApp alert failed: ${r.error}`);
      why.push(`WhatsApp: ${r.error}`);
      if (r.retryable) retryLater = r.error;
    }
  }
  // 0217 — the owner's phones (G5b), where phone alerts are on: a way out that needs no mailbox and no WhatsApp.
  if (push && found.phones.length > 0) {
    tried++;
    const way = await phoneWay(deps, bid, job.kind, found.phones, { title: subject, body: words, url: null });
    if (way === 'sent') sent++; else why.push(`phone: ${way === 'later' ? 'no answer' : 'refused'}`);
  }
  if (sent > 0) {
    await withTenantTx(deps.db, bid, (tx) => markAlertDelivered(tx, bid, job.kind));
    return 'sent';
  }
  if (tried === 0) {
    console.warn(`[notify] ${job.kind} alert has nowhere to go: no login e-mail or sender, no live number, no phone`);
    if (isOperatorAlert(job.kind)) await keepUndelivered(deps, bid, job, 'nowhere to go: no sign-in e-mail or sender, no live number, no phone');
    return 'skipped_no_destination';
  }
  await keepUndelivered(deps, bid, job, why.join('; '));
  // A WhatsApp refusal that may pass later goes back to the queue, as before; the row is kept either way.
  if (retryLater) throw new Error(`owner alert send failed (retryable): ${retryLater}`);
  return 'failed_permanent';
}

/** 0217 — nobody was reached: kept, with why (no secret, no address), to be tried again. */
async function keepUndelivered(deps: NotifyDeps, bid: BusinessId, job: NotifyJob, why: string): Promise<void> {
  await withTenantTx(deps.db, bid, (tx) => noteUndelivered(tx, bid, job.kind, job, scrubSecrets(why)));
}

/** The owner's phones: those turned on by the owner, or through the owner's access code (no person). */
async function ownerPhones(tx: Tx, bid: BusinessId): Promise<PhoneSubscription[]> {
  const owner = (await sql<{ id: string }>`
    select id::text as id from people where business_id = ${bid} and is_owner and archived_at is null limit 1`.execute(tx)).rows[0];
  return (await livePhones(tx, bid)).filter((p) => p.personId === null || p.personId === owner?.id);
}

/** One message to these phones: sent when any took it; a phone the push service says is gone is archived. */
async function phoneWay(deps: NotifyDeps, bid: BusinessId, kind: AlertKind, phones: readonly PhoneSubscription[],
  message: { readonly title: string; readonly body: string; readonly url: string | null }): Promise<WayResult> {
  const push = deps.push;
  if (!push) return 'failed';
  let result: WayResult = 'failed';
  for (const phone of phones) {
    const sent = await sendPush(phone, message, push.keys, push.fetch);
    if (sent.kind === 'sent') { result = 'sent'; await withTenantTx(deps.db, bid, (tx) => markPhoneSent(tx, phone.id)); }
    else if (sent.kind === 'gone') await withTenantTx(deps.db, bid, (tx) => archivePhone(tx, bid, phone.id, 'gone'));
    else {
      console.warn(`[notify] ${kind} phone alert failed (${sent.status ?? 'no answer'})`);
      if (sent.retryable && result === 'failed') result = 'later';
    }
  }
  return result;
}

/** 0217 — is what this alert says still so? Only two kinds can stop being true on their own; the rest always are. */
async function stillTrue(db: Db, bid: BusinessId, job: NotifyJob): Promise<boolean> {
  if (job.kind === 'backup_failed' || job.kind === 'backup_stale') {
    const { lastRunAt, lastFailure } = await backupTimes(db);
    return backupState(lastRunAt, lastFailure?.failedAt ?? null, new Date()) !== 'fresh';
  }
  if (job.kind === 'mailbox_disconnected') {
    const account = await withTenantTx(db, bid, (tx) => mailboxState(tx, bid));
    return account !== null && account.needsAttention !== null && account.address === job.mailbox?.address;
  }
  return true;
}

/**
 * 0217 — every hour: each alert that reached nobody, not tried within the hour, from the last seven days, is
 * delivered again as it stood (its newest job). A way that works marks it delivered; one that fails counts the try.
 * Never throws: one alert's trouble does not stop the others.
 */
export async function retryUndelivered(deps: NotifyDeps): Promise<{ readonly tried: number; readonly delivered: number }> {
  let tried = 0; let delivered = 0;
  for (const open of await openUndeliveredAlerts(deps.db, '55 minutes')) {
    const bid = parseBusinessId(open.businessId);
    if (!bid.ok) continue;
    const job = await withTenantTx(deps.db, bid.value, (tx) => undeliveredJob(tx, open.id)) as NotifyJob | null;
    if (!job || job.businessId !== open.businessId || job.kind !== open.kind) continue;
    // What it says may have stopped being true while it waited: a backup has completed since, the mailbox is
    // connected again. Then it is closed, never sent — a stale alarm is noise, and the heartbeat is green again.
    if (!await stillTrue(deps.db, bid.value, job)) {
      await withTenantTx(deps.db, bid.value, (tx) => markAlertDelivered(tx, bid.value, job.kind));
      continue;
    }
    tried++;
    try {
      if (await deliverOwnerAlert(deps, job) === 'sent') delivered++;
    } catch (e) {
      console.warn(`[notify] ${open.kind} alert, tried again: ${loggableMessage(e instanceof Error ? e.message : String(e))}`);
    }
  }
  return { tried, delivered };
}

/** How one way out went: delivered, refused for good, or worth trying again later. */
export type WayResult = 'sent' | 'failed' | 'later';

/** The three ways out of Nomi, as `reachPeople` asks them; each says how it went. */
export type InterruptionWays = {
  /** Absent: this installation sends no e-mail. */
  readonly email?: ((to: string) => Promise<WayResult>) | null;
  readonly browser: (phones: readonly PhoneSubscription[]) => Promise<WayResult>;
  /** To the business's alert number — the owner's. */
  readonly whatsapp: () => Promise<WayResult>;
};

/** Whom it reached, and which way: null for a person nothing reached. */
export type Reached = { readonly outcome: AlertOutcome; readonly went: readonly (AlertChannel | null)[]; readonly later: boolean };

/**
 * THE ONE CHOICE OF WAY, for each person an interruption goes to: their
 * choice, or the default (`alertChannelFor`); and e-mail when that way cannot
 * be used now (WhatsApp with no number on a live channel, Browser with no
 * phone turned on) or when it fails — a WhatsApp outside Meta's day before
 * approval among them. Pure but for the ways it is handed, so a test asks it
 * with fakes.
 *
 * `mailOwnerAlways` — rule 18 (CLAUDE.md): a deletion request reaches the
 * owner's sign-in address by e-mail ALWAYS, and the way the owner chose as
 * well when that way is not e-mail.
 */
export async function reachPeople(
  people: readonly InterruptionPerson[],
  o: { readonly whatsappReachable: boolean; readonly approved: boolean; readonly pushOn: boolean; readonly mailOwnerAlways?: boolean },
  ways: InterruptionWays,
): Promise<Reached> {
  const went: (AlertChannel | null)[] = [];
  let tried = false; let later = false;
  for (const p of people) {
    // The same choice the Notifications page draws: with no address, e-mail is no way (null: nothing is tried).
    const way = alertChannelFor(p.choice, {
      whatsapp: p.isOwner && o.whatsappReachable, browser: o.pushOn && p.phones.length > 0, approved: o.approved, email: Boolean(p.email) });
    let r: WayResult | null = way === 'whatsapp' ? await ways.whatsapp()
      : way === 'browser' ? await ways.browser(p.phones) : null;
    let by: AlertChannel | null = r === 'sent' ? way : null;
    if (r !== null) { tried = true; if (r === 'later') later = true; }
    // E-mail: the way chosen, the floor under any other, or (a deletion request) always to the owner.
    if ((r !== 'sent' || (o.mailOwnerAlways === true && p.isOwner)) && ways.email && p.email) {
      tried = true;
      const m = await ways.email(p.email);
      if (m === 'sent') by ??= 'email'; else if (m === 'later') later = true;
    }
    went.push(by);
  }
  const reached = went.some((w) => w !== null);
  return {
    outcome: reached ? 'sent' : tried ? 'failed_permanent' : 'skipped_no_destination',
    went, later: !reached && later,
  };
}

/**
 * THE WARMTH RUN (2026-10-03), phase 8 — THE ONE WAY OUT OF NOMI for the two
 * interruptions (an order waiting for the owner's tap; a customer handed
 * over), to the owner and to each colleague who asked (`interruptionPeople`).
 *
 * The words are each kind's own, as they always were (`renderOwnerAlert`),
 * naming the assistant the conversation is with, with the conversation's
 * address when the installation knows its own. Each person hears ONE way:
 *
 *   · e-mail — to their sign-in address, under the kind's subject;
 *   · browser — every phone or browser of theirs that turned alerts on (G5b):
 *     a phone the push service says is gone is archived;
 *   · WhatsApp — the owner's alert number, through the installation's adapter,
 *     where a channel is live: chosen, or the default once Meta approved Nomi
 *     (`whatsappApproved`). Before approval a send outside Meta's day fails,
 *     and e-mail carries it.
 *
 * A way that fails, or cannot be used now, falls back to e-mail; a deletion
 * request is e-mailed to the owner always (rule 18). Nothing is thrown once
 * anyone was reached: a retry would tell them twice.
 */
export async function deliverOwnerInterruption(deps: NotifyDeps, bid: BusinessId, job: NotifyJob): Promise<AlertOutcome> {
  // D4 — a deletion alert names no conversation: not in its words, not in its link.
  const bare = isDeletionAlert(job.kind);
  const conversationId = !bare && job.conversationId && UUID.test(job.conversationId) ? job.conversationId : null;
  const found = await withTenantTx(deps.db, bid, async (tx) => {
    const facts = await ownerAlertFacts(tx, bid);
    if (!facts) return null;
    return {
      ...facts,
      name: conversationId ? await assistantNameOfConversation(tx, bid, conversationId) : await mainAssistantName(tx, bid),
      people: await interruptionPeople(tx, bid),
    };
  });
  if (!found) return 'skipped_no_destination';
  const locale: Locale = parseLocale(found.locale) ?? 'en';
  const words = renderOwnerAlert(locale, job.kind, found.name);
  const subject = t(locale, `notify.${job.kind}.subject` as MessageKey);
  const link = !deps.publicBaseUrl ? null
    : bare ? deletionAlertLink(deps.publicBaseUrl)
    : conversationId ? alertLink(deps.publicBaseUrl, conversationId) : null;
  const text = !link ? words : bare ? `${words}\n\n${link}` : `${words}\n\n${t(locale, 'notify.open', { url: link })}`;
  const push = deps.push ?? null;
  const ownerPhone = found.ownerPhone;

  const r = await reachPeople(found.people, {
    whatsappReachable: ownerWhatsAppReachable({ ownerPhone, channelLive: found.channelLive }),
    approved: deps.whatsappApproved === true,
    pushOn: push !== null,
    // Rule 18 — a deletion request reaches the owner's sign-in address by e-mail always; D4 — and so does each reminder.
    mailOwnerAlways: job.kind === 'deletion_requested' || job.kind === 'deletion_reminder',
  }, ownerWays(deps, bid, job.kind, { subject, words, text, link }, ownerPhone));
  if (r.later) throw new Error(`owner alert not delivered yet (retryable): ${job.kind}`);
  if (r.outcome === 'skipped_no_destination') console.warn(`[notify] ${job.kind} alert has nowhere to go: no sign-in e-mail or sender, no phone, no open WhatsApp path`);
  return r.outcome;
}

/**
 * The three ways out to a person, for one message: e-mail to their sign-in address, a push to their phones, and
 * WhatsApp to the owner's alert number. Shared by the interruptions and the morning summary (2a), so both leave
 * the same way and fall back the same way (`reachPeople`).
 */
function ownerWays(deps: NotifyDeps, bid: BusinessId, kind: AlertKind,
  msg: { readonly subject: string; readonly words: string; readonly text: string; readonly link: string | null },
  ownerPhone: string | null): InterruptionWays {
  const { subject, words, text, link } = msg;
  const push = deps.push ?? null;
  return {
    email: deps.mail ? async (to) => {
      const m = await deps.mail!.send({ to, subject, text });
      if (!m.ok) console.warn(`[notify] ${kind} alert e-mail failed: ${m.error}`);
      return m.ok ? 'sent' : 'failed';
    } : null,
    browser: async (phones) => {
      if (!push) return 'failed';
      let result: WayResult = 'failed';
      for (const phone of phones) {
        const sent = await sendPush(phone, { title: subject, body: words, url: link }, push.keys, push.fetch);
        if (sent.kind === 'sent') { result = 'sent'; await withTenantTx(deps.db, bid, (tx) => markPhoneSent(tx, phone.id)); }
        else if (sent.kind === 'gone') await withTenantTx(deps.db, bid, (tx) => archivePhone(tx, bid, phone.id, 'gone'));
        else {
          console.warn(`[notify] ${kind} phone alert failed (${sent.status ?? 'no answer'})`);
          if (sent.retryable && result === 'failed') result = 'later';
        }
      }
      return result;
    },
    whatsapp: async () => {
      if (!ownerPhone) return 'failed';
      const sent = await deps.adapter.sendText(ownerPhone, text);
      if (sent.ok) return 'sent';
      console.warn(`[notify] ${kind} WhatsApp alert failed: ${sent.error}`);
      return sent.retryable ? 'later' : 'failed';
    },
  };
}

/**
 * Phase 2a (0150) — THE MORNING SUMMARY, the fourth class (the owner's word, 2026-10-13): not an interruption,
 * not quiet in the app, but a daily letter to the owner that the owner can stop. Claimed once per local day
 * (`claim_morning_summaries`); built at the moment it leaves, so it says what is true then; nothing leaves on a
 * day with nothing to say. It goes the owner's chosen way, with e-mail as the floor, like the interruptions.
 */
export async function deliverMorningSummary(deps: NotifyDeps, bid: BusinessId, job: NotifyJob): Promise<AlertOutcome> {
  const personId = job.personId ?? null;
  const day = job.summaryDay ?? null;
  if (!personId || !day || !UUID.test(personId)) return 'skipped_no_destination';
  const found = await withTenantTx(deps.db, bid, async (tx) => {
    const facts = await ownerAlertFacts(tx, bid);
    const owner = (await interruptionPeople(tx, bid)).find((p) => p.isOwner && p.id === personId);
    if (!facts || !owner) return null;
    return { ...facts, owner, summary: await morningFacts(tx, bid, personId, new Date()) };
  });
  if (!found) { await morningSummaryDone(deps.db, personId, day, 'failed', null); return 'skipped_no_destination'; }
  const locale: Locale = parseLocale(found.locale) ?? 'en';
  const lines = morningLines(locale, found.summary);
  if (!lines) { await morningSummaryDone(deps.db, personId, day, 'nothing', null); return 'skipped_quiet'; }
  const base = deps.publicBaseUrl ? deps.publicBaseUrl.replace(/\/$/, '') : null;
  const subject = t(locale, 'notify.morning_summary.subject');
  const words = [t(locale, 'notify.morning_summary'), ...lines].join('\n');
  // Every summary says how to stop it, where it can say where.
  const text = base ? `${words}\n\n${t(locale, 'summary.open', { url: `${base}/app` })}\n${t(locale, 'summary.off', { url: `${base}/app/settings/alerts#morning` })}` : words;
  const r = await reachPeople([found.owner], {
    whatsappReachable: ownerWhatsAppReachable({ ownerPhone: found.ownerPhone, channelLive: found.channelLive }),
    approved: deps.whatsappApproved === true,
    pushOn: (deps.push ?? null) !== null,
  }, ownerWays(deps, bid, job.kind, { subject, words, text, link: base ? `${base}/app` : null }, found.ownerPhone));
  if (r.later) throw new Error('morning summary not delivered yet (retryable)');
  await morningSummaryDone(deps.db, personId, day, r.outcome === 'sent' ? 'sent' : 'failed', r.went[0] ?? null);
  return r.outcome;
}

/** The job's own fields, as the words for its kind need them. Dates travel as ISO strings. */
/**
 * The subject line: the kind's own, and for the model provider's account (0128)
 * the escalation said in it — "still refusing" after the first, "urgent" when
 * the balance no longer pays for a reply.
 */
export function operatorSubjectKey(job: Pick<NotifyJob, 'kind' | 'providerRefusal' | 'providerBalance'>): MessageKey {
  if (job.kind === 'provider_refusing' && (job.providerRefusal?.step ?? 0) > 0) return 'notify.provider_refusing.subject.still';
  if (job.kind === 'provider_balance' && job.providerBalance?.step === 'unavailable') return 'notify.provider_balance.subject.unavailable';
  return `notify.${job.kind}.subject` as MessageKey;
}

function operatorDetailOf(job: NotifyJob): OperatorAlertDetail {
  return {
    lastBackupAt: job.lastBackupAt ? new Date(job.lastBackupAt) : null,
    deletionsDue: (job.deletionsDue ?? []).map((d) => ({
      business: d.business, scope: d.scope, askedAt: new Date(d.askedAt), overdue: d.overdue,
    })),
    appError: job.appError ?? null,
    metaErrors: job.metaErrors ?? [],
    signups: (job.signups ?? []).map((s) => ({ business: s.business, kind: s.kind, country: s.country })),
    flags: (job.flags ?? []).map((f) => ({ flag: f.flag, business: f.business, since: new Date(f.since) })),
    ...(job.forms ? { forms: job.forms } : {}),
    ...(job.cohort ? { cohort: job.cohort } : {}),
    ...(job.mail ? { mail: job.mail } : {}),
    ...(job.approvals ? { approvals: job.approvals } : {}),
    ...(job.check ? { check: job.check } : {}),
    ...(job.billingAt ? { billingAt: job.billingAt } : {}),
    ...(job.allowancePct !== undefined ? { allowancePct: job.allowancePct } : {}),
    ...(job.renewsAt ? { renewsAt: new Date(job.renewsAt) } : {}),
    ...(job.demoted ? { demoted: job.demoted } : {}),
    ...(job.spend ? { spend: job.spend } : {}),
    // 0167 — production behind main, and caught up.
    ...(job.deploy ? { deploy: job.deploy } : {}),
    ...(job.deployUnseen ? { deployUnseen: job.deployUnseen } : {}),
    // 0217 — a failed backup; a dead mailbox.
    ...(job.backupFailure ? { backupFailure: { ...job.backupFailure, at: new Date(job.backupFailure.at) } } : {}),
    ...(job.mailbox ? { mailbox: { address: job.mailbox.address, since: new Date(job.mailbox.since) } } : {}),
    ...(job.providerRefusal ? { providerRefusal: {
      provider: job.providerRefusal.provider, since: new Date(job.providerRefusal.since), step: job.providerRefusal.step,
      words: job.providerRefusal.words, ...(job.providerRefusal.until ? { until: new Date(job.providerRefusal.until) } : {}),
    } } : {}),
    ...(job.providerBalance ? { providerBalance: job.providerBalance } : {}),
  };
}

/**
 * G1 — the operator hears of each sign-up as it happens: the new workspace's
 * name, kind and country, by e-mail to the operator's own sign-in address (the
 * installation's business), in the operator's language. Nothing a customer
 * said; never the new owner's password or code.
 */
/**
 * KS6 (0115) — a workspace asks to connect its first channel: the operator
 * hears at once, by the installation's own mail, with what to look at — the
 * business, what it sells, its website, where it can be seen — and the
 * command that decides.
 */
export async function notifyOperatorOfConnectionAsk(
  deps: { readonly db: Db; readonly mail: OwnerMailer }, operatorBusinessIdRaw: string, askingBusinessIdRaw: string,
): Promise<'sent' | 'skipped' | 'failed'> {
  const op = parseBusinessId(operatorBusinessIdRaw);
  const asking = parseBusinessId(askingBusinessIdRaw);
  if (!op.ok || !asking.ok || op.value === asking.value) return 'skipped';
  const b = await withTenantTx(deps.db, asking.value, (tx) => sql<{
    name: string; kind: string | null; country: string | null; sells: string | null; website: string | null; page: string | null;
  }>`select b.name, b.kind, b.country, b.description as sells, b.website, a.page
       from businesses b left join connection_approvals a on a.business_id = b.id
      where b.id = ${asking.value}`.execute(tx).then((r) => r.rows[0]));
  const to = await withTenantTx(deps.db, op.value, async (tx) => ({
    locale: (await sql<{ owner_locale: string }>`select owner_locale from businesses where id = ${op.value}`.execute(tx)).rows[0]?.owner_locale ?? 'en',
    email: await ownerLoginEmail(tx, op.value),
  }));
  if (!b || !to.email) return 'skipped';
  const locale: Locale = parseLocale(to.locale) ?? 'en';
  const r = await deps.mail.send({
    to: to.email, subject: t(locale, 'notify.connection_asked.subject', { business: b.name }),
    text: [
      t(locale, 'notify.connection_asked', {
        business: b.name, kind: b.kind ? t(locale, `business.kind.${b.kind}` as MessageKey) : '—', country: b.country ?? '—',
      }),
      t(locale, 'notify.signup_new.sells', { sells: b.sells ?? '—' }),
      t(locale, 'notify.signup_new.website', { website: b.website ?? '—' }),
      t(locale, 'notify.connection_asked.page', { page: b.page ?? '—' }),
      t(locale, 'notify.connection_asked.how', { id: asking.value }),
    ].join('\n'),
  });
  return r.ok ? 'sent' : 'failed';
}

/**
 * Phase 9 — an owner on an installation that cannot connect a number by
 * itself gives the WhatsApp number it uses with customers. The operator hears
 * at once, with the address to write back to; the mail is the request, so
 * nothing new is stored.
 */
export async function notifyOperatorOfWhatsAppNumber(
  deps: { readonly db: Db; readonly mail: OwnerMailer }, operatorBusinessIdRaw: string, askingBusinessIdRaw: string, number: string,
): Promise<'sent' | 'skipped' | 'failed'> {
  const op = parseBusinessId(operatorBusinessIdRaw);
  const asking = parseBusinessId(askingBusinessIdRaw);
  if (!op.ok || !asking.ok) return 'skipped';
  const b = await withTenantTx(deps.db, asking.value, async (tx) => ({
    name: (await sql<{ name: string }>`select name from businesses where id = ${asking.value}`.execute(tx)).rows[0]?.name ?? null,
    email: await ownerLoginEmail(tx, asking.value),
  }));
  const to = await withTenantTx(deps.db, op.value, async (tx) => ({
    locale: (await sql<{ owner_locale: string }>`select owner_locale from businesses where id = ${op.value}`.execute(tx)).rows[0]?.owner_locale ?? 'en',
    email: await ownerLoginEmail(tx, op.value),
  }));
  if (!b.name || !to.email) return 'skipped';
  const locale: Locale = parseLocale(to.locale) ?? 'en';
  const r = await deps.mail.send({
    to: to.email, subject: t(locale, 'notify.whatsapp_asked.subject', { business: b.name }),
    text: t(locale, 'notify.whatsapp_asked', { business: b.name, number, email: b.email ?? '—' }),
  });
  return r.ok ? 'sent' : 'failed';
}

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
